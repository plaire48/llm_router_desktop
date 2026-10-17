import {open} from 'node:fs/promises';
import {scopedFile,hash} from './files.mjs';
import {randomUUID} from 'node:crypto';
import {createEditorSession,createEditorSkill} from '../generated/document-agent-editors.mjs';
import {makeQuestion} from '../../../extensions/aipro-chat/user-question.js';
import {toolArgumentView} from './tool-argument-view.mjs';
const stores=new WeakMap(),drafts=new WeakMap();
const entries=s=>{let m=stores.get(s.store);if(!m){m=new Map();stores.set(s.store,m);}return m;};
const find=(s,id)=>[...entries(s).values()].find(e=>e.taskId===id);
const persist=(s,t,value)=>{t.liveEditor=structuredClone(value);const current=s.task(t.id);current.liveEditor=t.liveEditor;s.store.set('task:'+t.id,current);};
const uncertain=r=>r?.state==='executing'||['unconfirmed','verification_failed'].includes(r?.result?.status);
export const EDITOR_TOOLS=new Set(['read_editor_range','propose_editor_edit']);
export function editorStatus(s,taskId){const record=s.task(taskId).liveEditor,e=find(s,taskId);return {...record,connected:!!e&&!e.closed,saveStatus:record?.bufferState?.dirty===false?'buffer_clean':record?.bufferState?.dirty===true?'unsaved':'not_requested'};}
function close(e){e.closed=true;e.session?.disconnect();e.close?.();for(const item of e.requests.values())item.finish(Error('editor_disconnected'));e.requests.clear();}
function call(e,operation,args,signal){
 if(e.closed||signal.aborted)return Promise.reject(Error('editor_disconnected'));
 if(e.requests.size>=4)return Promise.reject(Error('editor_busy'));
 return new Promise((resolve,reject)=>{const id=randomUUID(),abort=()=>finish(Error('operation_cancelled')),timer=setTimeout(()=>finish(Error('editor_response_timeout')),15000);timer.unref?.();
 const finish=(error,value)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);e.requests.delete(id);error?reject(error):resolve(value);};
 e.requests.set(id,{id,operation,args,sent:false,finish});signal.addEventListener('abort',abort,{once:true});
 });
}
export async function liveEditor(s,args={}){
 s.ready();if(args.projectId!==s.projectId)throw Error('editor_scope_changed');
 if(args.action==='connect'){
  if(!['monaco','pdf'].includes(args.app)||typeof args.documentId!=='string')throw Error('editor_binding_invalid');
  if(args.app==='pdf'){
   const owner=s.store,projectId=s.projectId;
   if(!/\.pdf$/i.test(args.documentId))throw Error('editor_binding_invalid');
   const target=await scopedFile(await s.target(args.taskId),args.documentId),file=await open(target,'r');
   try{const stat=await file.stat();if(!stat.isFile()||stat.size>64*1024*1024)throw Error('editor_text_limit');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const part=await file.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)throw Error('editor_changed');offset+=part.bytesRead;}const after=await file.stat();if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||bytes.subarray(0,5).toString()!=='%PDF-'||hash(bytes)!==args.sourceHash)throw Error('editor_changed');}finally{await file.close();}
   if(s.store!==owner||s.projectId!==projectId)throw Error('editor_scope_changed');
   return registerEditor(s,{app:'pdf',documentId:args.documentId,title:args.documentId,mode:'internal'});
  }
  const draft=drafts.get(s.store)?.get(args.documentId);if(!draft)await s.read({path:args.documentId,taskId:args.taskId});
  return registerEditor(s,{app:'monaco',documentId:args.documentId,title:draft?.title||args.documentId,mode:'internal',taskId:args.taskId});
 }
 if(args.action==='status')return editorStatus(s,args.taskId);
 if(args.action==='disconnectTask'){const entry=find(s,args.taskId);if(!entry)return {disconnected:true};return liveEditor(s,{...args,action:'disconnect',token:entry.token});}
 const e=args.action==='draft'&&!args.token?find(s,args.taskId):entries(s).get(args.token);if(!e||e.closed)throw Error('editor_disconnected');
 if(args.action==='draft'){
  const owner=s.store;if(e.taskId&&(s.agentForTask?.(e.taskId)?.running||s.task(e.taskId).question||uncertain(s.task(e.taskId).liveEditor)))throw Error('editor_busy');
  const observed=await e.port.inspect(AbortSignal.timeout(15000));
  if(s.store!==owner||e.closed||entries(s).get(e.token)!==e||JSON.stringify(observed?.binding)!==JSON.stringify(e.binding))throw Error('editor_binding_changed');
  if(typeof observed.text!=='string'||observed.text.length>1000000||observed.text.includes('\0')||typeof observed.revision!=='string')throw Error('editor_snapshot_invalid');
  if((drafts.get(owner)?.size||0)>=64)throw Error('editor_connection_limit');
  const title=e.title.replace(/\.[^.]+$/,'')+'-draft.txt',registration=registerEditor(s,{app:'monaco',mode:'internal',documentId:'draft:'+randomUUID(),title});
  if(!drafts.has(owner))drafts.set(owner,new Map());drafts.get(owner).set(registration.binding.documentId,{title});
  return {...registration,draft:{text:observed.text,source:{title:e.title,app:e.binding.app,revision:observed.revision},formatPreserved:false}};
 }
 if(args.action==='bufferState'){
  if(!['boolean','string'].includes(typeof args.dirty)||typeof args.dirty==='string'&&args.dirty!=='unknown')throw Error('editor_snapshot_invalid');
  if(e.taskId){const t=s.task(e.taskId);persist(s,t,{...t.liveEditor,bufferState:{dirty:args.dirty,observedAt:new Date().toISOString()}});}return {accepted:true};
 }
 if(args.action==='poll'){const values=[...e.requests.values()].filter(r=>!r.sent);for(const r of values)r.sent=true;return {requests:values.map(({id,operation,args})=>({id,operation,args}))};}
 if(args.action==='reply'){const r=e.requests.get(args.id);if(!r||!r.sent)return {accepted:false};if(JSON.stringify(args.value??null).length>2100000)throw Error('editor_text_limit');r.finish(args.error?Error('editor_adapter_failed'):null,args.value);return {accepted:true};}
 if(args.action==='disconnect'){if(e.taskId&&s.agentForTask?.(e.taskId)?.running)throw Error('editor_busy');close(e);entries(s).delete(args.token);if(e.taskId){const task=s.task(e.taskId);persist(s,task,{...task.liveEditor,connected:false,state:uncertain(task.liveEditor)?'attention':'disconnected'});}return {disconnected:true};}
 if(args.action==='attach'){
  const t=s.task(args.taskId);if(e.taskId&&e.taskId!==t.id||s.agentForTask?.(t.id)?.running||t.question||uncertain(t.liveEditor))throw Error('editor_busy');
  const old=find(s,t.id);if(old&&old!==e){close(old);entries(s).delete(old.token);}
  e.session?.disconnect();e.taskId=t.id;e.session=createEditorSession(e.port,{projectId:s.projectId,taskId:t.id});
  persist(s,t,{connected:true,state:'connected',binding:e.binding,title:e.title,readOnly:e.readOnly});return editorStatus(s,t.id);
 }
 throw Error('editor_action_invalid');
}
// External connectors call this only after the person's one-use pairing action.
export function registerEditor(s,{app,documentId,title,mode,taskId,readOnly=false,port,close:closePort}){
 if(entries(s).size>=16)throw Error('editor_connection_limit');
 if(!['monaco','obsidian','pdf'].includes(app)||typeof documentId!=='string'||!documentId||documentId.length>4096)throw Error('editor_binding_invalid');
 const token=randomUUID(),connectionId=randomUUID(),binding={connectionId,documentId,app,mode};
 const e={token,binding,title:String(title||documentId).slice(0,300),requests:new Map(),closed:false,taskId:null,readOnly,close:closePort};
 const raw=port||{inspect:signal=>call(e,'inspect',{},signal),replaceIfCurrent:(before,patch,signal)=>call(e,'replace',{before,patch},signal)};
 e.port={inspect:signal=>raw.inspect(signal),replaceIfCurrent:async(before,patch,signal)=>{const operation='editor-write:'+randomUUID();s.unsettledOperations ||=new Set();s.unsettledOperations.add(operation);try{return await raw.replaceIfCurrent(before,patch,signal);}finally{s.unsettledOperations.delete(operation);}}};entries(s).set(token,e);
 return {token,binding,title:e.title};
}
export function editorDefinitions(s,taskId){const e=find(s,taskId);if(!e?.session||e.closed||['proposed','approved','executing','attention'].includes(s.task(taskId).liveEditor?.state))return [];return createEditorSkill(e.session,new AbortController().signal).tools.filter(t=>!e.readOnly||t.name==='read_editor_range').map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));}
export async function executeEditor(s,task,name,args,signal){
 const e=find(s,task.id);if(!e?.session||!editorDefinitions(s,task.id).some(d=>d.function.name===name))return {ok:false,error:'editor_disconnected'};
 try{
  if(name==='read_editor_range')return await e.session.read(args,signal);
  const proposal=await e.session.propose(args,signal);
  const view=toolArgumentView({document:e.title,...proposal.patch},{limit:40000});if(view.omitted)throw Error('editor_approval_limit');
  persist(s,task,{...s.task(task.id).liveEditor,state:'proposed',proposal});
  return {requiresUserInput:true,question:{...makeQuestion('이 문서의 선택한 부분을 수정할까요? 저장은 별도입니다.',[],[],{choices:[{label:'실행'},{label:'취소'}],inputMode:'none',selection:'single'}),editorApproval:proposal.approvalId,editorChange:{title:e.title,before:proposal.patch.oldText,after:proposal.patch.newText},toolRequest:{serverId:({monaco:'누비 편집기',obsidian:'Obsidian',pdf:'PDF'})[e.binding.app],tool:'문서 부분 수정',arguments:view,scope:'bound_document_once'}}};
 }catch(error){return {ok:false,error:/^(editor_|operation_)/.test(error.message)?error.message:'editor_operation_failed'};}
}
export function decideEditor(s,task,text){
 const r=s.task(task.id).liveEditor;if(!['실행','취소'].includes(text)||r?.state!=='proposed'||task.question?.editorApproval!==r.proposal?.approvalId)throw Error('editor_approval_changed');
 persist(s,task,{...r,state:text==='실행'?'approved':'connected',...(text==='취소'?{proposal:null}:{})});
 if(text==='취소'){const e=find(s,task.id);if(e){e.session?.disconnect();e.session=createEditorSession(e.port,{projectId:s.projectId,taskId:task.id});}}
}
export async function continueEditor(s,task,signal){
 const r=s.task(task.id).liveEditor;if(!['approved','executing'].includes(r?.state))return;
 if(r.state==='executing'){persist(s,task,{...r,state:'attention',result:{status:'unconfirmed',saveStatus:'not_requested'}});return;}
 const e=find(s,task.id);if(!e?.session||e.binding.connectionId!==r.binding.connectionId){persist(s,task,{...r,state:'disconnected',proposal:null});return;}
 let claimed=false;
 try{const result=await e.session.apply(r.proposal.approvalId,{
  policy:{authorize:async q=>q.approvalId===r.proposal.approvalId&&q.fingerprint===r.proposal.fingerprint&&s.task(task.id).liveEditor?.state==='approved'},
  claim:async p=>{const key='editor-claim:'+p.approvalId;if(s.store.get(key))return false;s.store.set(key,{taskId:task.id,fingerprint:p.fingerprint,state:'executing'});claimed=true;persist(s,task,{...r,state:'executing'});return true;},
  record:async(p,result)=>{s.store.set('editor-claim:'+p.approvalId,{taskId:task.id,fingerprint:p.fingerprint,result});persist(s,task,{...r,proposal:null,state:['verified','not_started'].includes(result.status)?'connected':'attention',result});}
 },signal);if(['verified','not_started'].includes(result.status)){e.session.disconnect();e.session=createEditorSession(e.port,{projectId:s.projectId,taskId:task.id});}return result;}catch(error){persist(s,task,{...r,proposal:null,state:claimed?'attention':'connected',result:{status:claimed?'unconfirmed':'not_started',saveStatus:'not_requested'},error:/^(editor_|operation_|approval_)/.test(error.message)?error.message:'editor_operation_failed'});}
}
export function disposeEditors(s,taskId){if(!s.store)return;for(const [token,e]of entries(s)){if(!taskId||e.taskId===taskId){close(e);entries(s).delete(token);}}}

export function cancelEditor(s,taskId){
 const task=s.task(taskId),record=task.liveEditor;if(!record)return;
 disposeEditors(s,taskId);persist(s,task,{...record,connected:false,proposal:null,state:uncertain(record)?'attention':'disconnected',...(record.state==='executing'?{result:{status:'unconfirmed',saveStatus:'not_requested'}}:{})});
}

// Trusted transport teardown also revokes a running connection; no new UI approval is needed to stop it.
export function revokeEditor(s,token){
 const e=entries(s).get(token);if(!e)return;close(e);entries(s).delete(token);
 if(e.taskId&&!s.disposed){let task;try{task=s.task(e.taskId);}catch{return;}const r=task.liveEditor;persist(s,task,{...r,connected:false,state:uncertain(r)?'attention':'disconnected'});}
}
