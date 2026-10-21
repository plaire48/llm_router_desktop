import {saveImportedWorkflow} from './workflow-package.mjs';
const fail=code=>{throw Error(code);};
// UI-only bridge. Scheduling, supervision and definition hashing stay in the existing runtime.
export function createRoutineUiActions({store,owner}){
 const pending=new Map();
 return {
  async catalog({projectId}){if(typeof projectId!=='string')fail('project_missing');return (await owner({projectId})).listWorkflows();},
  async promotion(row){const service=await owner(row),value=service.store.get('workflow-promotion:'+row.id);return value?.state==='proposed'&&value.projectId===row.projectId&&value.request===row.request?value:null;},
  resolve({id,action}){
   if(!['create','dismiss'].includes(action))return Promise.reject(Error('routine_invalid'));
   if(pending.has(id))return action==='create'?pending.get(id):Promise.reject(Error('routine_busy'));
   const operation=(async()=>{
    const row=store.get('routine:'+id);if(!row||row.kind==='workflow')fail('routine_promotion_unavailable');
    const service=await owner(row),projectStore=service.store,root=service.root,key='workflow-promotion:'+id,proposal=projectStore.get(key);
    if(!proposal||proposal.projectId!==row.projectId||proposal.routineId!==id)fail('routine_promotion_unavailable');
    if(proposal.request!==row.request)fail('routine_changed');
    if(proposal.state==='accepted'&&action==='create'&&proposal.slug)return {slug:proposal.slug,projectId:row.projectId};
    if(proposal.state!=='proposed')fail('routine_promotion_unavailable');
    const current=()=>{const latest=store.get('routine:'+id);if(service.disposed||service.store!==projectStore||service.root!==root||JSON.stringify(latest)!==JSON.stringify(row))fail('routine_changed');};current();
    if(action==='dismiss'){projectStore.set(key,{...proposal,state:'dismissed'});return {dismissed:true};}
    // Persist before writing: an uncertain import is never silently repeated on restart.
    projectStore.set(key,{...proposal,state:'creating'});
    try{
     const workflow={name:row.name,version:1,trigger:{kind:'manual'},inputs:{},permissions:{tools:[],externalWrite:'never'},steps:[{id:'request',kind:'agent',name:row.name,goal:row.request,tools:[],done_when:{kind:'output_schema',evidence:{min:0}},outputs:{schema:{type:'object',required:['summary'],properties:{summary:{type:'string'}},additionalProperties:false}},budget:{calls:8,minutes:10}}]};
     const result=await saveImportedWorkflow(root,{workflow,warnings:[{code:'workflow_draft_tools_required',message:'요청에서 만든 초안입니다. 필요한 도구와 완료 조건을 정한 뒤 감독 실행하세요.'}]},current);current();
     projectStore.set(key,{...proposal,state:'accepted',slug:result.slug});return {slug:result.slug,projectId:row.projectId};
    }catch(error){if(service.store===projectStore)projectStore.set(key,{...proposal,state:'failed'});throw error;}
   })();pending.set(id,operation);void operation.finally(()=>pending.delete(id)).catch(()=>{});return operation;
  }
 };
}
