import {previewRequest} from './preview-request.mjs';
// Bound both image count and base64 character retention. Pending/late reads must
// not replace a newer reader's result or leave a permanent loading thumbnail.
export function createCaptureCache({maxEntries=12,maxChars=16*1024*1024,timeoutMs=15000}={}){
 let reader=null,generation=0;const cache=new Map();
 const trim=()=>{let chars=[...cache.values()].reduce((sum,entry)=>sum+(entry.src?.length||0),0);for(const [id,entry] of cache){if(cache.size<=maxEntries&&chars<=maxChars)break;chars-=entry.src?.length||0;cache.delete(id);}};
 return {
  configure(api){if(reader!==api){reader=api;generation++;cache.clear();}},
  invalidate(id){cache.delete(id);},
  load(id){
   if(cache.has(id))return cache.get(id).promise;
   const currentReader=reader,epoch=generation,entry={};
   entry.promise=previewRequest(()=>{if(!currentReader)throw Error('capture_missing');return currentReader('capture',{id});},timeoutMs).then(record=>{
    if(epoch!==generation||!record||typeof record.image!=='string'||!record.image.startsWith('iVBORw0KGgo')||record.image.length>Math.ceil(8*1024*1024*4/3))throw Error('capture_invalid');
    const src='data:image/png;base64,'+record.image;
    if(cache.get(id)===entry){entry.src=src;trim();}return src;
   }).catch(()=>{if(cache.get(id)===entry)cache.delete(id);return null;});
   cache.set(id,entry);trim();return entry.promise;
  }
 };
}
