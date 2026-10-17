import {excelDraftReads,buildNativeExcelDraft} from './native-excel-draft.mjs';
import {applyNativeOfficeDraft} from './native-office-draft.mjs';
import {nativeDocumentPreview} from './native-document-preview.mjs';
import {nativeExcelPreview} from './native-excel-preview.mjs';
import {randomUUID} from 'node:crypto';
import {createNativeOfficeSkill,nativeOfficeToolDefinitions} from '../generated/document-agent-native.mjs';
import {toolArgumentView} from './tool-argument-view.mjs';
import {makeQuestion} from '../../../extensions/aipro-chat/user-question.js';
import {hash,fail} from './files.mjs';

// Trusted in-process native host injection only. This is deliberately absent
// from ProjectService.invoke and renderer IPC. No A2A listener or file fallback.
const hosts=new WeakMap();
const rows=service=>{let map=hosts.get(service.store);if(!map){map=new Map();hosts.set(service.store,map);}return map;};
const binding=c=>({environment:c.environment,app:c.app,scope:c.scope,documentId:c.documentId,officeSessionId:c.officeSessionId,...(typeof c.documentTitle==='string'?{documentTitle:c.documentTitle.slice(0,300)}:{})});
const digest=c=>hash(JSON.stringify(binding(c)));
const blocked=r=>r?.writeLocked===true||r?.outcome?.writeResultUncertain===true;
const now=()=>new Date().toISOString();
const save=(service,task,record)=>{task.nativeOffice=structuredClone(record);const current=service.task(task.id);current.nativeOffice=task.nativeOffice;service.store.set('task:'+task.id,current);};
export const NATIVE_OFFICE_TOOLS=new Set(['native_office_status','inspect_native_office','write_native_office','finish_native_office']);
export function registerNativeOfficeConnection(service,connection,{allowFixture=false,newEpoch=false}={}){
 service.ready();if(connection?.environment==='fixture'&&!allowFixture)fail('native_office_fixture_forbidden');
 if(!['fixture','windows-office'].includes(connection?.environment)||!['word','excel','powerpoint'].includes(connection?.app)||typeof connection.call!=='function')fail('native_office_connection_invalid');
 const task=service.task(connection.scope?.taskId);if(connection.scope?.projectId!==service.projectId)fail('native_office_scope_changed');
 const map=rows(service),old=map.get(task.id);if(old)cancelNativeOffice(service,task.id);
 const store=service.store,identity=digest(connection),generation=randomUUID(),nativeCall=connection.call.bind(connection);
 const entry={connection,generation,identity,store,task,approved:false};
 const alive=signal=>{signal?.throwIfAborted();if(service.disposed||service.store!==store||service.projectId!==connection.scope.projectId||map.get(task.id)!==entry||digest(connection)!==identity)fail('native_office_binding_changed');if(service.task(task.id).state==='cancelled')fail('native_office_cancelled');};
 entry.alive=alive;
 entry.nativeConnection={...binding(connection),scope:structuredClone(connection.scope),call:async(name,input,signal)=>{
  alive(signal);if(name==='execute_office_operations'&&!entry.approved)fail('native_office_approval_required');
  // Keep the shared host lock until the underlying native call actually settles,
  // even if the skill returns early after cancellation.
  const token='native-office:'+generation+':'+randomUUID();const mutation=name==='execute_office_operations';
  if(mutation){service.unsettledOperations ||=new Set();service.unsettledOperations.add(token);}
  try{const result=await nativeCall(name,input,signal);alive(signal);return result;}
  finally{if(mutation)service.unsettledOperations.delete(token);}
 }};
 entry.session=createNativeOfficeSkill(entry.nativeConnection);
 map.set(task.id,entry);
 let prior=task.nativeOffice;
 // Explicitly selecting a document for another edit may start a new epoch only
 // after the prior write AND finish were verified. An uncertain receipt is
 // retained across reconnects and never grants this exception.
 if(newEpoch&&prior?.outcome?.finished===true&&prior.outcome.receipt?.status==='verified_unsaved'&&!prior.outcome.writeResultUncertain&&!prior.saveUncertain){
  prior={history:[...(prior.history||[]),{generation:prior.generation,binding:prior.binding,outcome:prior.outcome,saveReceipt:prior.saveReceipt}].slice(-10),writeLocked:false};
 }
 save(service,task,{...prior,binding:structuredClone(binding(connection)),generation,state:blocked(prior)?'attention':'connected',pending:null,connectedAt:now()});
 return {generation,...binding(connection)};
}
export function nativeOfficeStatus(service,taskId){
 const task=service.task(taskId),entry=rows(service).get(taskId);let connected=false;try{entry?.alive();connected=!!entry;}catch{}
 return {connected,apps:['word','excel','powerpoint'],...(task.nativeOffice||{}),instruction:connected?'Only this task-bound open Office document is available. Changes need one-time approval, native approval and readback. Saved='+(task.nativeOffice?.saveReceipt?.saved===true?'true (separate host save receipt)':task.nativeOffice?.saveUncertain?'unconfirmed':'false')+'. Uncertain effects permit observation only.':'No native Office host is connected. Connect a trusted host with an open document; do not parse NASCA files, launch Office through shell, or claim a native write.'};
}
export function nativeOfficeDefinitions(service,taskId){
 const status={type:'function',function:{name:'native_office_status',description:'Read bound Office status.',parameters:{type:'object',properties:{},additionalProperties:false}}};
 const entry=rows(service).get(taskId),task=service.task(taskId);
 if(!entry&&!task.nativeOffice&&!/word|excel|powerpoint|ppt|docx|xlsx|오피스|엑셀|워드|파워포인트|문서\s*(작성|수정|편집)|native/i.test([task.request,...(task.messages||[]).filter(m=>m.role==='user').slice(-1).map(m=>m.content)].join(' ')))return [];
 return [status,...(entry?nativeOfficeToolDefinitions(entry.connection.app).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}})):[])];
}
function activeSkill(entry,record){
 if(blocked(record)&&record?.outcome?.receipt?.status!=='verified_unsaved'){entry.reader ||=createNativeOfficeSkill(entry.nativeConnection);return entry.reader;}
 return entry.session;
}
export function filterNativeOfficeTools(service,taskId,definitions){
 const entry=rows(service).get(taskId),record=service.task(taskId).nativeOffice;
 let names=[];try{entry?.alive();if(entry)names=activeSkill(entry,record).skill.tools.map(t=>t.name);}catch{}
 if(blocked(record))names=names.filter(n=>n!=='write_native_office');
 if(['proposed','approved','executing'].includes(record?.state))names=[];
 return definitions.filter(d=>!NATIVE_OFFICE_TOOLS.has(d.function.name)||d.function.name==='native_office_status'||names.includes(d.function.name));
}
export function nativeOfficeGuidance(service,taskId){
 return rows(service).get(taskId)?.session.skill.systemPrompt||'';
}
function nativeDraftQuestion(entry,args,pending){
   const app={word:'Word',excel:'Excel',powerpoint:'PowerPoint'}[entry.connection.app];
   const view=toolArgumentView({...(entry.connection.documentTitle?{documentTitle:entry.connection.documentTitle.slice(0,300)}:{}),documentId:entry.connection.documentId,officeSessionId:entry.connection.officeSessionId,environment:entry.connection.environment,...structuredClone(args)},{limit:40000});
   if(view.omitted)fail('native_office_approval_limit');
   const question={...makeQuestion(`${app} 문서의 변경을 실행할까요? 저장은 별도입니다.`,[],[],{choices:[{label:'실행',description:'이 문서의 표시된 변경을 한 번 실행'},{label:'취소',description:'변경하지 않음'}],inputMode:'none',selection:'single'}),nativeOfficeApproval:pending.id,documentTitle:entry.connection.documentTitle||entry.connection.documentId,...(entry.connection.app==='excel'?{excelPreview:{...nativeExcelPreview(entry.observation,args),...(pending.calculation?{calculation:pending.calculation}:{})}}:{documentPreview:nativeDocumentPreview(entry.connection.app,entry.observation,args)}),toolRequest:{serverId:app,tool:'문서 변경',arguments:view,scope:'bound_document_once'}};
   return question;
}
export async function executeNativeOffice(service,task,name,args,signal){
 if(name==='native_office_status')return nativeOfficeStatus(service,task.id);
 const entry=rows(service).get(task.id),record=service.task(task.id).nativeOffice;
 if(!entry)return {ok:false,error:'native_office_disconnected',actionIssued:false};
 try{
  entry.alive(signal);
  if(['proposed','approved','executing'].includes(record?.state))return {ok:false,error:'native_office_approval_pending',actionIssued:false};
  if(name==='write_native_office'){
   if(blocked(record))return {ok:false,error:'native_office_reconciliation_required',actionIssued:false,execution:'unconfirmed'};
   // The existing skill validates scope, observation, mutation checks and Excel
   // calculation expectations before presenting a concrete plan to the user.
   entry.session.validateWrite(args);
   const pending={id:randomUUID(),generation:entry.generation,args:structuredClone(args),hash:hash(JSON.stringify(args)),at:now()};
   const question=nativeDraftQuestion(entry,args,pending);
   entry.baseProposal=structuredClone(args);entry.draftChanges=new Map();
   save(service,task,{...record,state:'proposed',pending,revision:0});
   return {requiresUserInput:true,question};
  }
  const session=activeSkill(entry,record);
  if(!session.skill.tools.some(t=>t.name===name))return {ok:false,error:'native_office_phase_changed',actionIssued:false};
  const result=await session.skill.executeTool({id:randomUUID(),name,input:args},signal),output=JSON.parse(result.output);
  if(name==='inspect_native_office'&&!result.isError)entry.observation=structuredClone(output);
  if(name==='finish_native_office')save(service,task,{...record,state:result.isError?'attention':'verified_unsaved',outcome:entry.session.outcome()});
  return {...output,ok:!result.isError};
 }catch(error){return {ok:false,error:/^native_[a-z_]+$/.test(error.code||error.message)?error.code||error.message:'native_office_invalid_proposal',actionIssued:false,writeDispatched:false,recovery:'read_and_replan'};}
}
export function reviseNativeOfficeDraft(service,{taskId,questionId,approvalId,edits}){
 const task=service.task(taskId),record=task.nativeOffice,entry=rows(service).get(taskId);
 if(task.state!=='waiting_input'||task.question?.id!==questionId||record?.state!=='proposed'||record.pending?.id!==approvalId||!entry||!entry.baseProposal||service.agentForTask?.(taskId)?.running)fail('native_office_draft_changed');
 entry.alive();if(entry.draftController)fail('native_office_draft_busy');if(entry.connection.app==='excel')return reviseNativeExcelDraft(service,task,entry,record,{questionId,approvalId,edits});
 if(!Array.isArray(edits)||!edits.length)fail('native_office_draft_invalid');
 const changes=new Map(entry.draftChanges);for(const edit of edits){if(!edit||Object.keys(edit).some(k=>!['id','value'].includes(k)))fail('native_office_draft_invalid');changes.set(edit.id,edit);}
 const result=applyNativeOfficeDraft(entry.connection.app,entry.observation,entry.baseProposal,[...changes.values()]);entry.session.validateWrite(result.args);
 const pending={id:randomUUID(),generation:entry.generation,args:result.args,hash:result.hash,at:now()},revision=(record.revision||0)+1;
 const question={...nativeDraftQuestion(entry,result.args,pending),id:task.question.id,runId:task.question.runId,nativeRevision:revision};
 // Supersede the old plan atomically. Neither an old form nor a model turn can
 // execute the earlier fingerprint after the person changes the draft.
 task.question=question;task.nativeOffice={...record,state:'proposed',pending,revision,userEdited:true};service.store.set('task:'+taskId,task);entry.draftChanges=changes;
 return {question:structuredClone(question),nativeOffice:structuredClone(task.nativeOffice),actionIssued:false};
}

