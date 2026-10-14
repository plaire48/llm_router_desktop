import {fromBase64,toBase64,sha256} from '../skills/skillPackage.js';

export const WORKSPACE_ICON_LIMIT=128*1024;
export const WORKSPACE_IMAGE_LIMIT=5*1024*1024;
export const workspaceIconPath=hash=>`data/workspace/icons/${hash}.json`;
export async function importWorkspaceImage(file) {
  if(!file||!file.size||file.size>WORKSPACE_IMAGE_LIMIT)throw Error('이미지는 5MB 이하로 선택하세요.');
  if(file.type&&!file.type.startsWith('image/')&&!/\.ico$/i.test(file.name||''))throw Error('이미지 파일을 선택하세요.');
  const source=URL.createObjectURL(file);
  try{
    const image=new Image();image.decoding='async';
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('이미지를 읽지 못했습니다. 다른 파일을 선택하세요.'));image.src=source;});
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>8192||image.naturalHeight>8192)throw Error('가로와 세로 8,192px 이하의 이미지를 선택하세요.');
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const context=canvas.getContext('2d');if(!context)throw Error('이미지를 준비하지 못했습니다.');
    const scale=Math.min(64/image.naturalWidth,64/image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale;
    context.drawImage(image,(64-width)/2,(64-height)/2,width,height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw Error('이미지를 준비하지 못했습니다.');
    return prepareWorkspaceIcon(new Uint8Array(await blob.arrayBuffer()));
  }finally{URL.revokeObjectURL(source);}
}
export function validateWorkspaceIcon(icon) {
  if(!icon||!/^[a-f\d]{64}$/.test(icon.hash)||icon.path!==workspaceIconPath(icon.hash)||!['image/x-icon','image/png'].includes(icon.mime)||!Number.isSafeInteger(icon.size)||icon.size<22||icon.size>WORKSPACE_ICON_LIMIT)throw Error('아이콘 정보를 확인하세요.');
  return icon;
}
export async function prepareWorkspaceIcon(bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>WORKSPACE_ICON_LIMIT)throw Error('아이콘은 128KB 이하의 ICO 또는 PNG 파일을 선택하세요.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let mime;
  if(bytes.slice(0,8).every((value,index)=>value===[137,80,78,71,13,10,26,10][index])){
    if(bytes.length<33||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452||!view.getUint32(16)||!view.getUint32(20)||view.getUint32(16)>256||view.getUint32(20)>256)throw Error('PNG 아이콘은 가로와 세로 256px 이하로 선택하세요.');
    mime='image/png';
  }else if(view.getUint16(0,true)===0&&view.getUint16(2,true)===1){
    const count=view.getUint16(4,true),end=6+16*count;
    if(count<1||count>32||end>bytes.length)throw Error('ICO 파일 형식을 확인하세요.');
    for(let index=0;index<count;index++){
      const start=6+16*index,length=view.getUint32(start+8,true),offset=view.getUint32(start+12,true);
      if(!length||offset<end||offset+length>bytes.length)throw Error('ICO 파일 내용을 확인하세요.');
    }
    mime='image/x-icon';
  }else throw Error('ICO 또는 PNG 파일을 선택하세요.');
  const hash=await sha256(bytes),descriptor={hash,path:workspaceIconPath(hash),mime,size:bytes.length},content=toBase64(bytes);
  return {descriptor,bytes,document:{schemaVersion:1,hash,mime,content},preview:`data:${mime};base64,${content}`};
}
export async function readWorkspaceIcon(document,descriptor) {
  validateWorkspaceIcon(descriptor);
  if(document?.schemaVersion!==1||document.hash!==descriptor.hash||document.mime!==descriptor.mime||typeof document.content!=='string'||document.content.length>Math.ceil(WORKSPACE_ICON_LIMIT/3)*4)throw Error('아이콘 파일 정보를 확인하세요.');
  let bytes;try{bytes=fromBase64(document.content);}catch{throw Error('아이콘 파일 내용을 확인하세요.');}
  const prepared=await prepareWorkspaceIcon(bytes);
  if(prepared.descriptor.hash!==descriptor.hash||prepared.descriptor.size!==descriptor.size||prepared.descriptor.mime!==descriptor.mime)throw Error('아이콘 파일이 변경되었습니다.');
  return prepared.preview;
}
