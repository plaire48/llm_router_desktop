import Ajv from 'ajv';
import {hash} from './files.mjs';
import {approvalPolicy,mcpToolAllowed} from './approval-policy.mjs';
import {irreversibleMcpTool} from './irreversible-actions.mjs';
import {prepareDevelopmentBrowserCall,callDevelopmentBrowser} from './browser-agent-host.mjs';

const signatureOf=found=>hash(JSON.stringify({serverId:found.serverId,tool:found.tool,readOnly:found.readOnly}));
export function workflowMcpApprovalValid(service,task,runId,stepId){
 const pending=task.pendingMcp,record=service.store.get(`workflow-mcp:${runId}:${stepId}`);if(!pending||!record||record.state!=='prepared'||pending.workflowRunId!==runId||pending.workflowStepId!==stepId||record.taskId!==task.id)return false;
 const registry=service.mcpRegistry(),found=registry.tool(pending.name);return !!found&&found.serverId===pending.serverId&&found.tool.name===pending.tool&&record.signature===signatureOf(found)&&record.fingerprint===registry.fingerprint(pending.name,pending.args)&&record.binding===hash(JSON.stringify([record.adapter,pending.args]));
}

function outputOf(raw){
 const text=String(raw.text||'').slice(0,65536);let value=raw.structured;
 if(value===undefined)try{value=JSON.parse(text);}catch{value=undefined;}
 const result=value&&typeof value==='object'&&!Array.isArray(value)?structuredClone(value):{output:value===undefined?text:value};
 if(Buffer.byteLength(JSON.stringify(result))>1024*1024)throw Error('workflow_output_limit');return {result,observation:{output:text}};
}

// Reuse the host registry, browser observations and pendingMcp continuation.
// Record issuance before calling; a lost response is never permission to replay.
export function createWorkflowMcp(service,{owner,taskId,runId,alive,authorize}){
 return {irreversible:()=>true,async call(args,context={}){
  const target=context.target;if(target?.family!=='mcp')throw Error('workflow_adapter_unknown');
  const name=`mcp__${target.serverId}__${target.tool}`.replace(/[^A-Za-z0-9_-]/g,'_'),registry=service.mcpRegistry(),found=registry.tool(name);
  if(!found||found.serverId!==target.serverId||found.tool.name!==target.tool)throw Error('workflow_mcp_unavailable');
  const run=owner.get('workflow-run:'+runId),step=run?.workflow.steps.find(s=>s.id===context.stepId);if(!step)throw Error('workflow_binding_changed');
  authorize(step.adapter,args,context);const irreversible=irreversibleMcpTool(found.tool,{serverId:found.serverId}),force=step.externalWrite===true||irreversible.matched;
  const permission=step.permissions?.externalWrite??run.workflow.permissions.externalWrite;if(permission==='never'&&(!found.readOnly||force))throw Error('workflow_external_write_forbidden');
  let valid;try{valid=new Ajv({strict:false,ownProperties:true,validateFormats:false}).compile(found.tool.inputSchema||{type:'object'})(args);}catch{throw Error('workflow_mcp_arguments_invalid');}if(!valid)throw Error('workflow_mcp_arguments_invalid');
  const fingerprint=registry.fingerprint(name,args),signature=signatureOf(found),binding=hash(JSON.stringify([step.adapter,args])),key=`workflow-mcp:${runId}:${context.stepId}`;
  let record=owner.get(key);if(record&&(record.signature!==signature||record.binding!==binding||record.taskId!==taskId))throw Error('workflow_mcp_changed');
  if(record?.state==='finished')return {...record.outcome,receipts:[key]};
  if(record&&['executing','unconfirmed'].includes(record.state))return {ok:false,waiting:true,execution:'unconfirmed',error:'workflow_mcp_unconfirmed',receipts:[key]};
  const task=service.task(taskId),continuation=task.mcpContinuation;
  const approved=continuation?.state==='approved'&&continuation.fingerprint===fingerprint&&continuation.workflowRunId===runId&&continuation.workflowStepId===context.stepId;
  const savedAllowance=mcpToolAllowed(approvalPolicy(owner),{serverId:found.serverId,tool:found.tool.name}),allowed=approved||!force&&(found.readOnly||savedAllowance);
  if(continuation?.state==='cancelled'&&continuation.fingerprint===fingerprint&&continuation.workflowRunId===runId&&continuation.workflowStepId===context.stepId)return {ok:false,error:'workflow_mcp_rejected',receipts:[key]};
  if(!record){
   if(!found.readOnly||force)await prepareDevelopmentBrowserCall(service,{taskId,name,args,signal:context.signal});alive(context.signal);authorize(step.adapter,args,context);
   record={taskId,runId,stepId:context.stepId,signature,binding,fingerprint,state:'prepared',adapter:step.adapter};owner.set(key,record);
  }
  if(!allowed){
   const current=service.task(taskId);if(current.pendingMcp&&current.pendingMcp.fingerprint!==fingerprint)throw Error('workflow_action_pending');
   const classification=force?{matched:true,reason:irreversible.reason||'워크플로우 외부 반영'}:irreversible;
   current.pendingMcp={name,args:structuredClone(args),fingerprint,serverId:found.serverId,tool:found.tool.name,workflowRunId:runId,workflowStepId:context.stepId,...(force?{irreversible:{reason:classification.reason}}:{})};owner.set('task:'+taskId,current);
   return {ok:false,waiting:true,error:'approval_required',approval:{found,irreversible:classification,savedAllowance},receipts:[key]};
  }
  alive(context.signal);authorize(step.adapter,args,context);record={...record,state:'executing'};owner.set(key,record);
  const issuedTask=service.task(taskId);issuedTask.pendingMcp=null;issuedTask.mcpContinuation={name,args:structuredClone(args),fingerprint,serverId:found.serverId,tool:found.tool.name,workflowRunId:runId,workflowStepId:context.stepId,state:'executing'};owner.set('task:'+taskId,issuedTask);
  let outcome;
  try{const raw=await callDevelopmentBrowser(service,{taskId,name,args,approved:true,signal:context.signal});alive(context.signal);outcome={ok:raw.ok===true,...outputOf(raw),...(raw.ok===true?{}:{error:'workflow_mcp_failed',...(!found.readOnly||force?{waiting:true,execution:'unconfirmed'}:{})})};}
  catch(error){alive(context.signal);outcome={ok:false,error:'workflow_mcp_failed',...(!found.readOnly||force?{waiting:true,execution:'unconfirmed'}:{})};}
  record={...record,state:outcome.execution==='unconfirmed'?'unconfirmed':'finished',outcome,finishedAt:new Date().toISOString()};owner.set(key,record);
  const settled=service.task(taskId);settled.mcpContinuation={...settled.mcpContinuation,state:'finished',result:outcome};owner.set('task:'+taskId,settled);
  return {...outcome,receipts:[key]};
 }};
}
