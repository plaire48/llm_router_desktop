// Polled state snapshots arrive every second or so. Keeping the previous object, and each unchanged field's previous
// value, when nothing changed spares a re-render of the whole workspace per poll (user report 2026-10-14: the app
// feels slow). Fields are compared by value; a changed field takes the new value.
// Snapshots are JSON records. Compare fields without allocating two copies of
// every transcript as strings, and retain unchanged messages when a run ticks.
function share(previous,next,depth=0){
  if(Object.is(previous,next))return previous;
  if(!previous||!next||typeof previous!=='object'||typeof next!=='object'||depth>128)return next;
  const array=Array.isArray(next);
  if(array!==Array.isArray(previous))return next;
  if(!array&&(Object.getPrototypeOf(next)!==Object.prototype||Object.getPrototypeOf(previous)!==Object.prototype))return next;
  const keys=Object.keys(next),oldKeys=Object.keys(previous);
  let changed=keys.length!==oldKeys.length||(array&&next.length!==previous.length);
  const result=array?new Array(next.length):{};
  for(const key of keys){
    const exists=Object.hasOwn(previous,key),value=exists?share(previous[key],next[key],depth+1):next[key];
    Object.defineProperty(result,key,{value,writable:true,enumerable:true,configurable:true});
    if(!exists||!Object.is(value,previous[key]))changed=true;
  }
  return changed?result:previous;
}
export function mergeSnapshot(previous,next){
  if(!previous||!next||typeof next!=='object')return previous;
  let changed=false;const merged={...previous};
  for(const [key,value] of Object.entries(next)){const shared=share(previous[key],value);if(!Object.hasOwn(previous,key)||!Object.is(previous[key],shared)){Object.defineProperty(merged,key,{value:shared,writable:true,enumerable:true,configurable:true});changed=true;}}
  return changed?merged:previous;
}
