import {GHES_CONFIG,TALK_ATTACHMENT_CONFIG,STATUS_CONFIG} from './config.js';
import {serviceDeskAttachmentTarget} from './serviceDeskClient.js';
import {TALK_LIMITS,TALK_UUID,talkError} from './talkModel.js';
import {editorImageFile} from './editorImages.js';
import {ghesFetch} from './hostFetch.js';

export function talkMediaType(name,bytes) {
  const extension=String(name).split('.').pop().toLowerCase();
  if(extension==='png'&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return {ext:'png',kind:'image',mime:'image/png'};
  if(['jpg','jpeg'].includes(extension)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {ext:'jpg',kind:'image',mime:'image/jpeg'};
  if(extension==='gif'&&/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0,6))))return {ext:'gif',kind:'image',mime:'image/gif'};
  if(extension==='webp'&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return {ext:'webp',kind:'image',mime:'image/webp'};
  if(extension==='mp4'&&new TextDecoder().decode(bytes.slice(4,8))==='ftyp')return {ext:'mp4',kind:'video',mime:'video/mp4'};
  if(extension==='webm'&&[26,69,223,163].every((n,i)=>bytes[i]===n))return {ext:'webm',kind:'video',mime:'video/webm'};
  if(extension==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')return {ext:'pdf',kind:'file',mime:'application/pdf'};
  if(['zip','docx','xlsx','pptx','hwpx'].includes(extension)&&bytes[0]===80&&bytes[1]===75&&[3,5,7].includes(bytes[2]))return {ext:extension,kind:'file',mime:'application/octet-stream'};
  if(['doc','xls','ppt','hwp'].includes(extension)&&[208,207,17,224,161,177,26,225].every((value,index)=>bytes[index]===value))return {ext:extension,kind:'file',mime:'application/octet-stream'};
  if(['txt','md','csv','tsv','json','yaml','yml','log','py','js','ts','java','sql','xml'].includes(extension)){
    try {const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0'))throw Error('binary');return {ext:extension,kind:'file',mime:'text/plain'};}catch{/* Not a UTF-8 text file. */}
  }
  // Unknown formats remain opaque downloads; the original name is kept in metadata.
  return {ext:'bin',kind:'file',mime:'application/octet-stream'};
}
export async function prepareTalkAttachment(file){
  if(!file?.size)throw talkError('빈 파일은 첨부할 수 없습니다.');
  if(file.size>25*1024*1024)throw talkError('파일은 한 개당 25MB까지 첨부할 수 있습니다.');
  const name=(file.name||'첨부 파일').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(-200);
  return new File([file],name,{type:file.type,lastModified:file.lastModified});
}
export function createTalkMediaClient({session,config=TALK_ATTACHMENT_CONFIG,namespace='talk',fetchImpl=ghesFetch}={}) {
  const sharedImages=!config.repo&&!config.owner;
  config=sharedImages?{owner:GHES_CONFIG.owner,repo:GHES_CONFIG.repo,branch:config.branch||'voc-images'}:config;
  const nativeAttachments=false;
  const attachmentRoot=namespace==='inquiry'?'.service-desk':'.e2e-talk';
  const publicSession={host:GHES_CONFIG.host,owner:GHES_CONFIG.owner,repo:GHES_CONFIG.repo};
  const valid=(write=false)=>{
    if(write&&(!session?.token?.trim()||['null','undefined'].includes(session.token.trim())||session.host!==GHES_CONFIG.host))throw talkError('파일을 첨부하려면 로그인하세요.',401);
    const repository=`${config.owner||session?.owner||GHES_CONFIG.owner}/${config.repo}`.toLowerCase();
    if(write&&((repository===`${GHES_CONFIG.owner}/${GHES_CONFIG.repo}`.toLowerCase()&&(!config.branch||config.branch===GHES_CONFIG.branch))||(repository===`${STATUS_CONFIG.owner}/${STATUS_CONFIG.repo}`.toLowerCase()&&config.branch===STATUS_CONFIG.branch)))throw talkError('이미지 브랜치는 main과 현황 저장 브랜치에서 분리하세요.');
    if(!config.repo)throw talkError('첨부 저장소 설정을 확인하세요.');
  };
  let branchPromise;
  const request=async(url,{method='GET',body,allow404=false,raw=false}={})=>{
    valid(method!=='GET');let r;try{r=await fetchImpl(url,{method,headers:{Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json',...(session?.token&&session.host===GHES_CONFIG.host?{Authorization:`Bearer ${session.token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(90000),...(body?{body:JSON.stringify(body)}:{})});}catch{throw talkError('첨부 결과를 확인하지 못했습니다. 다시 시도하세요.');}
    if(r.status===404&&allow404){await r.body?.cancel();return null;}
    if(!r.ok){await r.body?.cancel();throw talkError(r.status===403?'첨부 저장소의 쓰기 권한을 확인하세요.':'첨부 파일을 불러오거나 저장하지 못했습니다.',r.status);}
    return raw?r.blob():r.json();
  };
  const canUpload=async()=>{
    if(!session?.token||session.host!==GHES_CONFIG.host)return false;
    valid(true);const target=serviceDeskAttachmentTarget(session,config);
    return (await request(target.api.replace(/\/issues$/,''))).permissions?.push===true;
  };
  const upload=async(file,draftId)=>{
    valid(true);if(!TALK_UUID.test(draftId))throw talkError('글의 첨부 정보를 확인하세요.');
    file=namespace==='inquiry'?await editorImageFile(file):await prepareTalkAttachment(file);
    const bytes=new Uint8Array(await file.arrayBuffer()),type=talkMediaType(file.name,bytes);
    if(type.kind==='image'&&bytes.length>TALK_LIMITS.imageBytes)throw talkError('이미지는 10MB까지 첨부할 수 있습니다.');
    const target=serviceDeskAttachmentTarget(session,config),api=target.api.replace(/\/issues$/,'');
    if(!await canUpload())throw talkError('첨부 저장소의 쓰기 권한이 필요합니다.',403);
    if(!branchPromise)branchPromise=(async()=>{
      const repo=await request(api),branch=config.branch||repo.default_branch;
      if(typeof branch!=='string'||!branch.trim())throw talkError('첨부 브랜치를 확인하세요.');
      const existing=await request(`${api}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,{allow404:true});
      if(!existing){
        if(sharedImages)throw talkError('이미지 브랜치를 찾을 수 없습니다. 시스템 관리자에게 문의하세요.');
        const head=await request(`${api}/git/ref/heads/${repo.default_branch.split('/').map(encodeURIComponent).join('/')}`);
        if(!/^[a-f\d]{40}$/i.test(head.object?.sha||''))throw talkError('첨부 저장소의 기본 브랜치를 확인하세요.');
        try{await request(`${api}/git/refs`,{method:'POST',body:{ref:`refs/heads/${branch}`,sha:head.object.sha}});}catch(error){if(!await request(`${api}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,{allow404:true}))throw error;}
      }
      return branch;
    })().catch(error=>{branchPromise=null;throw error;});
    const branch=await branchPromise;if(typeof branch!=='string'||!branch.trim())throw talkError('첨부 저장소의 기본 브랜치를 확인하세요.');
    const path=`${attachmentRoot}/attachments/${draftId}/${crypto.randomUUID()}.${type.ext}`,url=`${api}/contents/${path}`,query=`?ref=${encodeURIComponent(branch)}`;
    const prefix=new TextEncoder().encode(`blob ${bytes.length}\0`),input=new Uint8Array(prefix.length+bytes.length);input.set(prefix);input.set(bytes,prefix.length);
    const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-1',input))].map(n=>n.toString(16).padStart(2,'0')).join('');
    let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    try {const saved=await request(url,{method:'PUT',body:{message:namespace==='inquiry'?'AI Workspace 문의 이미지 첨부':'AI Talk 파일 첨부',content:btoa(binary),branch}});if(saved?.content?.sha!==sha)throw talkError('첨부 저장 결과를 확인하지 못했습니다.');}catch(error){const saved=await request(url+query,{allow404:true}).catch(()=>null);if(saved?.sha!==sha)throw error;}
    return {...type,name:file.name,size:file.size,url:`${target.repository}/raw/${encodeURIComponent(branch)}/${path}`};
  };
  const storedPath=url=>{
    if(!config.repo)return null;
    const target=serviceDeskAttachmentTarget(session||publicSession,config),prefix=`${target.repository}/raw/`;
    if(!url.startsWith(prefix))return null;
    const tail=url.slice(prefix.length),slash=tail.indexOf('/');if(slash<0)return null;
    let branch;try{branch=decodeURIComponent(tail.slice(0,slash));}catch{return null;}const path=tail.slice(slash+1);
    if(!path.startsWith(attachmentRoot+'/')||!/^\.(?:e2e-talk|service-desk)\/attachments\/[a-f\d-]{36}\/[a-f\d-]{36}\.(png|jpg|gif|webp|mp4|webm|pdf|zip|doc|docx|xls|xlsx|ppt|pptx|hwp|hwpx|txt|md|csv|tsv|json|yaml|yml|log|py|js|ts|java|sql|xml|bin)$/i.test(path))return null;
    return {target,branch,path};
  };
  const load=async url=>{valid();const path=storedPath(url);if(!path)return null;return request(`${path.target.api.replace(/\/issues$/,'')}/contents/${path.path}?ref=${encodeURIComponent(path.branch)}`,{raw:true});};
  return {upload,storedPath,load,canUpload,nativeAttachments,attachments:namespace==='talk'};
}
