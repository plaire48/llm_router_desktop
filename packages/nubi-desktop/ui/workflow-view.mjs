// Run revisions cover the large graph. Questions may change independently and
// must still refresh, so compare that small host projection as well.
export function sameWorkflowView(previous,next){
 if(!previous?.run?.updatedAt||!next?.run?.updatedAt)return false;
 return previous.run.id===next.run.id&&previous.run.updatedAt===next.run.updatedAt&&previous.run.status===next.run.status&&JSON.stringify(previous.task)===JSON.stringify(next.task);
}
