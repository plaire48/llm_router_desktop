import {approvalActionView} from './irreversible-actions.mjs';
import {convertBlueprint} from './workflow-import-blueprint.mjs';
import {convertE2eTask} from './workflow-import-e2e.mjs';
import {listWorkflowPackages,loadWorkflowPackage,saveImportedWorkflow} from './workflow-package.mjs';import {createWorkflowRunner} from './workflow-runner.mjs';import {listRuns} from './workflow-run.mjs';
export function installWorkflowService(ProjectService){
 ProjectService.prototype.importBlueprint=async function({path,expectedHash}){this.ready();const owner=this.store,root=this.root,alive=()=>{if(this.disposed||this.store!==owner||this.root!==root)throw Error('project_changed');};const source=await this.read({path,full:true});alive();if(expectedHash!==undefined&&source.hash!==expectedHash)throw Error('workflow_source_changed');const converted=convertBlueprint(source.content);return {...await saveImportedWorkflow(root,converted,alive),metrics:converted.metrics};};
 ProjectService.prototype.importE2eTask=async function({path}){this.ready();const owner=this.store,root=this.root,alive=()=>{if(this.disposed||this.store!==owner||this.root!==root)throw Error('project_changed');};const source=await this.read({path,full:true});alive();return saveImportedWorkflow(root,convertE2eTask(source.content),alive);};
 ProjectService.prototype.listWorkflows=async function(){this.ready();const owner=this.store,root=this.root;const items=await listWorkflowPackages(root);if(owner!==this.store||root!==this.root)throw Error('project_changed');const runs=listRuns(owner,{limit:200});return items.map(row=>({...row,lastRun:runs.find(run=>run.slug===row.slug)?summary(runs.find(run=>run.slug===row.slug)):null}));};
 ProjectService.prototype.validateWorkflow=async function({slug}){this.ready();const owner=this.store,root=this.root;const pkg=await loadWorkflowPackage(root,slug);if(owner!==this.store||root!==this.root)throw Error('project_changed');return {ok:true,workflow:pkg.workflow,hash:pkg.hash,fixtures:Object.keys(pkg.fixtures)};};
 ProjectService.prototype.dryRunWorkflow=function({slug,fixture='basic.json'}){this.ready();return createWorkflowRunner(this).start({slug,fixture,mode:'dry-run'});};
 ProjectService.prototype.startWorkflow=function({slug,inputs,trigger}){this.ready();return createWorkflowRunner(this).start({slug,inputs,trigger,background:true});};
 ProjectService.prototype.workflowRun=function({runId}){
  this.ready();const run=this.store.get('workflow-run:'+runId);if(!run)throw Error('workflow_run_missing');
  const task=run.taskId?this.task(run.taskId):null,outputCards=[],revisions=[],decisions=[];let question=task?.question,questionTaskId=task?.id;
  const steps=Object.fromEntries(Object.entries(run.steps).map(([id,checkpoint])=>{
   const candidate=checkpoint.taskId?this.store.get('task:'+checkpoint.taskId):null;
   const child=candidate?.origin?.kind==='workflow_step'&&candidate.origin.runId===run.id&&candidate.origin.stepId===id?candidate:null;
   if(child&&id===run.cursor)for(const [prefix,kind] of [['proposal:','proposal'],['setup-action:','command']])for(const record of this.store.list(prefix).filter(row=>row.taskId===child.id&&row.state==='proposed').slice(0,20))decisions.push({kind,stepId:id,record:approvalActionView(record)});
   if(id===run.cursor){const binding=this.store.get('workflow-command:'+run.id+':'+id),record=binding?.taskId===run.taskId?this.store.get('setup-action:'+binding.actionId):null;if(record?.taskId===run.taskId&&record.state==='proposed')decisions.push({kind:'command',stepId:id,record:approvalActionView(record)});}
   if(child){revisions.push([child.id,child.updatedAt||null]);if(id===run.cursor&&!question&&child.question){question=child.question;questionTaskId=child.id;}}
   const cards=(child?.outputs||[]).filter(card=>typeof card.id==='string');
   outputCards.push(...cards.map(({id,path,name,size,caption,captureId,runId,kind,at})=>({id,path,name,size,caption,captureId,runId,kind,at,taskId:child.id})));
   const summary=String(child?.messages?.findLast(message=>message.role==='assistant'&&!message.questionId)?.content||checkpoint.output?.summary||'').slice(0,200);
   return [id,{...Object.fromEntries(['status','startedAt','finishedAt','receipts','answer','reason','phase','cachedFrom','cachedRunId'].filter(key=>checkpoint[key]!==undefined).map(key=>[key,checkpoint[key]])),...(child?{taskId:child.id,taskRevision:child.updatedAt||null}:{}),summary,outputs:cards.map(card=>card.id)}];
  }));
  return {run:{...run,steps,outputCards},task:task?{id:task.id,state:task.state,question,questionTaskId,decisions,projectionRevision:JSON.stringify(revisions)}:null};
 };
 ProjectService.prototype.resumeWorkflow=function({runId}){this.ready();return createWorkflowRunner(this).resume(runId);};
 ProjectService.prototype.cancelWorkflow=function({runId}){this.ready();return createWorkflowRunner(this).cancel(runId);};
}
function summary(run){return {id:run.id,taskId:run.taskId,status:run.status,mode:run.mode,createdAt:run.createdAt};}
