import {fromBase64,toBase64,sha256} from '../skills/skillPackage.js';
import {validWorkspaceId,workspaceEditors} from '../workspace/workspaceModel.js';

export const AGENT_PATH='data/agents/catalog.json';
export const AGENT_FILE_LIMIT=500*1024*1024;
const fail=(message,field)=>{throw Object.assign(new Error(message),{field});};
export const AGENT_CHUNK_SIZE=8*1024*1024;
const chunkPath=hash=>`data/agents/chunks/${hash}.json`;
const filePath=hash=>`data/agents/files/${hash}.json`;
const validName=name=>typeof name==='string'&&name.length>0&&name.length<=180&&name.trim()===name&&!/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name)&&!/[. ]$/.test(name)&&!/^\.{1,2}$/.test(name);
export function agentFields(value={}) {
  if(typeof value.title!=='string'||!value.title.trim()||value.title.length>100)fail('이름을 1~100자로 입력하세요.','title');
  if(typeof value.description!=='string'||!value.description.trim()||value.description.length>1000)fail('설명을 1~1,000자로 입력하세요.','description');
  return {title:value.title.trim(),description:value.description.trim()};
}
export function validateAgentFile(file) {
  if(!file||!validName(file.name)||!/^[a-f\d]{64}$/.test(file.hash)||file.path!==filePath(file.hash)||!Number.isSafeInteger(file.size)||file.size<1||file.size>AGENT_FILE_LIMIT||!file.format&&file.size>50*1024*1024||file.format!==undefined&&file.format!=='chunks-v1')fail('Agent 파일 정보를 확인하세요.','file');
  return file;
}
export async function prepareAgentFile(name,bytes) {
  if(!validName(name))fail('파일 이름을 확인하세요.','file');
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>50*1024*1024)fail('큰 파일은 파일 선택으로 다시 추가하세요.','file');
  const hash=await sha256(bytes);
  return {descriptor:{name,size:bytes.length,hash,path:filePath(hash)},bytes,document:{schemaVersion:1,content:toBase64(bytes)}};
}
export async function prepareAgentManifest(document,name) {
  if(!validName(name)||document?.schemaVersion!==2||!Array.isArray(document.chunks)||!document.chunks.length||document.chunks.length>Math.ceil(AGENT_FILE_LIMIT/AGENT_CHUNK_SIZE))fail('Agent 파일 구성을 확인하세요.');
  let size=0;
  const chunks=document.chunks.map((chunk,index)=>{
    if(!/^[a-f\d]{64}$/.test(chunk.hash)||chunk.path!==chunkPath(chunk.hash)||!Number.isSafeInteger(chunk.size)||chunk.size<1||chunk.size>AGENT_CHUNK_SIZE||index<document.chunks.length-1&&chunk.size!==AGENT_CHUNK_SIZE)fail('Agent 파일 조각을 확인하세요.');
    size+=chunk.size;return {hash:chunk.hash,path:chunk.path,size:chunk.size};
  });
  if(size!==document.size||size>AGENT_FILE_LIMIT)fail('Agent 파일 용량을 확인하세요.');
  const manifest={schemaVersion:2,size,chunks},hash=await sha256(new TextEncoder().encode(JSON.stringify(manifest)));
  return {descriptor:{name,size,hash,path:filePath(hash),format:'chunks-v1'},document:manifest};
}
export async function importAgentFile(file,{onProgress=()=>{}}={}) {
  if(!file||!file.size||file.size>AGENT_FILE_LIMIT)fail('파일은 500MB 이하로 선택하세요.','file');
  if(!validName(file.name))fail('파일 이름을 확인하세요.','file');
  if(file.size<=AGENT_CHUNK_SIZE)return prepareAgentFile(file.name,new Uint8Array(await file.arrayBuffer()));
  const chunks=[];
  for(let start=0;start<file.size;start+=AGENT_CHUNK_SIZE){
    const bytes=new Uint8Array(await file.slice(start,start+AGENT_CHUNK_SIZE).arrayBuffer()),hash=await sha256(bytes);
    chunks.push({hash,path:chunkPath(hash),size:bytes.length});onProgress(Math.round(Math.min(start+bytes.length,file.size)/file.size*100));
  }
  return {...await prepareAgentManifest({schemaVersion:2,size:file.size,chunks},file.name),blob:file};
}
export async function readAgentChunk(document,chunk) {
  if(document?.schemaVersion!==1||typeof document.content!=='string'||document.content.length>Math.ceil(AGENT_CHUNK_SIZE/3)*4)fail('Agent 파일 조각을 확인하지 못했습니다.');
  const bytes=fromBase64(document.content);
  if(bytes.length!==chunk.size||await sha256(bytes)!==chunk.hash)fail('Agent 파일 조각이 변경되었습니다. 다시 불러오세요.');
  return bytes;
}
export async function agentChunkDocument(upload,index) {
  const chunk=upload.document.chunks[index],start=index*AGENT_CHUNK_SIZE,bytes=new Uint8Array(await upload.blob.slice(start,start+chunk.size).arrayBuffer());
  const document={schemaVersion:1,content:toBase64(bytes)};await readAgentChunk(document,chunk);return document;
}
export async function verifyAgentUpload(upload) {
  if(upload.descriptor.format!=='chunks-v1')return prepareAgentFile(upload.descriptor.name,upload.bytes);
  const value=await prepareAgentManifest(upload.document,upload.descriptor.name);
  if(value.descriptor.hash!==upload.descriptor.hash||upload.blob?.size!==value.descriptor.size||typeof upload.blob?.slice!=='function')fail('선택한 Agent 파일을 다시 확인하세요.');
  return {...value,blob:upload.blob};
}
export async function readAgentFile(document,descriptor,{loadChunk,onProgress=()=>{}}={}) {
  validateAgentFile(descriptor);
  if(descriptor.format==='chunks-v1'){
    const manifest=await prepareAgentManifest(document,descriptor.name);
    if(manifest.descriptor.hash!==descriptor.hash||manifest.descriptor.size!==descriptor.size||typeof loadChunk!=='function')fail('Agent 파일 구성이 변경되었습니다.');
    const parts=[];
    for(const chunk of manifest.document.chunks){parts.push(new Blob([await readAgentChunk(await loadChunk(chunk),chunk)]));onProgress(Math.round(parts.length/manifest.document.chunks.length*100));}
    return new Blob(parts,{type:'application/octet-stream'});
  }
  if(document?.schemaVersion!==1||typeof document.content!=='string'||document.content.length>Math.ceil(descriptor.size/3)*4)fail('Agent 파일 내용을 확인하지 못했습니다.');
  const file=await prepareAgentFile(descriptor.name,fromBase64(document.content));
  if(file.descriptor.hash!==descriptor.hash||file.descriptor.size!==descriptor.size)fail('Agent 파일이 변경되었습니다. 다시 불러오세요.');
  return file.bytes;
}
export function validateAgentCatalog(document) {
  if(document?.schemaVersion!==1||!Array.isArray(document.items)||document.items.length>2000)fail('Agent 목록 형식을 확인하세요.');
  const ids=new Set();
  for(const item of document.items){
    if(!item||!validWorkspaceId(item.id)||ids.has(item.id))fail('Agent 식별자를 확인하세요.');
    ids.add(item.id);agentFields(item);validateAgentFile(item.file);
    if(!['createdBy','updatedBy'].every(key=>/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(item[key]||''))||!['createdAt','updatedAt'].every(key=>typeof item[key]==='string'&&Number.isFinite(Date.parse(item[key]))))fail('Agent 관리 정보를 확인하세요.');
    if(!Array.isArray(item.editors))fail('수정 권한을 확인하세요.');workspaceEditors(item.editors,item.createdBy);
  }
  return document;
}
export const agentHash=id=>`#agent=${id}`;
export const agentId=(hash=globalThis.location?.hash||'')=>validWorkspaceId(hash.slice(7))&&hash.startsWith('#agent=')?hash.slice(7):null;
export const agentFeedbackTag=id=>`ai-workspace-agent:${id}`;
export const agentFeedbackHash=item=>`#talk?agent=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.title)}`;
export function agentFeedbackContext(hash) {
  if(!hash.startsWith('#talk?'))return null;
  const params=new URLSearchParams(hash.slice(6)),id=params.get('agent'),title=params.get('name');
  return validWorkspaceId(id)&&title&&title.length<=100?{id,title}:null;
}
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const agentFeedbackDraft=(context,baseUrl=globalThis.location?.href||'https://localhost/')=>context?{title:`${context.title} 개선 제안`,html:`<p><a href="${escape(new URL(agentHash(context.id),baseUrl).href)}">${escape(context.title)}</a></p><h2>제안할 내용</h2><p></p>`}:null;
export const agentFileSize=size=>size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/1024/1024).toFixed(1)} MB`;
