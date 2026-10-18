import {workflowMcpApprovalValid} from './workflow-mcp.mjs';
import {mcpApprovalQuestion,answerMcpApproval} from './mcp-approval.mjs';
import {nextWorkflowStep,branchWorkflowStep} from './workflow-navigation.mjs';
import {parseWorkflowAdapter} from './workflow-adapter-id.mjs';
import Ajv from 'ajv';
import {completionChecks,evidenceRequirements} from './workflow-completion.mjs';
import {assertWorkflowEvidence} from './workflow-evidence.mjs';
import {createAdapters,createSyntheticAdapters} from './workflow-adapters.mjs';
import {loadWorkflowPackage} from './workflow-package.mjs';
import {createRun,markStep,readStepOutput,stepCacheKey} from './workflow-run.mjs';
import {evaluateTemplate,evaluateCondition,evaluateExpression} from './workflow-template.mjs';
import {STEP_GOAL_SUFFIX,readStepCandidate,validStepOutput} from './workflow-step.mjs';
import {workflowReport} from './workflow-report.mjs';
import {cleanModelText} from './model-text.mjs';
import {makeQuestion} from '../../../extensions/aipro-chat/user-question.js';
import {secretLike} from './secret-like.mjs';
import {assertStepPermissions,assertWorkflowCall} from './workflow-policy.mjs';

const terminal=new Set(['complete','partial','cancelled','failed']);
const kinds=new Set(['tool','agent','human','branch']);
const conditions=new Set(['truthy','file_exists','file_hash','exit_code','output_matches','text_present','element_visible','url_is']);
const clone=value=>structuredClone(value);
function resolve(value,scope){
 if(typeof value==='string'){
  const sole=/^\{\{\s*([^{}]+)\s*\}\}$/.exec(value);
  return sole?evaluateExpression(sole[1],scope):evaluateTemplate(value,scope);
 }
 if(Array.isArray(value))return value.map(v=>resolve(v,scope));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,scope)]));
 return value;
}
function preflight(workflow){
 for(const step of workflow.steps){
  if(!kinds.has(step.kind))throw Error('workflow_step_unsupported');
  // File verification is scoped to the child's workspace. Other agent outcomes
  // need a child-bound receipt port; an umbrella tab/process must never stand in.
  if(step.kind==='agent'&&completionChecks(step.done_when).some(check=>!['file_exists','file_hash','output_schema'].includes(check.kind)))throw Error('workflow_verify_unsupported');
  for(const check of [step.verify,step.done_when].filter(Boolean).flatMap(check=>completionChecks(check)))if(!conditions.has(check.kind)&&!(step.kind==='agent'&&check.kind==='output_schema'))throw Error('workflow_verify_unsupported');
 }
}
function inputsFor(workflow,values){
 const properties={},required=[];
 for(const [name,{required:needed,...property}] of Object.entries(workflow.inputs||{})){properties[name]=property;if(needed)required.push(name);}
 const input=clone(values);const valid=new Ajv({strict:false,ownProperties:true,useDefaults:true,validateFormats:false}).compile({type:'object',properties,required,additionalProperties:false});
 if(!valid(input))throw Error('workflow_inputs_invalid');
 const secrets=value=>typeof value==='string'?(!/^secret:[A-Za-z0-9가-힣_-]{1,80}$/.test(value)&&secretLike(value)):value&&typeof value==='object'&&Object.values(value).some(secrets);
 if(secrets(input))throw Error('workflow_secret_plain');return input;
}

