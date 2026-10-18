// Archiving changes visibility only. Questions, recovery and running work stay visible.
const DAY=864e5;
export const ARCHIVE_BUSY_STATES=new Set(['running','stopping','waiting_input','paused','interrupted','failed','ready']);
export function archiveBlocked(task){return ARCHIVE_BUSY_STATES.has(task.state)||!!task.question||!!task.pendingMcp||['pending','connected'].includes(task.computerConnectionRequest?.state);}
export function markUnread(store,taskId,{viewing}={}){
 const task=store.get('task:'+taskId);if(!task)return;
 return store.set('task:'+taskId,{...task,unread:viewing!==taskId});// Read marks never move a conversation in the date list or reset its idle timer (F11, 2026-10-18).
}
export function markRead(store,taskId){
 const task=store.get('task:'+taskId);if(!task)return;
 return store.set('task:'+taskId,{...task,unread:false});
}
export function setArchived(store,taskId,archived,{now=Date.now()}={}){
 const task=store.get('task:'+taskId);if(!task)return null;
 return store.set('task:'+taskId,{...task,archivedAt:archived?new Date(now).toISOString():null,...(!archived?{updatedAt:new Date(now).toISOString()}: {})});
}
export function autoArchive(store,{days,now=Date.now(),blockedIds=[]}={}){
 const pins=store.get('setting:pinned-tasks');
 if(!pins||!Number.isSafeInteger(days)||days<=0||!Number.isFinite(now))return [];
 const excluded=new Set([...(pins.ids||[]),...blockedIds]),ids=[];
 for(const task of store.list('task:')){
  if(task.archivedAt||task.pinned||excluded.has(task.id)||archiveBlocked(task))continue;
  const at=Date.parse(task.updatedAt||task.createdAt||'');
  if(Number.isFinite(at)&&now-at>days*DAY){setArchived(store,task.id,true,{now});ids.push(task.id);}
 }
 return ids;
}
