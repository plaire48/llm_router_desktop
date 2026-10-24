import {randomUUID} from 'node:crypto';
import {fail,hash,readSource} from './files.mjs';
import {shellProfiles,processInputRevision} from './processes.mjs';
import Ajv from 'ajv';
import {preferredShell} from './environment-inspection.mjs';
import {toolArgumentIssues} from '../../../extensions/aipro-chat/tool-validation.js';
import {checkpointBefore} from './checkpoints.mjs';
import {automaticCommandReason} from './approval-policy.mjs';

const text = maxLength => ({type:'string',minLength:1,maxLength});
export const SETUP_ACTION_SCHEMA = {
  type:'object',additionalProperties:false,
  properties:{title:{...text(120),description:'Short command title.'},kind:{type:'string',enum:['inspect','install','configure','build','start','verify','input'],description:'start runs an app/server; verify runs tests; input sends exact text to an observed interactive process.'},
    interactive:{type:'boolean',description:'Use a real PTY for commands that need terminal input.'},
    processId:text(80),processRevision:text(100),
    profile:{...text(40),description:'Omit: the user\'s chosen shell is used; another id is refused.'},
    script:{...text(16000),description:'ONE exact shell command string in the selected shell syntax.'},
    reason:{...text(1000),description:'Why it is needed.'},effects:{...text(1500),description:'Downloads, hooks and changes, one string.'},verification:{...text(1000),description:'How the result is checked, one string.'},
    privilege:{type:'string',enum:['user','administrator'],description:'Omit normally; administrator needs separate consent.'},privilegeReason:text(1000),
    references:{type:'array',minItems:0,maxItems:10,description:'path/hash pairs copied from this run\'s inspect_environment.references or read_source; [] only for a host-only check.',items:{type:'object',additionalProperties:false,properties:{path:text(1000),hash:text(100)},required:['path','hash']}}},
  required:['title','kind','script','reason','effects','verification','references']
};

const validate=new Ajv().compile(SETUP_ACTION_SCHEMA);