async function reviseNativeExcelDraft(service,task,entry,record,{questionId,approvalId,edits}){
 if(!Array.isArray(edits)||!edits.length||edits.length>100)fail('native_office_draft_invalid');
 const changes=new Map(entry.draftChanges),seen=new Set();for(const edit of edits){if(!edit||Object.keys(edit).some(k=>!['id','kind','value'].includes(k))||seen.has(edit.id))fail('native_office_draft_invalid');seen.add(edit.id);changes.set(edit.id,edit);}
 const reads=excelDraftReads(entry.observation,entry.baseProposal,[...changes.values()]),controller=new AbortController(),candidate=createNativeOfficeSkill(entry.nativeConnection);entry.draftController=controller;
 try{
  const response=await candidate.skill.executeTool({id:randomUUID(),name:'inspect_native_office',input:{steps:reads}},controller.signal),observation=JSON.parse(response.output);if(response.isError)fail('native_excel_observation_failed');
  if(JSON.stringify(observation.results.slice(0,entry.observation.results.length))!==JSON.stringify(entry.observation.results))fail('native_excel_source_changed');
  const base={...entry.baseProposal,observationId:observation.observationId},result=await buildNativeExcelDraft(observation,base,[...changes.values()],controller.signal);candidate.validateWrite(result.args);
  entry.alive(controller.signal);const current=service.task(task.id);if(current.state!=='waiting_input'||current.question?.id!==questionId||current.nativeOffice?.pending?.id!==approvalId)fail('native_office_draft_changed');
  const pending={id:randomUUID(),generation:entry.generation,args:result.args,hash:result.hash,calculation:result.calculation,at:now()},revision=(record.revision||0)+1;
  const previous=entry.observation;entry.observation=observation;let question;try{question={...nativeDraftQuestion(entry,result.args,pending),id:questionId,runId:current.question.runId,nativeRevision:revision};}catch(error){entry.observation=previous;throw error;}
  entry.session.dispose();entry.session=candidate;entry.baseProposal=base;entry.draftChanges=changes;
  current.question=question;current.nativeOffice={...current.nativeOffice,state:'proposed',pending,revision,userEdited:true};service.store.set('task:'+task.id,current);
  return {question:structuredClone(question),nativeOffice:structuredClone(current.nativeOffice),actionIssued:false};
 }catch(error){candidate.dispose();return {ok:false,error:/^native_[a-z_]+$/.test(error.code||error.message)?error.code||error.message:'native_excel_draft_failed',detail:typeof error.detail==='string'?error.detail.slice(0,800):undefined,actionIssued:false};}finally{if(entry.draftController===controller)entry.draftController=null;}
}
export function decideNativeOffice(service,task,text,approvalId){
 const record=service.task(task.id).nativeOffice,entry=rows(service).get(task.id);
 if(entry?.draftController)fail('native_office_draft_busy');
 if((record?.revision||0)>0&&approvalId!==record.pending?.id)fail('native_office_draft_changed');
 if(!['실행','취소'].includes(text)||record?.state!=='proposed'||!record.pending||task.question?.nativeOfficeApproval&&task.question.nativeOfficeApproval!==record.pending.id)fail('native_office_approval_changed');
 if(text==='실행'){
  try{entry?.alive();if(!entry||record.pending.generation!==entry.generation||record.pending.hash!==hash(JSON.stringify(record.pending.args)))fail('native_office_binding_changed');}
  catch{save(service,task,{...record,state:'cancelled',pending:null});return;}
 }
 save(service,task,{...record,state:text==='실행'?'approved':'cancelled',...(text==='취소'?{pending:null}:{}),decidedAt:now()});
 if(text==='취소'){entry?.session.dispose();rows(service).delete(task.id);entry?.connection.close?.();}
}
export async function continueNativeOffice(service,task,signal){
 const record=service.task(task.id).nativeOffice;if(!record||!['approved','executing'].includes(record.state))return;
 const entry=rows(service).get(task.id);
 if(record.state==='executing'){
  save(service,task,{...record,state:'attention',pending:null,writeLocked:true,outcome:{...record.outcome,status:'uncertain',finished:false,writeAttempted:true,writeResultUncertain:true,savedToOffice:false},error:'native_office_execution_unconfirmed'});return;
 }
 if(!entry||entry.generation!==record.pending?.generation||hash(JSON.stringify(record.pending.args))!==record.pending.hash){save(service,task,{...record,state:'cancelled',pending:null,error:'native_office_approval_expired'});return;}
 try{entry.alive(signal);}catch{save(service,task,{...record,state:'cancelled',pending:null});return;}
 task.trace ||= [];task.trace.push({id:record.pending.id,runId:service.agent?.runId,tool:'apply_native_office',status:'running',at:now(),arguments:toolArgumentView(record.pending.args),readOnly:false});
 const current=service.task(task.id);current.trace=task.trace;service.store.set('task:'+task.id,current);
 save(service,task,{...record,state:'executing'});entry.approved=true;
 try{
  const result=await entry.session.skill.executeTool({id:record.pending.id,name:'write_native_office',input:record.pending.args},signal),outcome=entry.session.outcome();
  if(rows(service).get(task.id)!==entry)return;
  const trace=task.trace.find(t=>t.id===record.pending.id);if(trace){trace.status=result.isError?'error':'done';trace.at=now();const current=service.task(task.id);current.trace=task.trace;service.store.set('task:'+task.id,current);}
  const output=JSON.parse(result.output),locked=outcome.writeAttempted&&output.recovery!=='read_and_replan';
  save(service,task,{...record,state:result.isError?(output.recovery==='read_and_replan'&&!locked?'connected':'attention'):'written',pending:null,writeLocked:locked,outcome,result:output,at:now()});
 }finally{entry.approved=false;}
}
export function cancelNativeOffice(service,taskId){
 const map=rows(service),entry=map.get(taskId),task=service.task(taskId),record=task.nativeOffice;
 entry?.draftController?.abort();const outcome=entry?.session.outcome();entry?.session.dispose();entry?.reader?.dispose();map.delete(taskId);entry?.connection.close?.();
 if(record?.pending?.id&&task.trace?.some(t=>t.id===record.pending.id)){task.trace=task.trace.map(t=>t.id===record.pending.id?{...t,status:'error',at:now()}:t);const current=service.task(taskId);current.trace=task.trace;service.store.set('task:'+taskId,current);}
 if(task.question?.nativeOfficeApproval){task.question=null;const current=service.task(taskId);current.question=null;service.store.set('task:'+taskId,current);}
 if(record)save(service,task,{...record,state:outcome?.writeResultUncertain?'attention':'cancelled',pending:null,...(outcome?.writeAttempted?{writeLocked:true,outcome}:{}),cancelledAt:now()});
}
export function disposeNativeOffice(service){if(!service.store)return;for(const taskId of [...rows(service).keys()])cancelNativeOffice(service,taskId);}
