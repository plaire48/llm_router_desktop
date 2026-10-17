import {createPdfEditorPort} from '../ui/pdf-editor-port.mjs';
export async function connectPdfBuffer({api,projectId,buffer,isCurrent}){
 if(!buffer?.pdfEndpoint?.session?.fields.length||buffer.absolute)throw Error('editor_open_writable_file');
 const registration=await api('liveEditor',{action:'connect',projectId,app:'pdf',documentId:buffer.path,sourceHash:buffer.hash,taskId:buffer.taskId});
 const session=buffer.pdfEndpoint.session,controller=new AbortController();let closed=false,timer,lastDirty;
 const call=args=>api('liveEditor',{projectId,token:registration.token,...args});
 const current=()=>!closed&&isCurrent()&&buffer.pdfEndpoint?.session===session;
 const port=createPdfEditorPort({binding:registration.binding,endpoint:()=>buffer.pdfEndpoint,isCurrent:current,dirty:()=>buffer.dirty});
 async function stop(){if(closed)return;closed=true;controller.abort();clearTimeout(timer);await call({action:'disconnect'}).catch(()=>{});}
 async function poll(){if(!current()){await stop();return;}try{
  if(lastDirty!==buffer.dirty){await call({action:'bufferState',dirty:buffer.dirty});lastDirty=buffer.dirty;}
  const {requests}=await call({action:'poll'});
  for(const r of requests){let value,error;try{value=r.operation==='inspect'?await port.inspect(controller.signal):r.operation==='replace'?await port.replaceIfCurrent(r.args.before,r.args.patch,controller.signal):null;if(!value)throw Error();}catch{error='editor_adapter_failed';}await call({action:'reply',id:r.id,value,error});}
 }catch{await stop();}finally{if(!closed)timer=setTimeout(poll,250);}}
 void poll();return {...registration,attach:async taskId=>{const result=await call({action:'attach',taskId});lastDirty=undefined;return result;},disconnect:stop};
}