export function createWorkflowRunner(service){
 if(service.workflowRunner?.owner===service.store)return service.workflowRunner;
 const owner=service.store,root=service.root,locks=new Map(),controllers=new Map();
 const alive=signal=>{signal?.throwIfAborted();if(service.disposed||service.store!==owner||service.root!==root)throw Error('project_changed');};
 const get=id=>{alive();const run=owner.get('workflow-run:'+id);if(!run)throw Error('workflow_run_missing');return run;};
 const save=run=>{alive();run.updatedAt=new Date().toISOString();run.report=workflowReport(run);owner.set('workflow-run:'+run.id,run);return clone(run);};
 const patch=(id,step,values)=>{alive();return markStep(owner,id,step,values);};
 function taskState(run,state,question=null){
  if(!run.taskId)return;const task=service.task(run.taskId);task.state=state;task.question=question;task.updatedAt=new Date().toISOString();owner.set('task:'+task.id,task);
 }
 function finish(run,status,reason){
  if(['partial','failed','cancelled'].includes(status)){
   const tasks=new Set([run.taskId,...Object.values(run.steps).map(value=>value.taskId)].filter(Boolean));
   // Closing a run revokes outstanding consent. A later click cannot issue work
   // after a timeout, and uncertain/executing receipts keep their actual state.
   for(const prefix of ['setup-action:','proposal:','computer-action:'])for(const row of owner.list(prefix))if(tasks.has(row.taskId)&&row.state==='proposed')owner.set(prefix+row.id,{...row,state:'rejected',error:reason||'workflow_closed'});
   for(const id of tasks){const task=service.task(id);if(task.pendingMcp?.workflowRunId===run.id||task.mcpContinuation?.workflowRunId===run.id&&task.mcpContinuation.state==='approved'){task.pendingMcp=null;if(task.mcpContinuation?.state==='approved')task.mcpContinuation={...task.mcpContinuation,state:'finished',result:{ok:false,execution:'cancelled',actionIssued:false}};owner.set('task:'+id,task);}}
   for(const child of Object.values(run.steps))if(child.taskId)queueMicrotask(()=>service.stopAgent({taskId:child.taskId}).catch(()=>{}));
  }
  run.status=status;if(reason)run.reason=reason;run.finishedAt=new Date().toISOString();save(run);taskState(run,status==='cancelled'?'cancelled':'review');
  if(status==='complete'&&run.supervised)owner.set(`workflow-qualified:${run.slug}:${run.hash}`,{hash:run.hash,runId:run.id});return get(run.id);
 }
 function hold(run,step,reason,{unconfirmed=false,approval}={}){
  run=patch(run.id,step.id,{status:unconfirmed?'unconfirmed':'waiting',reason});
  if(approval){const task=service.task(run.taskId),question=mcpApprovalQuestion(approval.found,task.pendingMcp.args,approval);question.workflow={runId:run.id,stepId:step.id,phase:'mcp',answers:Object.fromEntries(question.options.map(option=>[option.label,{실행:'approve','항상 허용':'always',취소:'stop'}[option.label]]))};run=patch(run.id,step.id,{phase:'mcp',questionId:question.id});taskState(run,'waiting_input',question);return run;}
  if(unconfirmed){
   const question=makeQuestion('이전 실행 결과를 확인하지 못했어요. 같은 작업을 다시 실행하지 않고 영수증 확인을 기다립니다.',[],[],{choices:[{label:'중단'}],inputMode:'none',selection:'single'});
   question.workflow={runId:run.id,stepId:step.id,phase:'reconcile',answers:{중단:'stop'}};
   run=patch(run.id,step.id,{questionId:question.id,phase:'reconcile'});taskState(run,'waiting_input',question);
  }else taskState(run,'review');return run;
 }
 function ask(run,step,supervision=false){
  const choices=supervision?['approve','stop']:step.outputs?.decision||[];
  const labels={approve:'진행',stop:'중단'};
  const question=makeQuestion(cleanModelText(supervision?`${step.name||step.id} 단계를 실행할까요?`:resolve(step.ask,scopeOf(run,step))),[],[],{choices:choices.map(value=>({label:labels[value]||value})),inputMode:choices.length?'none':'text',selection:'single'});
  question.workflow={runId:run.id,stepId:step.id,phase:supervision?'supervision':'human',answers:Object.fromEntries(choices.map(value=>[labels[value]||value,value]))};
  run=patch(run.id,step.id,{status:'waiting',phase:question.workflow.phase,questionId:question.id});taskState(run,'waiting_input',question);return run;
 }
 function scopeOf(run,step){
  const text=JSON.stringify([step.goal,step.ask,step.args,step.when,step.verify,step.done_when,step.idempotency]);
  const referenced=new Set([...text.matchAll(/\bsteps\.([a-z][a-z0-9-]*)\.output\b/g)].map(match=>match[1]));
  const steps={};for(const id of referenced){const value=run.steps[id];if(value?.status==='complete'||value?.status==='skipped'&&value.reason==='workflow_idempotency_reused')steps[id]={output:readStepOutput(owner,value)};}
  return {inputs:run.inputs,steps};
 }
 const pending=taskId=>{
  const task=service.task(taskId),rows=['proposal:','setup-action:','computer-action:','process:'].flatMap(prefix=>owner.list(prefix).filter(item=>item.taskId===taskId&&(['proposed','creating','starting','running','stopping','checking','attention','interrupted'].includes(item.state)||item.execution==='unknown')));
  if(task.pendingMcp?.length||['approved','executing'].includes(task.mcpContinuation?.state)||['written','attention','pending'].includes(task.nativeOffice?.state)||['attention','pending'].includes(task.liveEditor?.state))rows.push({state:'attention'});
  return rows;
 };
 function rejected(taskId){
  for(const prefix of ['proposal:','setup-action:','computer-action:']){
   const seen=new Set();for(const item of owner.list(prefix).filter(row=>row.taskId===taskId)){const key=item.path||item.id;if(seen.has(key))continue;seen.add(key);if(['rejected','cancelled','stale'].includes(item.state))return true;}
  }return false;
 }
 async function verify(check,result,adapters,context){
  if(!check)return {ok:true,receipts:[]};
  if(check.kind==='all_of'){const receipts=[];for(const child of check.all_of){const checked=await verify(child,result,adapters,context);receipts.push(...checked.receipts);if(!checked.ok)return {ok:false,receipts};}return {ok:true,receipts};}
  if(check.kind==='output_schema')return {ok:context.outputSubmitted===true,receipts:[]};
  if(check.kind==='truthy')return {ok:result?.exists===undefined?!!result:result.exists===true,receipts:[]};
  if(['file_exists','file_hash'].includes(check.kind)){
   const observation=await adapters.documents[check.kind==='file_exists'?'exists':'hash']({path:check.path},context);
   return {ok:check.kind==='file_exists'?observation.result.exists:observation.result.hash===check.value,receipts:observation.receipts};
  }
  if(check.kind==='exit_code')return {ok:result?.exitCode===(check.value??0),receipts:[]};
  if(check.kind==='output_matches'){const output=typeof result?.output==='string'?result.output:context.toolText;return {ok:typeof output==='string'&&output.includes(check.value),receipts:[]};}
  const observation=await adapters.web.verify(check,context);return {ok:observation.result.verified===true,receipts:observation.receipts};
 }
 async function agentStep(run,step,scope,signal,adapters){
  let checkpoint=get(run.id).steps[step.id],task=checkpoint.taskId&&service.task(checkpoint.taskId);
  if(!task){
   const goal=evaluateTemplate(step.goal,scope),payload=JSON.stringify({outputSchema:step.outputs?.schema||{type:'object'}});
   const request=`${goal}\n\n단계 출력 형식 (데이터):\n${payload}\n\n${STEP_GOAL_SUFFIX}`;
   if(Buffer.byteLength(request)>16000)throw Error('workflow_handoff_limit');
   task=await service.createTask({request,origin:{kind:'workflow_step',runId:run.id,stepId:step.id}});
   alive(signal);patch(run.id,step.id,{taskId:task.id,agentStarted:false});checkpoint=get(run.id).steps[step.id];
  }
  if(rejected(task.id)||task.state==='cancelled')return finish(get(run.id),'partial','workflow_action_rejected');
  if(task.question||pending(task.id).length)return hold(get(run.id),step,'workflow_action_pending');
  if(!checkpoint.candidate&&(checkpoint.submissionErrors||0)<2){
   const running=service.agentForTask(task.id);
   if(running?.running)await running.promise;
   else if(!checkpoint.agentStarted){
    try{await service.startAgent({taskId:task.id});patch(run.id,step.id,{agentStarted:true});await service.agentForTask(task.id).promise;}catch(error){alive(signal);const issued=!!get(run.id).steps[step.id].agentStarted||!!service.agentForTask(task.id)?.running;if(!issued&&!/^(agent_busy|provider_missing|wiki_)/.test(error.message))throw error;return hold(get(run.id),step,error.message,{unconfirmed:issued});}
   }else if(['interrupted'].includes(task.state))return hold(get(run.id),step,'workflow_agent_interrupted',{unconfirmed:true});
   else throw Error('workflow_output_missing');
  }
  alive(signal);run=get(run.id);checkpoint=run.steps[step.id];task=service.task(task.id);
  if(checkpoint.submissionErrors>=2)throw Error(checkpoint.submissionError||'workflow_output_schema');
  if(rejected(task.id)||task.state==='cancelled')return finish(run,'partial','workflow_action_rejected');
  if(pending(task.id).length||task.question)return hold(run,step,'workflow_action_pending');
  if(!checkpoint.candidate)throw Error('workflow_output_missing');
  assertWorkflowEvidence(service,task,run,step,readStepCandidate(owner,checkpoint));
  const outcome=await verify(resolve(step.done_when,scope),null,adapters,{signal,stepId:step.id,summary:step.action_summary||step.goal,outputSubmitted:true});
  alive(signal);if(!outcome.ok)throw Error('workflow_verify_failed');
  const applied=owner.list('proposal:').filter(row=>row.taskId===task.id&&row.state==='applied').map(row=>'proposal:'+row.id);
  patch(run.id,step.id,{status:'complete',output:readStepCandidate(owner,checkpoint),receipts:[...(checkpoint.receipts||[]),...applied,...outcome.receipts]});return null;
 }
 async function failure(run,step,code){
  const checkpoint=run.steps[step.id]||{},policy=step.on_failure||run.workflow.on_failure||{};
  // Only confirmed read operations may be automatically retried. An unknown write
  // is reconciled separately; a retry policy never grants authority to replay it.
  const safe=step.kind==='tool'&&['documents.read','documents.exists','documents.hash','web.verify'].includes(step.adapter);
  const forbidden=/forbidden|permission|binding|unconfirmed|changed|timeout|cancelled|rejected|project_|template_|data_invalid|schema|fixture_/.test(code);
  if(safe&&!forbidden&&(checkpoint.attempts||0)>0&&(checkpoint.attempts||0)<=(policy.retry||0)){
   patch(run.id,step.id,{status:'pending',reason:code});return null;
  }
  if(policy.then==='human'&&!forbidden&&run.mode!=='dry-run'){
   const question=makeQuestion('단계를 완료하지 못했어요. 원인을 확인한 뒤 다시 확인하거나 중단해 주세요.',[],[],{choices:[...(safe?[{label:'다시 확인'}]:[]),{label:'중단'}],inputMode:'none',selection:'single'});
   question.workflow={runId:run.id,stepId:step.id,phase:'failure',answers:{'다시 확인':'retry',중단:'stop'}};
   run=patch(run.id,step.id,{status:'waiting',phase:'failure',questionId:question.id,reason:code});taskState(run,'waiting_input',question);return run;
  }
  return finish(run,'partial',code);
 }
 async function bounded(work,signal,milliseconds,reason){
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let timer,listener;
  const timeout=new Promise((_,reject)=>{
   listener=()=>reject(combined.reason);combined.addEventListener('abort',listener,{once:true});
   timer=setTimeout(()=>controller.abort(Error(reason)),Math.max(0,milliseconds));
  });
  try{combined.throwIfAborted();return await Promise.race([work(combined),timeout]);}
  finally{clearTimeout(timer);combined.removeEventListener('abort',listener);}
 }
 const errorCode=error=>/^(workflow_|template_|path_scope$|source_)/.test(error?.message)?error.message:'workflow_step_failed';
 async function execute(id,{answer}={},signal){
  let run=get(id);if(terminal.has(run.status))return run;
  const remaining=()=>7200000-(Date.now()-Date.parse(get(id).createdAt));
  if(!(remaining()>0))return finish(run,'partial','workflow_run_timeout');
  const pkg=await loadWorkflowPackage(root,run.slug);alive(signal);if(pkg.hash!==run.hash)throw Error('workflow_package_changed');
  const dry=run.mode==='dry-run',fixture=dry?pkg.fixtures[run.fixture]:null;
  if(answer!==undefined){
   const step=run.workflow.steps.find(s=>s.id===run.cursor),checkpoint=run.steps[step.id],task=service.task(run.taskId);
   if(!task.question||task.question.id!==checkpoint?.questionId||task.question.workflow?.runId!==run.id)throw Error('question_changed');
   const choices=checkpoint.phase==='mcp'?Object.values(task.question.workflow.answers):checkpoint.phase==='supervision'?['approve','stop']:checkpoint.phase==='reconcile'?['stop']:checkpoint.phase==='failure'?Object.values(task.question.workflow.answers):step.outputs?.decision;
   if(typeof answer!=='string'||!answer.trim()||answer.length>4000||(choices&&!choices.includes(answer)))throw Error('answer_invalid');
   if(step.timeout&&Date.now()-Date.parse(checkpoint.startedAt)>=step.timeout*1000)return finish(run,'partial','workflow_step_timeout');
   if(checkpoint.phase==='mcp'){
    if(task.pendingMcp?.workflowRunId!==run.id||task.pendingMcp?.workflowStepId!==step.id)throw Error('workflow_binding_changed');
    if(answer!=='stop'&&!workflowMcpApprovalValid(service,task,run.id,step.id))return finish(run,'partial','workflow_mcp_changed');
    const text=answer==='always'?'항상 허용':answer==='stop'?'취소':'실행';
    task.questionHistory=[...(task.questionHistory||[]),{...task.question,draft:undefined,answer:{text,at:new Date().toISOString()}}];answerMcpApproval(service,task,text);owner.set('task:'+task.id,task);
   }
   if(choices?.includes('stop')&&answer==='stop')return finish(patch(id,step.id,{status:'cancelled',answer}),'partial','workflow_stopped');
   taskState(run,'review');
   run=checkpoint.phase==='mcp'?patch(id,step.id,{status:'pending',phase:'execution'}):checkpoint.phase==='supervision'?patch(id,step.id,{status:'pending',supervisedApproved:true,phase:'execution'}):checkpoint.phase==='failure'?patch(id,step.id,{status:'pending',phase:'execution'}):patch(id,step.id,{status:'complete',answer,output:{decision:answer},receipts:[]});
  }
  const adapters=dry?createSyntheticAdapters(fixture):createAdapters(service,{taskId:run.taskId,runId:run.id});
  const fixtureReceipts=(ids,stepId)=>[...new Set((Array.isArray(ids)&&ids.length?ids:[stepId]).map(id=>'fixture:'+String(id).replace(/^fixture:/,'')))];
  async function dispatch(step,signal){
   run=get(id);const checkpoint=run.steps[step.id],scope=scopeOf(run,step);
   assertStepPermissions(run.workflow,step);
   if(checkpoint?.status==='unconfirmed'){
    const command=owner.get(`workflow-command:${run.id}:${step.id}`),action=command&&owner.get('setup-action:'+command.actionId),process=action&&owner.get('process:'+action.resultProcessId);
    if(step.adapter==='terminal.run'&&action?.state==='started'&&['completed','failed','cancelled','timed_out'].includes(process?.state)&&process.execution!=='unknown'){
     const args=resolve(step.args,scope);assertWorkflowCall(run.workflow,step,step.adapter,args);
     const context={signal,stepId:step.id,summary:step.action_summary||step.adapter},result=await adapters.terminal.run(args,context);alive(signal);
     if(!result.ok)throw Error(result.error||'workflow_command_failed');
     const checked=await verify(resolve(step.verify,scope),result.result,adapters,context);alive(signal);if(!checked.ok)throw Error('workflow_verify_failed');
     taskState(run,'review');patch(id,step.id,{status:'complete',output:result.result,receipts:[...result.receipts,...checked.receipts]});return null;
    }
    return hold(run,step,'workflow_unconfirmed',{unconfirmed:true});
   }
   if(['complete','skipped'].includes(checkpoint?.status)){run.cursor=Object.hasOwn(checkpoint,'next')?checkpoint.next:nextWorkflowStep(run.workflow,step);save(run);return null;}
   if(step.kind!=='branch'&&step.when!==undefined&&!evaluateCondition(step.when.replace(/^\{\{\s*|\s*\}\}$/g,''),scope)){
    patch(id,step.id,{status:'skipped',reason:'workflow_condition_false'});return null;
   }
   if(checkpoint?.status==='waiting'&&['human','supervision','failure'].includes(checkpoint.phase))return run;
   // Check action arguments and policy before creating even a supervision card.
   const args=resolve(step.args||{},scope),inputHash=stepCacheKey(step.id,{args,inputs:run.inputs});
   if(step.kind==='tool')assertWorkflowCall(run.workflow,step,step.adapter,args);
   if(checkpoint?.inputHash&&checkpoint.inputHash!==inputHash)throw Error('workflow_binding_changed');
   if(run.supervised&&step.kind!=='human'&&!checkpoint?.supervisedApproved)return ask(run,step,true);
   if(step.kind==='human'){
    if(!dry)return ask(run,step);
    const choice=fixture.answers?.[step.id];
    if(typeof choice!=='string'||!choice.trim())throw Error('workflow_fixture_missing');
    if(step.outputs?.decision&&!step.outputs.decision.includes(choice))throw Error('workflow_fixture_invalid');
    if(step.outputs?.decision?.includes('stop')&&choice==='stop')return finish(patch(id,step.id,{status:'cancelled',answer:choice,receipts:['fixture:human:'+step.id]}),'partial','workflow_stopped');
    patch(id,step.id,{status:'complete',answer:choice,output:{decision:choice},receipts:['fixture:human:'+step.id]});return null;
   }
   if(!dry&&checkpoint?.status==='running'&&step.kind==='tool')return hold(run,step,'workflow_unconfirmed',{unconfirmed:true});
   const effectKey=step.idempotency?String(resolve(step.idempotency,scope)):null,effectHash=stepCacheKey('effect',{adapter:step.adapter||null,args});
   if(effectKey&&!dry){
    // Explicit keys are scoped to this workflow across revisions. Only the
    // same adapter and arguments with a confirmed receipt may suppress a write.
    for(const previous of owner.list('workflow-run:').filter(row=>row.id!==id&&row.slug===run.slug&&row.mode==='execute')){
     for(const [sourceId,source] of Object.entries(previous.steps))if(source.effectKey===effectKey){
      if(source.effectHash!==effectHash)throw Error('workflow_idempotency_changed');
      if(source.status!=='complete'&&source.status!=='skipped')return hold(run,step,'workflow_unconfirmed',{unconfirmed:true});
      patch(id,step.id,{status:'skipped',inputHash,effectKey,effectHash,reason:'workflow_idempotency_reused',output:readStepOutput(owner,source)??{},cachedFrom:sourceId,cachedRunId:previous.id,receipts:source.receipts||[]});return null;
     }
    }
   }
   const prior=effectKey&&Object.entries(run.steps).find(([key,value])=>key!==step.id&&value.effectKey===effectKey);
   if(prior){
    if(prior[1].effectHash!==effectHash)throw Error('workflow_idempotency_changed');
    if(prior[1].status!=='complete')return hold(run,step,'workflow_unconfirmed',{unconfirmed:true});
    const output=readStepOutput(owner,prior[1]),checked=await verify(resolve(step.verify,scope),output,adapters,{signal,stepId:step.id,summary:step.action_summary||step.adapter});alive(signal);
    if(!checked.ok)throw Error('workflow_verify_failed');
    patch(id,step.id,{status:'complete',inputHash,output,receipts:[...prior[1].receipts,...checked.receipts],cachedFrom:prior[0]});return null;
   }
   run=patch(id,step.id,{status:'running',inputHash,attempts:(checkpoint?.attempts||0)+1,...(effectKey?{effectKey,effectHash}:{})});
   for(const reference of step.wiki||[]){
    let warning;try{const observed=await adapters.documents.hash({path:reference.page},{signal,stepId:step.id});alive(signal);if(observed.result?.hash!==reference.hash)warning='workflow_wiki_changed';}catch(error){alive(signal);if(error.message==='path_scope')throw error;warning='workflow_wiki_unavailable';}
    if(warning){run=get(id);run.warnings=[...new Set([...(run.warnings||[]),`${warning}:${step.id}`])];save(run);}
   }
   if(step.kind==='branch'){
    const yes=evaluateCondition(step.when.replace(/^\{\{\s*|\s*\}\}$/g,''),scope);
    patch(id,step.id,{status:'complete',output:{decision:yes},next:branchWorkflowStep(run.workflow,step,yes)});return null;
   }
   if(step.kind==='agent'){
    if(dry){
     const result=fixture.responses?.[step.id];if(!result)throw Error('workflow_fixture_missing');
     if(result.ok!==true||result.waiting)throw Error('workflow_fixture_invalid');
     if(!validStepOutput(step,result.output))throw Error('workflow_output_schema');
     for(const requirement of evidenceRequirements(step)){
      const ids=result.output[requirement.field]||[];if(!Array.isArray(ids)||new Set(ids).size<requirement.min||ids.some(id=>typeof id!=='string'||!(result.receipts||[]).includes(id)))throw Error('workflow_evidence_invalid');
     }
     const checked=await verify(resolve(step.done_when,scope),result.result,adapters,{signal,stepId:step.id,outputSubmitted:true});alive(signal);
     if(!checked.ok)throw Error('workflow_verify_failed');
     patch(id,step.id,{status:'complete',output:result.output,receipts:fixtureReceipts([...(result.receipts||[]),...checked.receipts],step.id)});return null;
    }
    return agentStep(run,step,scope,signal,adapters);
   }
   const target=parseWorkflowAdapter(step.adapter),{family,action}=target,context={signal,stepId:step.id,summary:step.action_summary||step.adapter,target};
   const result=await adapters[family][action](args,context);alive(signal);
   const receipts=dry?fixtureReceipts(result.receipts,step.id):result.receipts||[];patch(id,step.id,{receipts});
   if(dry&&result.waiting)throw Error('workflow_fixture_waiting');
   if(result.waiting)return hold(get(id),step,result.error||'workflow_waiting',{unconfirmed:result.execution==='unconfirmed',approval:result.approval});
   if(!result.ok)throw Error(result.error||'workflow_step_failed');
   const output=result.result??result.observation??{};if(step.outputs&&!validStepOutput(step,output))throw Error('workflow_output_schema');
   const outcome=await verify(resolve(step.verify,scope),output,adapters,{...context,toolText:result.observation?.output});alive(signal);
   if(!outcome.ok)throw Error('workflow_verify_failed');
   patch(id,step.id,{status:'complete',output:result.result??result.observation??{},receipts:dry?fixtureReceipts([...receipts,...outcome.receipts],step.id):[...receipts,...outcome.receipts]});return null;
  }
  while(true){
   alive(signal);run=get(id);if(run.status==='complete'&&!run.finishedAt)return finish(run,'complete');if(terminal.has(run.status))return run;
   if(!(remaining()>0))return finish(run,'partial','workflow_run_timeout');
   const step=run.workflow.steps.find(s=>s.id===run.cursor);if(!step)return finish(run,'complete');
   const previous=run.steps[step.id],stepRemaining=step.timeout?step.timeout*1000-(previous?.startedAt?Date.now()-Date.parse(previous.startedAt):0):Infinity;
   const runRemaining=remaining(),limit=Math.min(stepRemaining,runRemaining),reason=stepRemaining<runRemaining?'workflow_step_timeout':'workflow_run_timeout';
   if(!(limit>0))return finish(run,'partial',reason);
   try{const stopped=await bounded(active=>dispatch(step,active),signal,limit,reason);if(stopped)return stopped;}
   catch(error){
    alive(signal);const stopped=await failure(get(id),step,errorCode(error));
    if(/timeout/.test(error.message)){
     const child=get(id).steps[step.id]?.taskId;if(child)await service.stopAgent({taskId:child});
     for(const record of owner.list('process:'))if([run.taskId,child].includes(record.taskId)&&['running','stopping','checking'].includes(record.state))service.processes.stop(record.id);
    }
    if(stopped)return stopped;
   }
  }
 }
 function resume(id,options={}){
  if(locks.has(id)){if(options.answer!==undefined)return Promise.reject(Error('workflow_busy'));return locks.get(id);}
  if(service.workflowActive)return Promise.reject(Error('workflow_busy'));
  const controller=new AbortController();controllers.set(id,controller);service.workflowActive=(service.workflowActive||0)+1;
  const promise=execute(id,options,controller.signal).then(run=>{alive();const current=get(run.id),report=workflowReport(current);if(current.report!==report){current.report=report;owner.set('workflow-run:'+run.id,current);}return current;}).finally(()=>{locks.delete(id);controllers.delete(id);service.workflowActive--;});locks.set(id,promise);return promise;
 }
 async function start({slug,inputs,trigger={kind:'manual'},mode='execute',fixture='basic.json',background=false}){
  alive();if(!['manual','routine'].includes(trigger.kind))throw Error('workflow_trigger_invalid');
  if(!['execute','dry-run'].includes(mode))throw Error('workflow_mode_invalid');
  if(service.workflowActive||service.agent?.running)throw Error('workflow_busy');
  service.workflowActive=(service.workflowActive||0)+1;
  let run;
  try{
  const pkg=await loadWorkflowPackage(root,slug);alive();const checked={workflow:pkg.workflow};preflight(checked.workflow);
  const synthetic=mode==='dry-run'?Object.hasOwn(pkg.fixtures,fixture)&&pkg.fixtures[fixture]:null;
  if(mode==='dry-run'&&(!synthetic||typeof synthetic!=='object'||Array.isArray(synthetic)))throw Error('workflow_fixture_missing');
  if(Buffer.byteLength(pkg.readme)>8192&&checked.workflow.steps.some(step=>step.kind==='agent'))throw Error('workflow_guidance_limit');
  run=createRun(owner,{slug,workflow:checked.workflow,hash:pkg.hash,inputs:inputsFor(checked.workflow,inputs??synthetic?.inputs??{}),trigger});
  owner.set('workflow-guidance:'+run.id,{hash:pkg.hash,text:pkg.readme});
  const task=await service.createTask({request:checked.workflow.name});alive();task.kind='workflow';task.workflowRunId=run.id;owner.set('task:'+task.id,task);
  run.taskId=task.id;run.mode=mode;run.fixture=mode==='dry-run'?fixture:null;run.supervised=mode!=='dry-run'&&!owner.get(`workflow-qualified:${slug}:${pkg.hash}`);save(run);
  }catch(error){if(run){run.status='failed';run.reason='workflow_task_creation_failed';run.finishedAt=new Date().toISOString();save(run);}throw error;}finally{service.workflowActive--;}
  if(background){queueMicrotask(()=>resume(run.id).catch(error=>{if(service.store===owner&&!service.disposed&&!terminal.has(get(run.id).status))finish(get(run.id),'partial',errorCode(error));}));return get(run.id);}
  return resume(run.id);
 }
 async function cancel(id){
  let run=get(id);if(terminal.has(run.status))return run;controllers.get(id)?.abort(Error('cancelled'));
  finish(run,'cancelled','workflow_cancelled');
  for(const step of Object.values(run.steps))if(step.taskId){
   await service.stopAgent({taskId:step.taskId});alive();
  }
  const ids=new Set([run.taskId,...Object.values(run.steps).map(step=>step.taskId).filter(Boolean)]);
  for(const record of owner.list('process:'))if(ids.has(record.taskId)&&['running','stopping','checking'].includes(record.state))service.processes.stop(record.id);
  return get(id);
 }
 async function notify(id){const active=locks.get(id);if(active)await active.catch(()=>{});if(service.store===owner&&!service.disposed)return resume(id,{});}
 const api={owner,start,resume,cancel,notify,dispose(){for(const controller of controllers.values())controller.abort(Error('project_changed'));}};
 service.workflowRunner=api;return api;
}