// Approval is not a shell sandbox. Keep model-described effects and the exact command visible.
// Models often send a list where one string is asked, null for an omitted field, or an extra field. Those shapes carry
// the same meaning, so they are normalised before validation instead of stopping the run (user report 2026-10-14).
export function normalizeSetupArgs(args){
  if(!args||typeof args!=='object'||Array.isArray(args))return args;
  // Unknown fields pass through untouched so the schema still rejects them (that rule is tested).
  const out={};for(const key of Object.keys(args))if(!(key in SETUP_ACTION_SCHEMA.properties))out[key]=args[key];
  const text=value=>typeof value==='string'?value:Array.isArray(value)&&value.every(item=>typeof item==='string'||typeof item==='number')?value.map(String).join('; '):value&&typeof value==='object'?JSON.stringify(value):typeof value==='number'?String(value):value;
  for(const key of Object.keys(SETUP_ACTION_SCHEMA.properties)){
    let value=args[key];if(value===null||value===undefined)continue;
    if(key==='script'){if(Array.isArray(value)&&value.every(item=>typeof item==='string')&&value.length===1)value=value[0];}
    else if(['title','reason','effects','verification','privilegeReason','profile'].includes(key))value=text(value);
    else if(key==='references'){if(!Array.isArray(value))value=[];value=value.filter(item=>item&&typeof item==='object'&&typeof item.path==='string'&&typeof item.hash==='string').map(item=>({path:item.path,hash:item.hash}));}
    else if(key==='kind'&&typeof value==='string')value=value.trim().toLowerCase();
    else if(key==='privilege'&&typeof value==='string')value=value.trim().toLowerCase();
    if(typeof value==='string'&&!(key==='script'&&String(args.kind).trim().toLowerCase()==='input'))value=value.trim();
    if(value===''||value===undefined)continue;
    out[key]=value;
  }
  return out;
}
// The shell the user picked in settings wins over the model's choice (user report 2026-10-14: CMD chosen, PowerShell used).
// A command written for another shell is sent back to be rewritten, not run in a shell it was not written for. Only an
// administrator action keeps PowerShell, the one shell that can ask Windows for elevation here.
export function requireChosenShell(profiles,chosen,profile,elevated=false){
  if(elevated||!chosen||profile===chosen||!profiles.some(p=>p.id===chosen))return;
  throw Object.assign(Error('shell_not_selected'),{details:{selectedShell:chosen,instruction:'The user chose this shell in settings. Rewrite the command in its syntax and omit profile.'},actionIssued:false});
}
export async function prepareSetupAction(service,taskId,args,observations,hostReferences=[],beforeCommit=()=>{}) {
  args=normalizeSetupArgs(args);
  if(!validate(args))throw Object.assign(Error('setup_invalid'),{details:{issues:toolArgumentIssues(SETUP_ACTION_SCHEMA,args)},actionIssued:false});
  if(service.task(taskId).question)fail('question_pending');
  const input=args.kind==='input',record=input?service.processes.records.get(args.processId):null;
  if(input){
    if(!record||record.taskId!==taskId||record.state!=='running'||!record.interactive||!service.processes.active.has(record.id)||args.script.length>8000||args.privilege==='administrator')fail('process_input_unavailable');
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(args.script))fail('process_input_invalid');
    if(observations?.processes?.get(record.id)!==args.processRevision)fail('process_input_observation_required');
    if(processInputRevision(record)!==args.processRevision)fail('process_input_changed');
    args={...args,profile:record.profile};
  }else if(args.processId||args.processRevision)fail('setup_invalid');
  const profiles=await shellProfiles();args={...args,profile:args.profile||preferredShell(profiles,process.platform,service.shellPreference())};
  if(!input)requireChosenShell(profiles,service.shellPreference(),args.profile,args.privilege==='administrator');
  if(args.privilege==='administrator'){
    if(process.platform!=='win32'||args.profile!=='powershell')fail('elevation_unavailable');
    if(!args.privilegeReason||args.script.length>3000||args.kind==='start'||args.interactive)fail('elevation_command_limit');
  }
  const workspace=await service.target(taskId);
  if(!profiles.some(p=>p.id===args.profile))fail('shell_unavailable');
  const references=new Map([...args.references,...hostReferences].map(ref=>[ref.path,ref]));
  for(const ref of args.references){
    const inspected=observations?.environment?.get(ref.path);
    if(inspected?.hash===ref.hash)for(const dependency of inspected.dependencies||[])references.set(dependency.path,dependency);
  }
  args={...args,references:[...references.values()]};
  for(const ref of args.references){
    const observed=observations?.files.get(ref.path)?.hash===ref.hash?observations.files.get(ref.path):observations?.environment?.get(ref.path);
    if(!observed||observed.hash!==ref.hash)throw Object.assign(Error('source_read_required'),{actionIssued:false,details:{path:ref.path,reason:observations?.files.has(ref.path)||observations?.environment?.has(ref.path)?'hash_mismatch':'not_read_in_this_run'}});
    if((await readSource(workspace,ref.path)).hash!==ref.hash)throw Object.assign(Error('source_stale'),{actionIssued:false,details:{path:ref.path,reason:'file_changed'}});
  }
  // A command proposed after file proposals of the same run is meant to run on them, such as a test after its fix
  // (2026-09-30, the command suite): the host holds it until each of them is applied.
  const runId=service.agent?.running&&service.agent.taskId===taskId?service.agent.runId:null;
  const afterProposals=runId?service.store.list('proposal:').filter(p=>p.taskId===taskId&&p.runId===runId&&p.state==='proposed').map(p=>p.id):[];
  const fingerprint=hash(JSON.stringify([taskId,workspace,args]));
  // The same command again: an open one keeps its card and now also waits for this run's fixes; a rejected or
  // uncertain one stays as it is and is never replayed. One whose run finished may run again with a new approval,
  // such as a test after its fix; so may one whose references changed.
  const finished=v=>{
    if(v.state==='stale')return true;
    const receipt=v.state==='started'&&service.store.get('process:'+v.resultProcessId);
    // A missing receipt or a restart's unknown execution is not proof of exit.
    return !!receipt&&receipt.execution!=='unknown'&&['completed','failed','cancelled','timed_out'].includes(receipt.state);
  };
  beforeCommit();
  const previous=service.store.list('setup-action:').find(v=>v.fingerprint===fingerprint&&!finished(v));
  if(previous?.state==='proposed'&&afterProposals.some(id=>!(previous.afterProposals||[]).includes(id))){
    const merged={...previous,afterProposals:[...new Set([...(previous.afterProposals||[]),...afterProposals])]};
    service.store.set('setup-action:'+previous.id,merged);return merged;
  }
  if(previous?.state==='started'){
    const receipt=service.store.get('process:'+previous.resultProcessId);
    if(receipt?.execution==='unknown'||!['checking','running','stopping'].includes(receipt?.state)){
      const uncertain={...previous,state:'attention',error:'setup_execution_unconfirmed'};
      service.store.set('setup-action:'+previous.id,uncertain);return uncertain;
    }
  }
  if(previous)return previous;
  // The run that proposed it places the card in that turn of the conversation (user request 2026-10-14).
  const value={...args,id:randomUUID(),taskId,workspace,fingerprint,state:'proposed',createdAt:new Date().toISOString(),...(input?{inputTarget:{command:record.script,profile:record.profile,cwd:record.cwd}}:{}),...(runId?{runId}:{}),...(afterProposals.length?{afterProposals}:{})};
  service.store.set('setup-action:'+value.id,value);return value;
}

