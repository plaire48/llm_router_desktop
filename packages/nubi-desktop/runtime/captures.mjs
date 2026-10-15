import {randomUUID} from 'node:crypto';
import {fail} from './files.mjs';

// Screenshots the user attached from the Workspace window itself (user request 2026-10-14). The PNG stays in its own
// record; the task, the inbox item and the message keep only the id and the size, so state snapshots stay small.
const LIMIT=3,BYTES=4*1024*1024;
export function storeCaptures(service,taskId,captures=[],{maxBytes=BYTES}={}){
  if(!Array.isArray(captures)||captures.length>LIMIT)fail('capture_invalid');
  return captures.map(item=>{
    if(!item||typeof item.image!=='string'||!item.image||item.image.length>maxBytes*4/3||!/^[A-Za-z0-9+/=]+$/.test(item.image)||!Number.isSafeInteger(item.width)||!Number.isSafeInteger(item.height)||item.width<1||item.height<1||item.width>8000||item.height>8000)fail('capture_invalid');
    const record={id:randomUUID(),taskId,image:item.image,width:item.width,height:item.height,createdAt:new Date().toISOString()};
    service.store.set('capture:'+record.id,record);
    return {id:record.id,width:record.width,height:record.height};
  });
}
export function readCapture(service,id){
  const record=typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)?service.store.get('capture:'+id):null;
  if(!record)fail('capture_missing');
  return record;
}

// Keep the exact host image separately from the compact trace/message reference.
export function storeAgentCapture(service,taskId,runId,shot,kind){
  const [stored]=storeCaptures(service,taskId,[shot],{maxBytes:8*1024*1024});
  const label=kind==='web'?'웹 캡처':'앱 화면 캡처';
  const title=String(shot.title||'').replace(/[\r\n\t]+/g,' ').trim().slice(0,160);
  const reference={...stored,kind,label:title?`${label}: ${title}`:label,...(shot.clip?{region:true}:{})};
  const record=readCapture(service,stored.id);service.store.set('capture:'+stored.id,{...record,runId,...reference});
  return reference;
}
