// Invalidation only: consumers re-read their own scoped state. Token bursts do
// not broadcast transcripts or start a filesystem-wide overview on every token.
export function createActivityNotifier(send,{intervalMs=80}={}){
 const pending=new Map();let disposed=false;
 const emit=projectId=>{try{send({projectId});}catch{}};
 function notify({projectId}){
  if(disposed||typeof projectId!=='string'||!projectId)return;
  const existing=pending.get(projectId);if(existing){existing.dirty=true;return;}
  const entry={dirty:false,timer:null};pending.set(projectId,entry);
  const flush=()=>{
   if(entry.dirty){entry.dirty=false;emit(projectId);entry.timer=setTimeout(flush,intervalMs);entry.timer.unref?.();}
   else pending.delete(projectId);
  };
  emit(projectId);entry.timer=setTimeout(flush,intervalMs);entry.timer.unref?.();
 }
 notify.dispose=()=>{disposed=true;for(const entry of pending.values())clearTimeout(entry.timer);pending.clear();};
 return notify;
}
