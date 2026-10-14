// Polled state snapshots arrive every second or so. Keeping the previous object, and each unchanged field's previous
// value, when nothing changed spares a re-render of the whole workspace per poll (user report 2026-10-14: the app
// feels slow). Fields are compared by value; a changed field takes the new value.
const same=(a,b)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}};
export function mergeSnapshot(previous,next){
  if(!previous||!next||typeof next!=='object')return previous;
  let changed=false;const merged={...previous};
  for(const [key,value] of Object.entries(next)){if(!same(previous[key],value)){merged[key]=value;changed=true;}}
  return changed?merged:previous;
}
