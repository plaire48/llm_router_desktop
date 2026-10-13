// Only fully read main instructions may survive an approved command boundary.
// Memory-only, task/action bound; no edit observations or execution permission.
const pending=new WeakMap();
export function holdCommandSkills(store,taskId,actionId,binding,loaded){
  let tasks=pending.get(store);if(!tasks){tasks=new Map();pending.set(store,tasks);}
  tasks.set(taskId,{actionId,binding,skills:[...loaded.entries()].filter(([,value])=>value.nextOffset===null&&value.instructions?.nextOffset===null&&(value.instructions.offset??0)===0).slice(0,4).map(([path,value])=>({path,hash:value.hash}))});
}
export async function takeCommandSkills(store,taskId,{actionId,binding,resumed,read}){
  const tasks=pending.get(store),held=tasks?.get(taskId);tasks?.delete(taskId);
  if(!resumed||!held||held.actionId!==actionId||held.binding!==binding)return [];
  const result=[];
  for(const skill of held.skills){
    try{const current=await read(skill);if(current.hash===skill.hash&&current.nextOffset===null&&(current.offset??0)===0)result.push(current);}catch{/* Changed/missing skills must be loaded normally. */}
  }
  return result;
}
