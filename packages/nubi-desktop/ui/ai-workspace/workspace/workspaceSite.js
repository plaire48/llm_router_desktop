import {fromBase64,toBase64,sha256} from '../skills/skillPackage.js';
import {unzipSync} from 'fflate';

export const SITE_LIMIT=50*1024*1024,SITE_FILE_LIMIT=2000;
export const workspaceSitePath=hash=>`data/workspace/sites/${hash}.json`;
export const workspaceSiteHash=id=>`#workspace/site=${id}`;
export const workspaceSiteId=(hash=globalThis.location?.hash||'')=>hash.match(/^#workspace\/site=([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i)?.[1]||null;
const types={html:'text/html',htm:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',wasm:'application/wasm',txt:'text/plain',md:'text/plain',pdf:'application/pdf',mp3:'audio/mpeg',mp4:'video/mp4',webm:'video/webm',ogg:'audio/ogg',map:'application/json'};
Object.assign(types,{yaml:'text/yaml',yml:'text/yaml',xml:'application/xml',csv:'text/csv',webmanifest:'application/manifest+json'});
export const siteMime=path=>types[path.split('.').at(-1).toLowerCase()]||'application/octet-stream';
const excluded=part=>['.git','node_modules','.DS_Store','__MACOSX','Thumbs.db'].includes(part)||part==='.env'||part.startsWith('.env.');
export const sitePathValid=path=>typeof path==='string'&&path.length<=500&&!/[\\:?#\u0000-\u001f\u007f]/.test(path)&&!path.split('/').some(part=>!part||part==='.'||part==='..'||excluded(part));
const sizeError=()=>Error('파일은 합계 50MB 이하로 선택하세요.');
const htmlFile=path=>/\.html?$/i.test(path);
export function validateSiteDescriptor(site){
  if(!site||!/^[a-f\d]{64}$/.test(site.hash)||site.path!==workspaceSitePath(site.hash)||!sitePathValid(site.entry)||!htmlFile(site.entry)||!Number.isSafeInteger(site.fileCount)||site.fileCount<1||site.fileCount>SITE_FILE_LIMIT||!Number.isSafeInteger(site.size)||site.size<1||site.size>SITE_LIMIT)throw Error('페이지 파일 정보를 확인하세요.');
  return site;
}
export async function prepareWorkspaceSite(input){
  if(input?.schemaVersion!==1||!Array.isArray(input.files)||!input.files.length||input.files.length>SITE_FILE_LIMIT)throw Error('파일은 1~2,000개까지 선택하세요.');
  const paths=new Set();let size=0;
  const files=input.files.map(file=>{
    if(!sitePathValid(file?.path)||paths.has(file.path.toLowerCase()))throw Error('중복된 파일 이름이나 경로를 확인하세요.');
    paths.add(file.path.toLowerCase());
    if(typeof file.content!=='string'||file.content.length>Math.ceil(SITE_LIMIT/3)*4)throw sizeError();
    let bytes;try{bytes=fromBase64(file.content);}catch{throw Error('파일 내용을 확인하세요.');}
    size+=bytes.length;if(size>SITE_LIMIT)throw sizeError();
    return {path:file.path,content:toBase64(bytes)};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const pages=files.filter(file=>htmlFile(file.path)).map(file=>file.path);
  if(!pages.length)throw Error('HTML 파일을 함께 선택하세요.');
  const entry=input.entry||pages.find(path=>/^index\.html?$/i.test(path))||pages[0];
  if(!pages.includes(entry))throw Error('시작 페이지를 선택하세요.');
  const document={schemaVersion:1,entry,files},hash=await sha256(new TextEncoder().encode(JSON.stringify(document)));
  const descriptor={hash,path:workspaceSitePath(hash),entry,fileCount:files.length,size};validateSiteDescriptor(descriptor);
  return {document,descriptor,pages};
}
export async function importWorkspaceFiles(input){
  const all=Array.from(input);
  if(all.length===1&&/\.zip$/i.test(all[0].name))return importWorkspaceZip(all[0]);
  const relative=file=>file.relativePath||file.webkitRelativePath||file.name;
  const selected=all.filter(file=>!relative(file).split('/').some(excluded));
  if(selected.reduce((total,file)=>total+file.size,0)>SITE_LIMIT)throw sizeError();
  if(selected.length>SITE_FILE_LIMIT)throw Error('파일은 2,000개까지 선택하세요.');
  const folder=selected.length&&selected.every(file=>(file.relativePath||file.webkitRelativePath)&&relative(file).includes('/')&&relative(file).split('/')[0]===relative(selected[0]).split('/')[0]);
  const files=await Promise.all(selected.map(async file=>({path:folder?relative(file).split('/').slice(1).join('/'):relative(file),content:toBase64(new Uint8Array(await file.arrayBuffer()))})));
  return prepareWorkspaceSite({schemaVersion:1,files});
}

export async function importWorkspaceZip(file){
  if(!file.size||file.size>SITE_LIMIT)throw sizeError();
  const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0)throw Error('ZIP 파일을 확인하세요.');
  const count=view.getUint16(end+10,true),start=view.getUint32(end+16,true),size=view.getUint32(end+12,true),names=new Set();
  if(count>10000||view.getUint16(end+4,true)||view.getUint16(end+6,true)||count!==view.getUint16(end+8,true)||start+size!==end)throw Error('단일 ZIP 파일을 선택하세요.');
  let offset=start,total=0,fileCount=0;
  const accepted=new Set();
  for(let i=0;i<count;i++){
    if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw Error('ZIP 파일 목록을 확인하세요.');
    const length=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true);
    if(offset+46+length+extra+comment>end)throw Error('ZIP 파일 목록을 확인하세요.');
    const path=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset+46,offset+46+length)),key=path.replace(/\/$/,'');
    if(!sitePathValid(key)&&!key.split('/').some(excluded)||names.has(key.toLowerCase())||(view.getUint32(offset+38,true)>>>16&0xf000)===0xa000||view.getUint16(offset+8,true)&1)throw Error('ZIP의 중복 경로, 상위 경로, 링크와 암호화를 확인하세요.');
    names.add(key.toLowerCase());
    if(!path.endsWith('/')&&!key.split('/').some(excluded)){
      total+=view.getUint32(offset+24,true);if(total>SITE_LIMIT)throw sizeError();
      if(++fileCount>SITE_FILE_LIMIT)throw Error('파일은 2,000개까지 선택하세요.');
      accepted.add(path);
    }
    offset+=46+length+extra+comment;
  }
  if(offset!==end)throw Error('ZIP 파일 목록을 확인하세요.');
  let unpacked;try{unpacked=unzipSync(bytes,{filter:entry=>accepted.has(entry.name)});}catch{throw Error('ZIP 파일을 읽지 못했습니다. 다시 압축해 주세요.');}
  let files=Object.entries(unpacked).map(([path,bytes])=>({path,content:toBase64(bytes)}));
  while(files.length&&files.every(file=>file.path.includes('/')&&file.path.split('/')[0]===files[0].path.split('/')[0]))files=files.map(file=>({...file,path:file.path.split('/').slice(1).join('/')}));
  return prepareWorkspaceSite({schemaVersion:1,files});
}

export async function workspaceDroppedFiles(transfer){
  const entries=Array.from(transfer.items||[]).filter(item=>item.kind==='file').map(item=>item.webkitGetAsEntry?.()).filter(Boolean);
  if(!entries.length)return Array.from(transfer.files||[]);
  const files=[];let size=0;
  const walk=async(entry,prefix='')=>{
    if(excluded(entry.name))return;
    const path=prefix+entry.name;
    if(entry.isFile){
      const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));
      size+=file.size;if(size>SITE_LIMIT)throw sizeError();
      if(files.length>=SITE_FILE_LIMIT)throw Error('파일은 2,000개까지 선택하세요.');
      Object.defineProperty(file,'relativePath',{value:path});files.push(file);
    }else if(entry.isDirectory){
      const reader=entry.createReader();
      for(;;){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)await walk(child,path+'/');}
    }
  };
  for(const entry of entries)await walk(entry);
  return files;
}
export async function readWorkspaceSite(document,descriptor){
  validateSiteDescriptor(descriptor);const prepared=await prepareWorkspaceSite(document);
  if(JSON.stringify(prepared.descriptor)!==JSON.stringify(descriptor))throw Error('페이지 파일이 변경되었습니다. 다시 불러오세요.');
  return prepared.document;
}
