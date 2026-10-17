import {createMonacoEditorPort} from '../../nubi-document-agent/src/editor-adapters.ts';
// One renderer-owned buffer. Replies are scoped by an opaque host token, never by a model-supplied path.
export async function connectBuffer({api,projectId,buffer,getEditor,isCurrent,registration:provided}){
 if(!buffer?.model||buffer.readOnly||buffer.model.isDisposed())throw Error('editor_open_writable_file');
 const model=buffer.model,registration=provided||await api('liveEditor',{action:'connect',projectId,app:'monaco',documentId:buffer.draft?buffer.key:buffer.path});
 let closed=false,timer,busy=false,lastDirty;const controller=new AbortController();
 const call=args=>api('liveEditor',{projectId,token:registration.token,...args});
 const adapterEditor={getModel:()=>model,getSelection:()=>{const e=getEditor();return e?.getModel?.()===model?e.getSelection():null;},pushUndoStop:()=>{model.pushStackElement();return true;},executeEdits:(_source,edits)=>{model.pushEditOperations([],edits,()=>null);return true;}};
 const port=createMonacoEditorPort({connectionId:registration.binding.connectionId,documentId:registration.binding.documentId,editor:adapterEditor,isConnected:()=>!closed&&isCurrent()&&!model.isDisposed(),readOnly:()=>!!buffer.readOnly,dirty:()=>buffer.dirty});
 async function stop(){if(closed)return;closed=true;controller.abort();clearTimeout(timer);await call({action:'disconnect'}).catch(()=>{});}
 async function poll(){if(closed||busy)return;if(!isCurrent()||model.isDisposed()){await stop();return;}busy=true;
  try{if(lastDirty!==buffer.dirty){await call({action:'bufferState',dirty:buffer.dirty});lastDirty=buffer.dirty;}const {requests}=await call({action:'poll'});for(const r of requests){let value,error;try{value=r.operation==='inspect'?await port.inspect(controller.signal):r.operation==='replace'?await port.replaceIfCurrent(r.args.before,r.args.patch,controller.signal):null;if(!value)throw Error('editor_operation_invalid');}catch{error='editor_adapter_failed';}await call({action:'reply',id:r.id,value,error});}}
  catch{await stop();}finally{busy=false;if(!closed)timer=setTimeout(poll,250);}
 }
 void poll();return {...registration,attach:async taskId=>{const result=await call({action:'attach',taskId});lastDirty=undefined;return result;},disconnect:stop};
}
