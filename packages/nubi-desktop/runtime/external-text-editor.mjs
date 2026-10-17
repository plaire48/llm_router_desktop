import {openTextEditorProcess} from './text-editor-process.mjs';
import {registerEditor,revokeEditor} from './live-editor-host.mjs';
const hosts=new WeakMap();
export async function externalTextEditor(service,args,{open=openTextEditorProcess}={}){
 service.ready();if(args.projectId!==service.projectId)throw Error('editor_scope_changed');
 if(args.action==='cancel'){disposeExternalTextEditor(service);return {cancelled:true};}
 if(args.action==='list'){
  if(args.app!=='pdf')throw Error('editor_app_invalid');
  disposeExternalTextEditor(service);const store=service.store,owner={token:null},entry={host:null,app:args.app,store,owner};hosts.set(service,entry);
  const current=()=>!service.disposed&&service.store===store&&hosts.get(service)===entry;
  try{
   entry.host=await open({onExit:()=>{entry.closed=true;if(owner.token&&service.store===store)revokeEditor(service,owner.token);}});
   if(!current()||entry.closed||!entry.host.isAlive())throw Error('editor_scope_changed');
   const documents=await entry.host.call('list',{app:args.app});
   if(!current()||entry.closed||!entry.host.isAlive())throw Error('editor_scope_changed');
   if(!Array.isArray(documents)||documents.length>20||new Set(documents.map(row=>row.id)).size!==documents.length||documents.some(row=>typeof row.id!=='string'||!row.id||typeof row.title!=='string'||row.app!==args.app))throw Error('editor_selection_changed');
   entry.candidates=new Set(documents.map(row=>row.id));entry.timer=setTimeout(()=>{if(hosts.get(service)===entry)disposeExternalTextEditor(service);},300000);entry.timer.unref();return {documents};
  }catch(error){entry.host?.close();if(hosts.get(service)===entry)hosts.delete(service);throw error;}
 }
 const entry=hosts.get(service);if(!entry||entry.store!==service.store||!entry.host?.isAlive())throw Error('editor_disconnected');
 if(args.action==='select'){
  if(entry.selecting||!entry.candidates?.has(args.candidateId))throw Error('editor_selection_changed');entry.selecting=true;
  let selected;try{selected=await entry.host.call('bind',{candidateId:args.candidateId});}catch(error){if(hosts.get(service)===entry)disposeExternalTextEditor(service);throw error;}
  if(service.disposed||entry.store!==service.store||hosts.get(service)!==entry||entry.closed){entry.host.close();throw Error('editor_scope_changed');}let registration;
  const port={inspect:async signal=>{signal.throwIfAborted();return {...await entry.host.call('inspect'),binding:registration.binding};},replaceIfCurrent:async(before,patch,signal)=>{signal.throwIfAborted();return entry.host.call('replace',{before,patch});}};
  registration=registerEditor(service,{app:entry.app,mode:'external',documentId:args.candidateId,title:selected.title,readOnly:selected.snapshot.readOnly,port,close:()=>entry.host.close()});entry.owner.token=registration.token;clearTimeout(entry.timer);hosts.delete(service);return {...registration,readOnly:selected.snapshot.readOnly};
 }
 throw Error('editor_action_invalid');
}
export function disposeExternalTextEditor(service){const entry=hosts.get(service);hosts.delete(service);clearTimeout(entry?.timer);entry?.host?.close();}
