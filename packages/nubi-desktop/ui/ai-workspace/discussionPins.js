import {commitGithubFiles} from './githubTransaction.js';
import {talkError} from './talkModel.js';
import {ghesFetch} from './hostFetch.js';

// App pins are separate from GHES native pins, whose public API is read-only.
// Explicit false overrides also let an administrator unpin a native pin in Talk.
export const DISCUSSION_PINS_PATH='data/configuration/talk-pins.json';
const validSha=value=>/^[a-f\d]{40}$/i.test(value||'');
const invalid=()=>talkError('상단 고정 정보를 확인하지 못했습니다. 새로고침 후 다시 시도하세요.',-1);
export function createDiscussionPinStore({host,owner,repo,branch,token,fetchImpl=ghesFetch}) {
  const root=`https://${host}/api/v3/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const request=async path=>{
    let response;
    try{response=await fetchImpl(root+path,{method:'GET',cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'}});}catch{throw invalid();}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw talkError(response.status===403?'상단 고정 정보의 저장소 접근 권한을 확인하세요.':'상단 고정 정보를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.',response.status);}
    try{return await response.json();}catch{throw invalid();}
  };
  const read=async()=>{
    if(!token||!branch)throw invalid();
    const head=(await request(`/git/ref/heads/${encodeURIComponent(branch)}`))?.object?.sha;
    if(!validSha(head))throw invalid();
    const treeSha=(await request(`/git/commits/${head}`))?.tree?.sha;
    if(!validSha(treeSha))throw invalid();
    const tree=await request(`/git/trees/${treeSha}?recursive=1`);
    if(tree.truncated!==false||!Array.isArray(tree.tree))throw invalid();
    const matches=tree.tree.filter(item=>item.path===DISCUSSION_PINS_PATH);
    // A missing entry in a complete tree is safe to initialize. HTTP failures
    // (including permission-masked 404s) must never become an empty document.
    if(!matches.length)return {head,sha:null,values:new Map()};
    const entry=matches[0];
    if(matches.length!==1||entry.type!=='blob'||entry.mode!=='100644'||!validSha(entry.sha))throw invalid();
    const blob=await request(`/git/blobs/${entry.sha}`);
    if(blob.sha!==entry.sha||blob.encoding!=='base64'||typeof blob.content!=='string')throw invalid();
    let document;
    try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));}catch{throw invalid();}
    if(document?.version!==1||!document.discussions||Array.isArray(document.discussions)||typeof document.discussions!=='object')throw invalid();
    const entries=Object.entries(document.discussions);
    if(entries.some(([key,value])=>!key||key.length>256||typeof value!=='boolean'))throw invalid();
    return {head,sha:entry.sha,values:new Map(entries)};
  };
  const save=async(id,desired)=>{
    if(typeof id!=='string'||!id||id.length>256||typeof desired!=='boolean')throw invalid();
    for(let attempt=0;attempt<3;attempt++){
      const snapshot=await read();
      if(snapshot.values.get(id)===desired)return snapshot;
      const values=new Map(snapshot.values);values.set(id,desired);
      try{
        await commitGithubFiles({host,owner,repo,branch,token,fetchImpl,expectedHead:snapshot.head,publication:false,
          changes:[{path:DISCUSSION_PINS_PATH,sha:snapshot.sha,document:{version:1,discussions:Object.fromEntries(values)}}],
          message:desired?'AI Talk 상단 고정':'AI Talk 상단 고정 해제'});
      }catch(error){
        if(error.status===409&&attempt<2)continue;
        // Verify an ambiguous response; never blindly repeat a write.
        if(!error.status||error.status<0||error.status>=500){try{const saved=await read();if(saved.values.get(id)===desired)return saved;}catch{/* Preserve the original error. */}}
        throw error;
      }
      const saved=await read();if(saved.values.get(id)!==desired)throw talkError('다른 변경이 먼저 반영되었습니다. 새로고침 후 확인하세요.',409);
      return saved;
    }
  };
  return {read,save};
}
