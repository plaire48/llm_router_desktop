// React Flow can retain measured nodes when only another node's status changes.
export function projectWorkflowNodes(graph,indexed,checkpoints,onSelect,compact,previous=new Map(),currentStepId){
 const cache=new Map(),nodes=(graph?.nodes||[]).map(base=>{
  if(base.type==='lane')return base;
  const step=indexed.get(base.id)||base.data.step,status=checkpoints[base.id]?.status||'pending',prior=previous.get(base.id),current=currentStepId===undefined?status==='running':base.id===currentStepId;
  const value=prior?.base===base&&prior.value.data.step===step&&prior.value.data.status===status&&prior.value.data.onSelect===onSelect&&prior.value.data.compact===compact&&prior.value.data.current===current?prior.value:{...base,data:{...base.data,step,status,compact,onSelect,current}};
  cache.set(base.id,{base,value});return value;
 });return {nodes,cache};
}