export async function decideSetupAction({id,fingerprint,decision,elevationConsent=false,automatic=false},activeRun) {
  const value=this.store.get('setup-action:'+id);
  if(!value||value.fingerprint!==fingerprint||!['approve','reject'].includes(decision))fail('setup_changed');
  if(value.state!=='proposed')return value;
  const inRun=automatic&&activeRun&&this.agent?.running&&this.agent.taskId===value.taskId&&this.agent.runId===activeRun.runId&&activeRun.taskId===value.taskId&&!activeRun.signal?.aborted;
  if(this.computerBusy||this.agent?.running&&!inRun||this.newFileBusy||this.setupBusy||this.task(value.taskId).question)fail('agent_busy');
  const automaticReason=automatic&&decision==='approve'?await automaticCommandReason(this,value):null;
  if(automatic&&!automaticReason)return value;
  if(inRun&&(this.disposed||activeRun.signal?.aborted||this.agent?.runId!==activeRun.runId))fail('setup_cancelled');
  const current=this.store.get('setup-action:'+id);
  if(current?.fingerprint!==fingerprint)fail('setup_changed');
  if(current.state!=='proposed')return current;
  if(this.setupBusy||this.computerBusy||this.newFileBusy||this.task(value.taskId).question)fail('agent_busy');
  if(this.task(value.taskId).state==='cancelled')fail('setup_cancelled');
  if((this.unsettledOperations?.size||0)>(inRun?1:0))fail('tool_unsettled');
  if(decision==='approve'&&value.privilege==='administrator'&&elevationConsent!==true)fail('elevation_approval_required');
  if(decision==='approve'&&(value.afterProposals||[]).some(id=>this.store.get('proposal:'+id)?.state==='proposed'))fail('setup_waiting_for_proposals');
  if(decision==='reject'){
    value.state='rejected';value.decidedAt=new Date().toISOString();this.store.set('setup-action:'+id,value);return value;
  }
  // Reserve synchronously before validation or process creation. A retry reads
  // the receipt; it cannot run the same installation twice.
  value.state='starting';value.decidedAt=new Date().toISOString();value.approvalSource=automatic?'automatic':'user';if(automatic)value.approvalReason=automaticReason;this.store.set('setup-action:'+id,value);this.setupBusy=true;
  if(value.privilege==='administrator'){value.elevationConsentAt=value.decidedAt;this.store.set('setup-action:'+id,value);}
  try{
    // Settings can change while this approval card is waiting. Never run old
    // syntax in either the old shell or the newly chosen shell implicitly.
    if(value.kind!=='input')requireChosenShell(await shellProfiles(),this.shellPreference(),value.profile,value.privilege==='administrator');
    if(await this.target(value.taskId)!==value.workspace)fail('setup_changed');
    for(const ref of value.references){
      const current=(await readSource(value.workspace,ref.path)).hash;
      // A file changed only by applying a proposal of this task is the change the command is meant to run on.
      if(current!==ref.hash&&!this.store.list('proposal:').some(p=>p.taskId===value.taskId&&p.path===ref.path&&p.state==='applied'&&p.expectedHash===ref.hash&&p.afterHash===current))fail('setup_changed');
    }
    if(this.disposed||this.task(value.taskId).state==='cancelled'||this.task(value.taskId).question||inRun&&(activeRun.signal?.aborted||this.agent?.runId!==activeRun.runId))fail('setup_cancelled');
    if(automatic&&!await automaticCommandReason(this,value))fail('approval_required');
    // A command can change any file: keep the files as they are now, so the task can be reverted to this point.
    if(value.kind!=='input')await checkpointBefore(this,value.taskId,'before_command',{setupActionId:value.id});
    if(automatic&&(!await automaticCommandReason(this,value)||inRun&&(activeRun.signal?.aborted||this.agent?.runId!==activeRun.runId)))fail('approval_required');
    if(value.kind==='input'){
      const record=this.processes.records.get(value.processId);
      if(!record||record.taskId!==value.taskId||record.cwd!==value.inputTarget?.cwd||record.script!==value.inputTarget?.command)fail('process_input_changed');
      this.processes.input(record.id,value.script,value.processRevision);
      record.inputActionId=value.id;record.inputContinuationAt=new Date().toISOString();
      this.store.set('process:'+record.id,record);
      value.state='started';value.resultProcessId=record.id;this.store.set('setup-action:'+id,value);
      this.processStarted?.(record);return value;
    }
    const process=await this.processes.start({cwd:value.workspace,taskId:value.taskId,script:value.script,profile:value.profile,interactive:value.interactive===true,autoDiagnose:!inRun,idleCheck:value.kind!=='start',setupActionId:value.id,privilege:value.privilege||'user',...(inRun?{signal:activeRun.signal}:{})});
    const live=this.processes.records.get(process.id)||this.store.get('process:'+process.id);if(live){live.approvalSource=value.approvalSource;if(inRun)live.agentManagedRunId=activeRun.runId;this.store.set('process:'+live.id,live);}
    value.state='started';value.resultProcessId=process.id;
    this.store.set('setup-action:'+id,value);
    if(value.kind==='start'||value.interactive)this.processStarted?.(this.processes.poll(process.id));
    return value;
  }catch(error){
    if(error.message==='approval_required'){value.state='proposed';delete value.approvalSource;delete value.approvalReason;this.store.set('setup-action:'+id,value);return value;}
    value.state=['setup_changed','shell_not_selected','process_input_changed','process_input_unavailable'].includes(error.message)?'stale':'attention';
    value.error=['setup_changed','shell_not_selected','process_input_changed','process_input_unavailable'].includes(error.message)?error.message:'setup_execution_unconfirmed';
    this.store.set('setup-action:'+id,value);throw error;
  }finally{this.setupBusy=false;queueMicrotask(()=>this.drainRecovery?.().catch(()=>{}));}
}

// The active actor reads its own command receipts. Only a process that outlives
// that actor returns to the existing completion/idle recovery mechanism.
export function releaseAutomaticCommands(service,taskId,runId,{cancelled=false}={}){
 if(cancelled)return;
 for(const record of service.processes.records.values())if(record.taskId===taskId&&record.agentManagedRunId===runId&&record.state==='running'){
  record.autoDiagnose=true;service.store.set('process:'+record.id,record);service.processes.watchIdle(record);
 }
}
