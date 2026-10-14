import {AGENT_PATH,agentFields,validateAgentCatalog,verifyAgentUpload,prepareAgentManifest,agentChunkDocument,readAgentChunk,readAgentFile} from '../agents/agentModel.js';
import {GHES_CONFIG} from '../config.js';
import {getGithubSession,readGithubUser} from '../session.js';
import {createAdminClient} from '../adminClient.js';
import {commitGithubFiles} from '../githubTransaction.js';
import {fromBase64} from '../skills/skillPackage.js';
import {prepareWorkspaceIcon,readWorkspaceIcon,validateWorkspaceIcon} from './workspaceIcon.js';
import {prepareWorkspaceSite,readWorkspaceSite,validateSiteDescriptor} from './workspaceSite.js';
import {WORKSPACE_PATH,validateWorkspaceCatalog,workspaceFields,workspaceEditors,canCreateWorkspace,canEditWorkspace,canOwnWorkspace,validWorkspaceId} from './workspaceModel.js';
import {ghesFetch} from '../hostFetch.js';

const failure=(message,status)=>Object.assign(new Error(message),{status});
const validSha=value=>/^[a-f\d]{40}$/i.test(value||'');
export function createWorkspaceClient({session={...getGithubSession(),user:readGithubUser()},fetchImpl=ghesFetch,baseUrl=globalThis.location?.href,resolveRole,commit=commitGithubFiles,collection='app'}={}) {
  if(!['app','agent'].includes(collection))throw failure('목록 종류를 확인하세요.');
  const isAgent=collection==='agent',catalogPath=isAgent?AGENT_PATH:WORKSPACE_PATH,validateCatalog=isAgent?validateAgentCatalog:validateWorkspaceCatalog;
  const resourceFailure=(message,status)=>failure(isAgent?message.replaceAll('앱','Agent'):message,status);
  const target={host:GHES_CONFIG.host,owner:GHES_CONFIG.owner,repo:GHES_CONFIG.repo,branch:GHES_CONFIG.branch};
  const authenticated=Boolean(session.token&&session.host===target.host&&session.user?.login);
  const origin=`https://${target.host}/api/v3/`,api=`${origin}repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const request=async url=>{
    let response;
    try{response=await fetchImpl(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000),headers:authenticated&&url.startsWith(origin)?{Authorization:`Bearer ${session.token}`,Accept:'application/vnd.github.object+json'}:{}});}
    catch{throw resourceFailure('연결을 확인하고 다시 불러오세요.');}
    if(!response.ok)throw resourceFailure(({401:'로그인이 만료되었습니다. 다시 로그인하세요.',403:'저장소 접근 권한을 확인하세요.',404:'앱 목록 파일과 브랜치를 확인하세요.'})[response.status]||'앱을 불러오지 못했습니다.',response.status);
    try{return await response.json();}catch{throw resourceFailure('앱 응답 형식을 확인하세요.');}
  };
  const readDocument=async(path,head)=>{
    if(!authenticated)return {sha:null,head:null,document:await request(new URL(path,new URL('./',baseUrl)).href)};
    let file=await request(`${api}/contents/${path}?ref=${encodeURIComponent(head)}`);
    const sha=file?.sha;if(!validSha(sha))throw resourceFailure('목록의 파일 버전을 확인하지 못했습니다.');
    if(file.encoding==='none')file=await request(`${api}/git/blobs/${sha}`);
    if(file.sha!==sha||file.encoding!=='base64'||typeof file.content!=='string')throw resourceFailure('목록 파일 내용을 확인하지 못했습니다.');
    let document;try{document=JSON.parse(new TextDecoder().decode(fromBase64(file.content)));}catch{throw resourceFailure('앱 목록의 JSON 형식을 확인하세요.');}
    return {sha,head,document};
  };
  const read=async head=>{
    const file=await readDocument(catalogPath,head);
    return {...file,document:validateCatalog(file.document)};
  };
  const list=async()=>{
    if(!authenticated)return read();
    const head=(await request(`${api}/git/ref/heads/${encodeURIComponent(target.branch)}`))?.object?.sha;
    if(!validSha(head))throw resourceFailure('저장소의 최신 버전을 확인하지 못했습니다.');
    return read(head);
  };
  const requireWriter=async()=>{
    if(!authenticated)throw resourceFailure('사내 GitHub에 로그인하세요.',401);
    const actor=await request(`${origin}user`);
    if(!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(actor?.login||'')||!Number.isSafeInteger(actor.id)||actor.login.toLowerCase()!==session.user.login.toLowerCase()||(session.user.id&&actor.id!==session.user.id))throw resourceFailure('로그인 사용자가 변경되었습니다. 다시 로그인하세요.',401);
    const role=await(resolveRole?resolveRole():createAdminClient({session:{...session,user:actor},fetchImpl}).role());
    if(!canCreateWorkspace(actor,role))throw resourceFailure('사용자 권한을 확인한 뒤 다시 시도하세요.',403);
    return {actor,role};
  };
  const publish=async(latest,document,message,additional=[],onProgress)=>{
    validateCatalog(document);
    const result=await commit({...target,token:session.token,changes:[{path:catalogPath,sha:latest.sha,document},...additional],message,fetchImpl,expectedHead:latest.head,publication:false,onProgress});
    const snapshot=await read(result.commit.sha);
    if(JSON.stringify(snapshot.document)!==JSON.stringify(document))throw resourceFailure('저장 결과가 일치하지 않습니다. 최신 목록을 불러와 확인하세요.');
    return snapshot;
  };
  const checkSnapshot=(snapshot,latest)=>{
    if(!snapshot?.sha||snapshot.sha!==latest.sha)throw resourceFailure('다른 변경이 먼저 저장되었습니다. 최신 목록을 불러와 비교하세요. 입력한 내용은 유지됩니다.',409);
  };
  const save=async({snapshot,existing=null,id=existing?.id||crypto.randomUUID(),fields,icon,site,editors,file,onProgress})=>{
    const {actor,role}=await requireWriter(),values=(isAgent?agentFields:workspaceFields)(fields);
    if(!validWorkspaceId(id)||existing&&id!==existing.id)throw resourceFailure('앱 식별자를 확인하세요.');
    const latest=await list();checkSnapshot(snapshot,latest);
    const previous=latest.document.items.find(item=>item.id===id);
    if(existing&&(!previous||JSON.stringify(previous)!==JSON.stringify(existing))||!existing&&previous)throw resourceFailure('앱이 변경되었습니다. 최신 목록을 불러와 비교하세요.',409);
    if(previous&&!canEditWorkspace(previous,actor,role))throw resourceFailure('수정 권한이 없습니다. 관리자에게 권한을 요청하세요.',403);
    const managers=[];
    // Legacy maintainers no longer grant access. Only explicitly assigned editors do.
    const selectedEditors=workspaceEditors(editors??previous?.editors??[],previous?.createdBy||actor.login);
    if(previous&&!canOwnWorkspace(previous,actor,role)&&JSON.stringify(selectedEditors)!==JSON.stringify(workspaceEditors(previous.editors||[],previous.createdBy)))throw resourceFailure('다른 사용자에게 수정 권한을 부여할 수 없습니다.',403);
    const uploaded=icon?await prepareWorkspaceIcon(icon.bytes):null;
    const selectedIcon=icon===undefined?previous?.icon:uploaded?.descriptor;
    const additional=[];
    const uploadedFile=isAgent&&file?await verifyAgentUpload(file):null,selectedFile=uploadedFile?.descriptor||previous?.file;
    if(isAgent&&!selectedFile)throw resourceFailure('공유할 Agent 파일을 선택하세요.');
    if(uploadedFile){
      let stored;try{stored=await readDocument(uploadedFile.descriptor.path,latest.head);}catch(error){if(error.status!==404)throw error;}
      if(stored){if(uploadedFile.descriptor.format==='chunks-v1'){const check=await prepareAgentManifest(stored.document,uploadedFile.descriptor.name);if(check.descriptor.hash!==uploadedFile.descriptor.hash)throw resourceFailure('Agent 파일 구성이 변경되었습니다.');}else await readAgentFile(stored.document,uploadedFile.descriptor);}
      if(!stored)additional.push({path:uploadedFile.descriptor.path,sha:null,document:uploadedFile.document});
      if(uploadedFile.descriptor.format==='chunks-v1'){
        const seen=new Set();
        for(const [index,chunk] of uploadedFile.document.chunks.entries()){
          if(seen.has(chunk.path))continue;seen.add(chunk.path);
          let previousChunk;try{previousChunk=await readDocument(chunk.path,latest.head);}catch(error){if(error.status!==404)throw error;}
          if(previousChunk)await readAgentChunk(previousChunk.document,chunk);
          else additional.push({path:chunk.path,sha:null,loadDocument:()=>agentChunkDocument(uploadedFile,index)});
        }
      }
    }
    if(previous&&(previous.kind==='site')!==(values.kind==='site'))throw resourceFailure('앱 종류는 변경할 수 없습니다.');
    const uploadedSite=site?await prepareWorkspaceSite(site.document):null;
    const selectedSite=uploadedSite?.descriptor||previous?.site;
    if(values.kind==='site'&&!selectedSite)throw resourceFailure('HTML과 함께 사용할 파일을 선택하세요.');
    if(values.kind!=='site'&&site)throw resourceFailure('파일 탭에서 페이지를 등록하세요.');
    if(uploadedSite){
      let stored;try{stored=await readDocument(uploadedSite.descriptor.path,latest.head);}catch(error){if(error.status!==404)throw error;}
      if(stored)await readWorkspaceSite(stored.document,uploadedSite.descriptor);
      else additional.push({path:uploadedSite.descriptor.path,sha:null,document:uploadedSite.document});
    }
    if(uploaded){
      let stored;try{stored=await readDocument(uploaded.descriptor.path,latest.head);}catch(error){if(error.status!==404)throw error;}
      if(stored)await readWorkspaceIcon(stored.document,uploaded.descriptor);
      else additional.push({path:uploaded.descriptor.path,sha:null,document:uploaded.document});
    }
    if(previous&&Object.entries(values).every(([key,value])=>previous[key]===value)&&JSON.stringify(previous.maintainers)===JSON.stringify(managers)&&JSON.stringify(previous.editors||[])===JSON.stringify(selectedEditors)&&JSON.stringify(previous.icon)===JSON.stringify(selectedIcon)&&JSON.stringify(previous.site)===JSON.stringify(selectedSite)&&JSON.stringify(previous.file)===JSON.stringify(selectedFile)&&!additional.length)return {snapshot:latest,item:previous,unchanged:true};
    const now=new Date().toISOString(),item={id,...values,...(isAgent?{file:selectedFile}:{}),...(selectedIcon?{icon:selectedIcon}:{}),...(values.kind==='site'?{site:selectedSite}:{}),maintainers:managers,editors:selectedEditors,createdAt:previous?.createdAt||now,createdBy:previous?.createdBy||actor.login,updatedAt:now,updatedBy:actor.login};
    const document={schemaVersion:1,items:previous?latest.document.items.map(entry=>entry.id===id?item:entry):[...latest.document.items,item]};
    return {snapshot:await publish(latest,document,`${collection}: ${previous?'update':'add'} ${id}`,additional,onProgress),item};
  };
  const remove=async({snapshot,item})=>{
    const {actor,role}=await requireWriter(),latest=await list();checkSnapshot(snapshot,latest);
    const previous=latest.document.items.find(entry=>entry.id===item?.id);
    if(!previous||JSON.stringify(previous)!==JSON.stringify(item))throw resourceFailure('앱이 변경되었습니다. 최신 목록을 불러오세요.',409);
    if(!canOwnWorkspace(previous,actor,role))throw resourceFailure('삭제할 권한이 없습니다.',403);
    return publish(latest,{schemaVersion:1,items:latest.document.items.filter(entry=>entry.id!==item.id)},`${collection}: remove ${item.id}`);
  };
  const searchMaintainers=async(query,options)=>{
    if(!authenticated)throw resourceFailure('사내 GitHub에 로그인하세요.',401);
    return createAdminClient({session,fetchImpl}).searchWorkspaceMaintainers(query,options);
  };
  const icons=new Map();
  const loadIcon=icon=>{
    validateWorkspaceIcon(icon);
    if(!icons.has(icon.hash))icons.set(icon.hash,readDocument(icon.path,target.branch).then(file=>readWorkspaceIcon(file.document,icon)).catch(error=>{icons.delete(icon.hash);throw error;}));
    return icons.get(icon.hash);
  };
  const loadSite=async site=>{validateSiteDescriptor(site);return readWorkspaceSite((await readDocument(site.path,target.branch)).document,site);};
  const download=async(id,{onProgress}={})=>{
    if(!isAgent)throw resourceFailure('Agent 파일을 선택하세요.');
    const snapshot=await list(),item=snapshot.document.items.find(row=>row.id===id);
    if(!item)throw resourceFailure('삭제되었거나 공유가 종료된 Agent입니다.',404);
    const stored=await readDocument(item.file.path,snapshot.head);
    const value=await readAgentFile(stored.document,item.file,{loadChunk:async chunk=>(await readDocument(chunk.path,snapshot.head)).document,onProgress});
    return {item,...(value instanceof Blob?{blob:value}:{bytes:value})};
  };
  return {download,list,save,remove,searchMaintainers,loadIcon,loadSite,authenticated};
}
