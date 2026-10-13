// Only the owning project's live writer blocks chat. A saved orphaned
// running record must not lock a project forever after an interrupted launch.
export function wikiChatBlocked(service){
  if(service.workspaceKind==='conversation'||!service.store)return false;
  const initializing=service.wikiInitController&&service.wikiInitOwner===service.store&&
    !service.wikiInitController.signal.aborted&&service.store.get('wiki-init')?.state==='running';
  const updating=service.wikiUpdateRun&&(!service.wikiUpdateRun.owner||service.wikiUpdateRun.owner===service.store)&&
    !service.wikiUpdateRun.controller.signal.aborted&&service.store.get('wiki-update:'+service.wikiUpdateRun.id)?.state==='running';
  return !!(initializing||updating);
}
export function requireWikiChatReady(service){
  if(wikiChatBlocked(service))throw Error('wiki_chat_blocked');
}
export function wikiChatJob(service){
  if(!wikiChatBlocked(service))return null;
  if(service.wikiInitController&&!service.wikiInitController.signal.aborted&&service.wikiInitOwner===service.store&&service.store.get('wiki-init')?.state==='running')return service.store.get('wiki-init');
  const update=service.store.get('wiki-update:'+service.wikiUpdateRun.id);
  const progress=[...(update.events||[])].reverse().find(event=>event.type==='progress');
  const completed=progress?.stage==='generating'&&progress.total>0?Math.max(0,Math.min(progress.total,progress.index-1)):null;
  return {id:update.id,projectId:service.projectId,kind:'update',state:'running',startedAt:update.startedAt,stage:progress?.stage||'preparing_runtime',
    completed,total:progress?.total,percent:completed===null?null:Math.floor(completed/progress.total*100)};
}
