import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openOfficeProcess} from './external-office-process.mjs';
import {registerNativeOfficeConnection,nativeOfficeStatus,cancelNativeOffice} from './native-office-host.mjs';

// Only the Electron main process can route this manager's actions. No model
// tool, renderer registration callback, native path or network endpoint exists.
async function openBundledOffice(options){
 if(process.platform!=='win32')throw Error('native_office_windows_required');
 const root=fileURLToPath(new URL('./external-office-native/',import.meta.url)).replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2');let manifest;
 try{manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));}catch{throw Error('native_office_host_missing');}
 const required=['Nubi.OfficeBridge.exe','OfficeX.Core.dll','OfficeX.ExcelHost.dll','Newtonsoft.Json.dll'];
 if(manifest.schemaVersion!==1||required.some(name=>!manifest.files?.[name]))throw Error('native_office_host_invalid');
 for(const name of required){const bytes=await readFile(path.join(root,name)).catch(()=>{throw Error('native_office_host_missing');});if(createHash('sha256').update(bytes).digest('hex')!==manifest.files[name])throw Error('native_office_host_changed');}
 return openOfficeProcess({...options,executable:path.join(root,'Nubi.OfficeBridge.exe')});
}
export class ExternalOffice{
 constructor({open=openBundledOffice,selectionMs=600000}={}){this.open=open;this.selectionMs=selectionMs;this.selections=new Map();this.connections=new Map();this.opening=new Set();this.disposed=false;this.navigation=0;}
 owner(service,args){service.ready();if(this.disposed||args.projectId!==service.projectId)throw Error('native_office_scope_changed');if(args.taskId){service.task(args.taskId);if(!['status','cancel'].includes(args.action)&&(service.agentForTask?.(args.taskId)?.running||this.connections.get(this.key(service,args.taskId))?.saving||['proposed','approved','executing'].includes(service.task(args.taskId).nativeOffice?.state)))throw Error('native_office_busy');}}
 key(service,taskId){return service.projectId+':'+taskId;}
 drop(token){const item=this.selections.get(token);if(!item)return;this.selections.delete(token);clearTimeout(item.timer);item.host.close();}
 pruneSelections(current){this.navigation++;for(const [token,item]of this.selections){let stale=item.service!==current||item.service.disposed||item.store!==item.service.store;try{if(item.taskId)item.service.task(item.taskId);}catch{stale=true;}if(stale)this.drop(token);}}
 async request(service,args={}){
  this.owner(service,args);const {action,taskId}=args;
  if(action==='status')return taskId?nativeOfficeStatus(service,taskId):{connected:false};
  if(action==='preview'){
   if(!['word','excel','powerpoint'].includes(args.app))throw Error('native_office_app_invalid');
   const key=this.key(service,taskId||'draft');if(this.opening.has(key))throw Error('native_office_busy');this.opening.add(key);
   let host,token=randomUUID();const store=service.store,projectId=service.projectId,navigation=this.navigation;
   try{
    host=await this.open({app:args.app,onExit:()=>{
     const selected=this.selections.get(token);if(selected){this.selections.delete(token);clearTimeout(selected.timer);}
     for(const [boundKey,entry]of this.connections)if(entry.host===host){this.connections.delete(boundKey);if(!service.disposed&&service.store===store)cancelNativeOffice(service,entry.taskId);}
    }});
    if(this.disposed||service.disposed||service.store!==store||service.projectId!==projectId||navigation!==this.navigation)throw Error('native_office_scope_changed');
    for(const [old,item]of this.selections)if(item.service===service&&item.taskId===(taskId||null))this.drop(old);
    const item={host,service,store,taskId:taskId||null,staged:false,timer:setTimeout(()=>this.drop(token),this.selectionMs)};item.timer.unref?.();this.selections.set(token,item);
    return host.selectionRequired?{token,app:host.app,documents:host.documents,connected:false}:{token,document:{app:host.app,documentTitle:host.documentTitle,documentId:host.documentId,officeVersion:host.officeVersion},connected:false};
   }catch(error){host?.close();throw error;}finally{this.opening.delete(key);}
  }
  if(action==='cancel'){const item=this.selections.get(args.token);if(item&&item.service===service)this.drop(args.token);return {cancelled:true};}
  if(action==='select'){
   const item=this.selections.get(args.token),store=service.store,navigation=this.navigation;
   if(!item||item.service!==service||item.store!==store||item.taskId!==(taskId||null)||!item.host.isAlive()||!item.host.selectionRequired||item.selecting)throw Error('native_office_selection_changed');
   if(!item.host.documents?.some(row=>row.candidateId===args.candidateId))throw Error('native_office_selection_changed');
   item.selecting=true;
   try{
    await item.host.call('bind_document',{candidateId:args.candidateId});
    if(this.disposed||service.disposed||service.store!==store||navigation!==this.navigation||this.selections.get(args.token)!==item||!item.host.isAlive())throw Error('native_office_selection_changed');
    return {token:args.token,document:{app:item.host.app,documentTitle:item.host.documentTitle,documentId:item.host.documentId,officeVersion:item.host.officeVersion},connected:false};
   }catch(error){this.drop(args.token);throw error;}finally{item.selecting=false;}
  }
  if(action==='stage'||action==='attach'){
   const item=this.selections.get(args.token);
   if(!item||item.service!==service||item.store!==service.store||item.taskId&&item.taskId!==taskId||!item.host.isAlive())throw Error('native_office_selection_changed');
   if(item.selecting||item.host.selectionRequired)throw Error('native_office_selection_required');
   if(action==='stage'){if(item.taskId||taskId)throw Error('native_office_selection_changed');item.staged=true;return {token:args.token,document:{app:item.host.app,documentTitle:item.host.documentTitle},staged:true};}
   if(!taskId||!item.taskId&&!item.staged)throw Error('native_office_selection_changed');
   const key=this.key(service,taskId),host=item.host;
   const result=registerNativeOfficeConnection(service,{...host,scope:{projectId:service.projectId,taskId},close:()=>{if(this.connections.get(key)?.host===host)this.connections.delete(key);host.close();}},{newEpoch:true});
   this.selections.delete(args.token);clearTimeout(item.timer);this.connections.set(key,{host,taskId,service});
   return {connected:true,...result};
  }
  if(!taskId)throw Error('native_office_task_required');
  const key=this.key(service,taskId),entry=this.connections.get(key);
  if(action==='disconnect'){cancelNativeOffice(service,taskId);return {connected:false};}
  if(action==='window'){if(!entry?.host.isAlive())throw Error('native_office_not_available');return entry.host.call('window_identity',{});}
  if(action==='checkpoints'){
   if(!entry?.host.isAlive())throw Error('native_office_not_available');
   const rows=await entry.host.call('list_checkpoints',{});entry.checkpoints=new Set((Array.isArray(rows)?rows:[]).map(row=>row.id));return {checkpoints:Array.isArray(rows)?rows:[]};
  }
  if(action==='restore'){
   if(!entry?.host.isAlive()||!entry.checkpoints?.has(args.checkpointId)||args.confirmed!==true)throw Error('native_office_restore_scope');
   const claim='office-restore:'+args.checkpointId;if(service.store.get(claim))throw Error('native_office_restore_already_requested');
   service.store.set(claim,{state:'issued',taskId});entry.saving=true;service.unsettledOperations ||=new Set();service.unsettledOperations.add(claim);
   try{const receipt=await entry.host.call('restore_checkpoint',{checkpointId:args.checkpointId});service.store.set(claim,{state:receipt?.status==='verified'?'verified':'attention',taskId,receipt});cancelNativeOffice(service,taskId);return receipt;}
   catch(error){service.store.set(claim,{state:'attention',taskId});throw error;}finally{entry.saving=false;service.unsettledOperations.delete(claim);}
  }
  if(action==='save'){
   const task=service.task(taskId),record=task.nativeOffice;
   if(!entry?.host.isAlive()||record?.outcome?.receipt?.status!=='verified_unsaved'||record?.outcome?.writeResultUncertain)throw Error('native_office_verification_required');
   if(record.saveReceipt?.saved||record.saveUncertain||entry.saving)throw Error('native_office_save_already_requested');
   entry.saving=true;const operation='office-save:'+randomUUID();service.unsettledOperations ||=new Set();service.unsettledOperations.add(operation);task.nativeOffice={...record,saveUncertain:true};service.store.set('task:'+taskId,task);
   try{
    const receipt=await entry.host.call('save_document',{});
    if(service.disposed||this.connections.get(key)!==entry)throw Error('native_office_scope_changed');
    const current=service.task(taskId);current.nativeOffice={...current.nativeOffice,saveReceipt:receipt,saveUncertain:!(receipt?.saved===true&&receipt?.status==='verified')&&receipt?.status!=='rejected'};service.store.set('task:'+taskId,current);return receipt;
   }finally{entry.saving=false;service.unsettledOperations.delete(operation);}
  }
  throw Error('native_office_method_invalid');
 }
 dispose(){this.disposed=true;for(const token of [...this.selections.keys()])this.drop(token);for(const {host}of this.connections.values())host.close();this.connections.clear();}
}
