// Shared by the browser, the host and Markdown export. This never writes task.chapters.
export function workflowChapters(run){
 return (run?.workflow?.steps||[]).map(step=>{const checkpoint=run.steps?.[step.id];return {id:'step:'+step.id,stepId:step.id,title:step.name||step.id,status:checkpoint?.status||'pending',at:checkpoint?.startedAt||null,lane:step.lane};});
}
export function workflowChapterGroups(chapters,current){
 if(chapters.length<=20)return [{id:'all',chapters,current:true}];
 const lanes=chapters.some(chapter=>chapter.lane),groups=new Map();
 chapters.forEach((chapter,index)=>{const lane=lanes?(chapter.lane||'unassigned'):undefined,id=lanes?'lane:'+lane:'batch:'+Math.floor(index/10);if(!groups.has(id))groups.set(id,{id,lane,title:lanes?lane:`${Math.floor(index/10)*10+1}–${Math.min(chapters.length,Math.floor(index/10)*10+10)}`,chapters:[],current:false});const group=groups.get(id);group.chapters.push(chapter);if(chapter.stepId===current)group.current=true;});
 if(![...groups.values()].some(group=>group.current))groups.values().next().value.current=true;
 return [...groups.values()];
}
