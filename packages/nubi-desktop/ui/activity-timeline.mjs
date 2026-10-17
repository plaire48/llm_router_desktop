// Keep the host's event order. Never infer success from a later note or answer.
export function activityTimeline(trace,thoughts=[]) {
  // Preserve host tool order. Insert provider notes by their recorded time;
  // untimed legacy notes stay at the end instead of inventing chronology.
  const events=[...trace];
  for(const thought of thoughts){
    const at=Date.parse(thought.at||'');
    const index=Number.isFinite(at)?events.findIndex(event=>Date.parse(event.startedAt||event.at||'')>at):-1;
    const event={...thought,tool:'model_memo'};
    events.splice(index<0?events.length:index,0,event);
  }
  const blocks=[];
  for (const event of events) {
    if(event.tool==='model_memo'){blocks.push({kind:'memo',id:event.id,event});continue;}
    if(event.tool==='progress_note') { blocks.push({kind:'note',id:event.id,event}); continue; }
    if(event.tool==='update_plan') continue;
    const attention=['error','waiting','cancelled','deferred'].includes(event.status);
    const previous=blocks.at(-1);
    if(!attention&&previous?.kind==='tools'&&!previous.attention) previous.steps.push(event);
    else blocks.push({kind:'tools',id:event.id,attention,steps:[event]});
  }
  return blocks;
}
export function activityToolSummary(steps) {
  if(steps.length===1) return steps[0].label;
  const active=steps.findLast(step=>['running','queued'].includes(step.status));
  if(active) return active.label;
  const counts=new Map();
  for(const step of steps)counts.set(step.label,(counts.get(step.label)||0)+1);
  return [...counts].map(([label,count])=>`${label}${count>1?` ${count}회`:''}`).join(', ');
}
