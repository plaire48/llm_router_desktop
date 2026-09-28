// Records every model call of an evaluation run. Cases are synthetic, so full
// messages are kept for failure analysis. Credentials never pass through here:
// only messages, tool names, the response and safe error facts are recorded.
import {safeError} from '../../worker/connection-errors.mjs';
import {faultFacts} from '../../worker/fault-policy.mjs';

const NAMED={TASK_PLANNER:'planner',ACTION_REVIEWER:'action_review',STEP_REVIEWER:'step_review',RESULT_REVIEWER:'result_review',RECOVERY_PLANNER:'recovery'};
export function modelRole(messages){
  const system=messages.find(message=>message.role==='system')?.content;
  if(typeof system!=='string')return'other';
  if(system.startsWith('You are Nubi'))return'actor';
  const token=/^NUBI_([A-Z_]+[A-Z])/.exec(system)?.[1];
  return token?NAMED[token]??token.toLowerCase():'other';
}
export function recordingProviders(providers,write){
  let sequence=0;
  const record=entry=>{try{write(entry);}catch{/* Recording must never change the run under test. */}};
  return{...providers,
    status:()=>providers.status(),
    async complete(messages,tools=[],signal,onText,onPhase){
      const started=Date.now(),entry={sequence:++sequence,role:modelRole(messages),model:providers.status().model,startedAt:new Date(started).toISOString(),elapsedMs:0,
        request:{messages:structuredClone(messages),toolNames:tools.map(tool=>tool.function.name),characters:JSON.stringify(messages).length+JSON.stringify(tools).length}};
      try{
        const result=await providers.complete(messages,tools,signal,onText,onPhase);
        entry.elapsedMs=Date.now()-started;
        entry.response={content:result.content??'',calls:(result.calls||[]).map(call=>({name:call.function?.name,arguments:call.function?.arguments})),finishReason:result.finishReason,...(result.usage?{usage:structuredClone(result.usage)}:{})};
        record(entry);return result;
      }catch(error){
        entry.elapsedMs=Date.now()-started;entry.error={code:safeError(error),...faultFacts(error)};
        record(entry);throw error;
      }
    }};
}
export function summarize(entries){
  const count=(target,key)=>{target[key]=(target[key]||0)+1;},summary={modelCalls:entries.length,byRole:{},elapsedMs:0,requestCharacters:0,peakRequestCharacters:0,toolCalls:{},errors:{}};
  for(const entry of entries){
    count(summary.byRole,entry.role);summary.elapsedMs+=entry.elapsedMs;summary.requestCharacters+=entry.request.characters;summary.peakRequestCharacters=Math.max(summary.peakRequestCharacters,entry.request.characters);
    for(const call of entry.response?.calls||[])count(summary.toolCalls,call.name);
    if(entry.error)count(summary.errors,entry.error.code);
  }
  return summary;
}
