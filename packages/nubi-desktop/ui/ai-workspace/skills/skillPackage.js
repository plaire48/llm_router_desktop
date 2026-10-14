import {unzipSync, zipSync} from 'fflate';
import {parseDocument} from 'yaml';

export const PACKAGE_LIMITS = Object.freeze({archive:5*1024*1024, expanded:20*1024*1024, file:2*1024*1024, count:200, markdown:512*1024});
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isSkillMarkdown = path => path.split('/').at(-1).toLowerCase()==='skill.md';
const isPackageEntry = path => isSkillMarkdown(path)&&path.split('/').length<=2;
const fail = message => {throw new Error(message);};
export const toBase64 = bytes => {
  let text='';
  for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(text);
};
export const fromBase64 = text => Uint8Array.from(atob(text.replace(/\s/g,'')), c=>c.charCodeAt(0));
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function readSkillMarkdown(markdown) {
  const match=markdown.replace(/^\uFEFF/,'').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if(!match)fail('SKILL.md 첫 부분에 name과 description을 YAML로 작성하세요.');
  let meta;
  try {
    const document=parseDocument(match[1],{uniqueKeys:true});
    if(document.errors.length)throw document.errors[0];
    meta=document.toJS({maxAliasCount:0});
  } catch {fail('SKILL.md의 YAML 형식을 확인하세요.');}
  if(typeof meta?.name!=='string'||meta.name.length>64||!SKILL_NAME.test(meta.name))fail('name은 64자 이내 영문 소문자, 숫자, 하이픈으로 작성하세요.');
  if(typeof meta.description!=='string'||!meta.description.trim()||meta.description.length>1024)fail('description은 1~1,024자로 작성하세요.');
  if(!match[2].trim())fail('SKILL.md에 사용 방법을 작성하세요.');
  const declaredVersion=meta.metadata?.version??meta.version;
  return {name:meta.name,description:meta.description.trim(),version:String(declaredVersion??'1.0.0'),declaredVersion:declaredVersion===undefined?null:String(declaredVersion),markdown,body:match[2].trim()};
}
export const safeSkillPath = path => typeof path==='string'&&path.length<=240&&!/[\\:\x00-\x1f\x7f]/.test(path)&&!path.startsWith('/')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part!=='.git');
const safePath=safeSkillPath;
export function validateSkillFiles(files) {
  if(!files.length||files.length>PACKAGE_LIMITS.count)fail('파일이 1~200개인 폴더나 ZIP을 선택하세요.');
  const names=new Set();let total=0;
  for(const file of files){
    if(!safePath(file.path)||names.has(file.path.toLowerCase()))fail('중복 경로 또는 상위 경로가 있는 파일은 업로드할 수 없습니다.');
    if(file.bytes.length>PACKAGE_LIMITS.file||(total+=file.bytes.length)>PACKAGE_LIMITS.expanded)fail('파일당 2MB, 전체 20MB 이하로 구성하세요.');
    names.add(file.path.toLowerCase());
  }
  for(const file of files){const parts=file.path.toLowerCase().split('/');parts.pop();while(parts.length){if(names.has(parts.join('/')))fail('파일과 폴더의 경로가 겹칩니다.');parts.pop();}}
  return files;
}
export function unpackSkillArchive(bytes) {
  if(!bytes.length||bytes.length>PACKAGE_LIMITS.archive)fail('ZIP은 5MB까지 업로드할 수 있습니다.');
  const attributes=checkZipDirectory(bytes);let files;
  try{files=unzipSync(bytes);}catch{fail('ZIP 파일을 읽지 못했습니다. 다시 압축해 주세요.');}
  return validateSkillFiles(Object.entries(files).filter(([path])=>!path.endsWith('/')).map(([path,bytes])=>({path,bytes,mode:(attributes.get(path)?.attrs>>>16)&0o111?'100755':'100644'})));
}
function checkZipDirectory(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0)fail('ZIP 파일이 손상되었거나 지원하지 않는 형식입니다.');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true);
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||count!==view.getUint16(end+8,true)||count>PACKAGE_LIMITS.count||start+size!==end)fail('파일이 200개 이하인 단일 ZIP을 선택하세요.');
  const names=new Set(),attributes=new Map();let offset=start,total=0;
  for(let i=0;i<count;i++){
    if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)fail('ZIP 파일 목록을 확인하지 못했습니다.');
    const length=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),expanded=view.getUint32(offset+24,true);
    if(offset+46+length+extra+comment>end)fail('ZIP 파일 목록이 손상되었습니다.');
    const path=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset+46,offset+46+length)),key=path.replace(/\/$/,'');
    const unixMode=view.getUint32(offset+38,true)>>>16;
    if(!safePath(key)||names.has(key.toLowerCase())||(unixMode&0xf000)===0xa000||view.getUint16(offset+8,true)&1)fail('중복 경로, 상위 경로, 심볼릭 링크, 암호화 파일은 업로드할 수 없습니다.');
    if(expanded>PACKAGE_LIMITS.file||(total+=expanded)>PACKAGE_LIMITS.expanded)fail('파일당 2MB, 압축 해제 후 전체 20MB 이하로 구성하세요.');
    attributes.set(path,{os:3,attrs:((unixMode&0o111)?0o755:0o644)<<16});
    names.add(key.toLowerCase());offset+=46+length+extra+comment;
  }
  if(offset!==end)fail('ZIP 파일 목록이 손상되었습니다.');
  return attributes;
}
export async function inspectSkillPackage(file) {
  if(!file||file.size<=0||file.size>PACKAGE_LIMITS.archive)fail('5MB 이하의 SKILL.md 또는 ZIP 파일을 선택하세요.');
  let bytes=new Uint8Array(await file.arrayBuffer()),files;
  if(isSkillMarkdown(file.name)){
    if(bytes.length>PACKAGE_LIMITS.markdown)fail('SKILL.md는 512KB 이하로 작성하세요.');
    files={'SKILL.md':bytes};bytes=zipSync(files,{level:6,mtime:new Date('2020-01-01T00:00:00Z')});
  }else if(/\.zip$/i.test(file.name)){
    checkZipDirectory(bytes);
    try{files=unzipSync(bytes);}catch{fail('ZIP 파일을 읽지 못했습니다. 다시 압축해 주세요.');}
  }else fail('SKILL.md 또는 ZIP 파일을 선택하세요.');
  const names=Object.keys(files).filter(path=>!path.endsWith('/'));
  const entries=names.filter(isPackageEntry);
  if(entries.length!==1)fail('ZIP 최상위 또는 하나의 스킬 폴더 안에 SKILL.md가 있어야 합니다.');
  const entry=entries[0],prefix=entry.slice(0,-8);
  if(names.some(path=>!path.startsWith(prefix)))fail('모든 파일을 SKILL.md와 같은 스킬 폴더 안에 넣으세요.');
  if(names.length>PACKAGE_LIMITS.count||names.some(path=>!safePath(path)||files[path].length>PACKAGE_LIMITS.file)||names.reduce((sum,path)=>sum+files[path].length,0)>PACKAGE_LIMITS.expanded)fail('패키지 파일 수와 크기 제한을 확인하세요.');
  if(files[entry].length>PACKAGE_LIMITS.markdown)fail('SKILL.md는 512KB 이하로 작성하세요.');
  let markdown;try{markdown=new TextDecoder('utf-8',{fatal:true}).decode(files[entry]);}catch{fail('SKILL.md는 UTF-8로 저장하세요.');}
  const meta=readSkillMarkdown(markdown);
  return {...meta,bytes,hash:await sha256(bytes),filename:`${meta.name}.zip`,files:names.map(path=>({path:path===entry?'SKILL.md':path.slice(prefix.length),size:files[path].length})).sort((a,b)=>a.path.localeCompare(b.path))};
}

