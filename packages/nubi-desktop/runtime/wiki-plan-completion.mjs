// Repository planning only: prose is not a durable plan. Keep the same read
// transcript and let OpenWiki validate/commit the model's actual submit_plan.
export const WIKI_PLAN_REQUIRED={role:'user',content:'The repository plan has not been accepted yet. Keep the source observations and analysis above. Continue any necessary reads, then call submit_plan with the complete plan using its tool schema. A prose answer or a JSON code block does not submit the plan. Do not repeat completed reads or claim completion before the tool accepts it.'};

export function wikiPlanPending(messages,tools){
  if(!tools.some(tool=>tool.function?.name==='submit_plan'))return false;
  const ids=new Set();
  for(const message of messages){
    if(message.role==='assistant')for(const call of message.tool_calls||[])if(call.function?.name==='submit_plan')ids.add(call.id);
    if(message.role==='tool'&&ids.has(message.tool_call_id)){
      try{if(JSON.parse(message.content).status==='accepted')return false;}catch{/* Invalid/rejected results are not acceptance. */}
    }
  }
  return true;
}
