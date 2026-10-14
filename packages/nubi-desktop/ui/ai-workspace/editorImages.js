// Clipboard files and picker files use the same image validation path.
export const EDITOR_IMAGE_ACCEPT='image/png,image/jpeg,image/gif,image/webp';
export const EDITOR_IMAGE_LIMIT=10*1024*1024;
const extensions={ 'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp' };
export function transferredFiles(transfer) {
  if(!transfer)return [];
  const files=Array.from(transfer.files||[]);
  if(files.length)return files;
  return Array.from(transfer.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
}
export async function editorImageFile(file) {
  if(!file?.size)throw Error('빈 이미지는 추가할 수 없습니다.');
  if(file.size>EDITOR_IMAGE_LIMIT)throw Error('이미지는 한 장당 10MB까지 추가할 수 있습니다.');
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const text=new TextDecoder();
  const mime=[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)?'image/png':
    bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
    /^GIF8[79]a$/.test(text.decode(bytes.slice(0,6)))?'image/gif':
    text.decode(bytes.slice(0,4))==='RIFF'&&text.decode(bytes.slice(8,12))==='WEBP'?'image/webp':null;
  if(!mime)throw Error('PNG, JPG, GIF, WebP 이미지만 추가할 수 있습니다.');
  if(file.type&&file.type!=='application/octet-stream'&&file.type!==mime)throw Error('이미지 형식을 확인하세요.');
  const name=(file.name||'붙여넣은 이미지').replace(/[\x00-\x1f/\\]/g,'_').replace(/\.[^.]*$/,'').slice(0,180);
  return new File([file],`${name||'이미지'}.${extensions[mime]}`,{type:mime,lastModified:file.lastModified});
}