export function downloadBytes(bytes,filename) {
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),anchor=document.createElement('a');
  anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

// Downloads always contain one skill-name folder, regardless of the uploaded ZIP layout.
// Stored bytes and their digest remain the original upload. Exports use the canonical SKILL.md name.
export function installationArchive(pkg) {
  const attributes=checkZipDirectory(pkg.bytes);
  const entries=unzipSync(pkg.bytes),paths=Object.keys(entries).filter(path=>!path.endsWith('/'));
  const entry=paths.find(isPackageEntry),prefix=entry.slice(0,-8);
  return zipSync(Object.fromEntries(paths.map(path=>[`${pkg.name}/${path===entry?'SKILL.md':path.slice(prefix.length)}`,[entries[path],{...attributes.get(path),mtime:new Date('2020-01-01T00:00:00Z')}]])),{level:6});
}

// Caller verifies the package identity/hash before publishing these files.
export function skillPackageFiles(pkg) {
  const attributes=checkZipDirectory(pkg.bytes),entries=unzipSync(pkg.bytes);
  const paths=Object.keys(entries).filter(path=>!path.endsWith('/'));
  const entry=paths.find(isPackageEntry),prefix=entry.slice(0,-8);
  return paths.map(path=>({path:path===entry?'SKILL.md':path.slice(prefix.length),bytes:entries[path],mode:(attributes.get(path).attrs>>>16)&0o111?'100755':'100644'}));
}
