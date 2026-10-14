import {isPublicationTarget} from './config.js';
import {PUBLIC_DATA_PATHS,PUBLIC_MANIFEST_PATH,PUBLIC_WORK_PATH,validateManifest,createDataManifest} from './publicDataContract.js';
import {SKILL_MARKETPLACE_PATHS,isSkillPluginPath,validPluginName} from './skills/skillMarketplacePaths.js';
import {ghesFetch} from './hostFetch.js';
// Publish a set of JSON files by moving one branch reference, without force.
// Intermediate objects are never visible through the branch before publication.
const validSha = value => /^[a-f\d]{40}$/i.test(value || '');
const failure = (message, status) => Object.assign(new Error(message), {status});
export async function commitGithubFiles({host,owner,repo,token,branch,changes,message,fetchImpl=ghesFetch,expectedHead=null,skillName=null,onProgress=()=>{},publication=isPublicationTarget({owner,repo,branch})}) {
  if (!branch || !changes?.length || !message) throw failure('저장할 브랜치와 변경 파일을 확인하세요.');
  if(skillName!==null&&(!validPluginName(skillName)||!validSha(expectedHead)||!changes.some(entry=>entry.path==='data/skills/catalog.json')||!SKILL_MARKETPLACE_PATHS.every(path=>changes.some(entry=>entry.path===path))))throw failure('스킬 배포 기준을 확인하세요.');
  const generated=entry=>skillName!==null&&(SKILL_MARKETPLACE_PATHS.includes(entry.path)||isSkillPluginPath(entry.path,skillName));
  publication=publication&&changes.some(entry=>PUBLIC_DATA_PATHS.includes(entry.path));
  const paths=new Set();
  for (const entry of changes) {
    if ((!/^data\/[\w./-]+\.json$/.test(entry.path)&&!generated(entry)) || entry.path.split('/').some(part=>!part||part==='.'||part==='..') || paths.has(entry.path)) throw failure('저장 경로가 올바르지 않습니다.');
    if((entry.delete||entry.encoding||entry.mode)&&(!generated(entry)||SKILL_MARKETPLACE_PATHS.includes(entry.path)))throw failure('스킬 파일 저장 형식을 확인하세요.');
    if(entry.encoding&&entry.encoding!=='base64'||entry.mode&&!['100644','100755'].includes(entry.mode)||entry.delete&&(entry.content!==undefined||entry.document!==undefined))throw failure('스킬 파일 저장 형식을 확인하세요.');
    if (entry.path===PUBLIC_MANIFEST_PATH)throw failure('게시 버전 파일은 자동으로 관리합니다.');
    if (entry.sha && !validSha(entry.sha)) throw failure('파일 버전을 확인하지 못했습니다.');
    if(entry.loadDocument&&(typeof entry.loadDocument!=='function'||!/^data\/agents\/chunks\/[a-f\d]{64}\.json$/.test(entry.path)||entry.document!==undefined||entry.content!==undefined))throw failure('파일 분할 저장 형식을 확인하세요.');
    paths.add(entry.path);
  }
  const root=`https://${host}/api/v3/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'};
  const request=async(path,{method='GET',body,missing=false}={})=>{
    let response;
    try {response=await fetchImpl(`${root}${path}`,{method,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000),headers:{...headers,...(path.startsWith('/contents/')?{Accept:'application/vnd.github.object+json'}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch {throw failure('저장 결과를 확인하지 못했습니다. 수정값은 유지됩니다. 다시 저장하면 반영 여부부터 확인합니다.');}
    if(missing&&response.status===404){await response.body?.cancel().catch(()=>{});return null;}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw failure(response.status===409?'다른 사용자가 먼저 저장했습니다. 최신 값과 다시 비교합니다.':response.status===403?'이 브랜치에 저장할 권한이 없습니다.':response.status===422?'저장할 버전이나 브랜치 보호 설정을 확인하세요.':'GHES 저장 요청을 완료하지 못했습니다.',response.status);}
    try{return await response.json();}catch{throw failure('저장 응답을 확인하지 못했습니다. 수정값은 유지됩니다.');}
  };
  const refPath=`/git/ref/heads/${encodeURIComponent(branch)}`;
  const head=(await request(refPath))?.object?.sha;
  if(!validSha(head))throw failure('브랜치의 최신 버전을 확인하지 못했습니다.');
  if(expectedHead&&head!==expectedHead)throw failure('조회 후 다른 사용자가 저장했습니다. 최신 값과 다시 비교합니다.',409);
  const base=await request(`/git/commits/${head}`);
  if(!validSha(base?.tree?.sha))throw failure('저장 기준을 확인하지 못했습니다.');
  // Match every expected blob against the SAME immutable revision.
  for(const entry of changes){
    // Generated files share the required, exact expectedHead with the skill catalog.
    // No unbounded paths or another skill's files are accepted in this scope.
    if(generated(entry)&&entry.sha===undefined)continue;
    const current=await request(`/contents/${entry.path}?ref=${head}`,{missing:true});
    if(current && !validSha(current.sha))throw failure('파일 버전을 확인하지 못했습니다.');
    if((current?.sha||null)!==(entry.sha||null))throw failure('다른 사용자가 기준정보를 변경했습니다.',409);
  }
  let previousManifest,publicationFiles,workRows;
  const readDocument=async(path)=>{
    let data=await request(`/contents/${path}?ref=${head}`);
    if(data?.encoding==='none'&&validSha(data.sha)){const expected=data.sha;data=await request(`/git/blobs/${expected}`);if(data?.sha!==expected)throw failure('파일 버전과 본문이 다릅니다.');}
    if(data?.encoding!=='base64'||!data.content)throw failure('게시 기준 파일을 확인하지 못했습니다.');
    try{return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));}catch{throw failure('게시 기준 JSON을 확인하지 못했습니다.');}
  };
  if(publication){
    previousManifest=validateManifest(await readDocument(PUBLIC_MANIFEST_PATH));
    const tree=await request(`/git/trees/${base.tree.sha}?recursive=1`);
    if(tree.truncated||!Array.isArray(tree.tree))throw failure('전체 데이터 버전을 확인하지 못했습니다.');
    const files=new Map(tree.tree.map(item=>[item.path,item]));
    publicationFiles={};
    for(const path of PUBLIC_DATA_PATHS){
      const file=files.get(path);
      if(file?.type!=='blob'||file.mode!=='100644'||!validSha(file.sha)||previousManifest.files[path]!==file.sha)throw failure('게시 버전과 원본이 일치하지 않습니다. 시스템 관리자에게 확인을 요청하세요.');
      publicationFiles[path]=file.sha;
    }
    const work=changes.find(entry=>entry.path===PUBLIC_WORK_PATH);
    const document=work?(work.document||JSON.parse(work.content)):await readDocument(PUBLIC_WORK_PATH);
    if(!Array.isArray(document.rows))throw failure('현황 원본을 확인하지 못했습니다.');
    workRows=document.rows;
  }
  const fileShas={};
  for(const entry of changes){
    if(entry.delete){fileShas[entry.path]=null;continue;}
    const blob=await request('/git/blobs',{method:'POST',body:{encoding:entry.encoding||'utf-8',content:entry.content??`${JSON.stringify(entry.loadDocument?await entry.loadDocument():entry.document,null,2)}\n`}});
    if(!validSha(blob?.sha))throw failure('변경 파일의 버전을 확인하지 못했습니다.');
    fileShas[entry.path]=blob.sha;onProgress?.({completed:Object.keys(fileShas).length,total:changes.length});
  }
  const tree=await request('/git/trees',{method:'POST',body:{base_tree:base.tree.sha,tree:changes.map(entry=>({path:entry.path,mode:entry.mode||'100644',type:'blob',sha:fileShas[entry.path]}))}});
  if(!validSha(tree?.sha))throw failure('변경 파일을 준비하지 못했습니다.');
  const commit=await request('/git/commits',{method:'POST',body:{message,tree:tree.sha,parents:[head]}});
  if(!validSha(commit?.sha))throw failure('변경 이력을 준비하지 못했습니다.');
  let publishCommit=commit;
  if(publication){
    for(const path of PUBLIC_DATA_PATHS)if(fileShas[path])publicationFiles[path]=fileShas[path];
    const manifest=await createDataManifest({files:publicationFiles,sourceCommit:commit.sha,publishedAt:commit.committer?.date||commit.author?.date,rows:workRows,previous:previousManifest});
    const blob=await request('/git/blobs',{method:'POST',body:{encoding:'utf-8',content:JSON.stringify(manifest)+'\n'}});
    if(!validSha(blob?.sha))throw failure('게시 버전을 준비하지 못했습니다.');
    const indexTree=await request('/git/trees',{method:'POST',body:{base_tree:tree.sha,tree:[{path:PUBLIC_MANIFEST_PATH,mode:'100644',type:'blob',sha:blob.sha}]}});
    if(!validSha(indexTree?.sha))throw failure('게시 파일을 준비하지 못했습니다.');
    publishCommit=await request('/git/commits',{method:'POST',body:{message:'E2E 게시 버전 갱신',tree:indexTree.sha,parents:[commit.sha]}});
    if(!validSha(publishCommit?.sha))throw failure('게시 이력을 준비하지 못했습니다.');
  }
  try {
    const result=await request(`/git/refs/heads/${encodeURIComponent(branch)}`,{method:'PATCH',body:{sha:publishCommit.sha,force:false}});
    if(result?.object?.sha!==publishCommit.sha)throw failure('저장 결과를 확인하지 못했습니다.');
  }catch(error){
    // A response may be lost after the commit is accepted. Do not blindly repeat a write.
    let latest;
    try {latest=(await request(refPath))?.object?.sha;}catch{throw error;}
    if(latest!==publishCommit.sha){
      if(validSha(latest)&&latest!==head){
        let comparison;
        try {comparison=await request(`/compare/${publishCommit.sha}...${latest}`);}catch{/* Preserve uncertain result. */}
        if(!['ahead','identical'].includes(comparison?.status)){
          if([409,422].includes(error.status))throw failure('다른 사용자가 먼저 저장했습니다.',409);
          throw error;
        }
      }else throw error;
    }
  }
  return {commit:{...commit,html_url:`https://${host}/${owner}/${repo}/commit/${commit.sha}`,repositoryScope:'settings',dataPaths:changes.map(entry=>entry.path)},fileShas,...(publication?{publication:{sha:publishCommit.sha,revision:commit.sha}}:{})};
}
