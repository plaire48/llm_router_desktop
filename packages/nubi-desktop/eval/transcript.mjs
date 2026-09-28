// Records every model call of an evaluation run with its full messages, and
// enforces the per-case model call budget. Full text is kept because the
// corpora are public or synthetic: never point this at a company repository.
// Credentials never pass through here.
import {safeError} from '../../nubi-office/worker/connection-errors.mjs';

export function recordingProviders(providers,{write=()=>{},maxModelCalls=Infinity,modelLimits}={}){
  let sequence=0;
  const record=entry=>{try{write(entry);}catch{/* Recording must never change the run under test. */}};
  return{
    // A case may lower the context limit to exercise compaction. It can only lower.
    status(){
      const status=providers.status();
      if(!modelLimits)return status;
      return{...status,models:(status.models||[]).map(model=>model.id!==status.model?model:{...model,
        ...(Number.isSafeInteger(modelLimits.contextLength)?{contextLength:Math.min(model.contextLength||Infinity,modelLimits.contextLength)}:{}),
        ...(Number.isSafeInteger(modelLimits.maxInputTokens)?{maxInputTokens:Math.min(model.maxInputTokens||Infinity,modelLimits.maxInputTokens)}:{})})};
    },
    modelCalls:()=>sequence,
    // The relay connection belongs to the runner and outlives one case.
    dispose(){},
    async complete(messages,tools=[],signal,onText,onPhase){
      if(sequence>=maxModelCalls)throw Object.assign(new Error('evaluation_model_budget'),{retryable:false});
      const started=Date.now(),entry={sequence:++sequence,model:providers.status().model,startedAt:new Date(started).toISOString(),elapsedMs:0,
        request:{messages:structuredClone(messages),toolNames:tools.map(tool=>tool.function.name),characters:JSON.stringify(messages).length+JSON.stringify(tools).length}};
      try{
        const result=await providers.complete(messages,tools,signal,onText,onPhase);
        entry.elapsedMs=Date.now()-started;
        entry.response={content:result.content??'',calls:(result.calls||[]).map(call=>({name:call.function?.name,arguments:call.function?.arguments})),finishReason:result.finishReason,...(result.usage?{usage:structuredClone(result.usage)}:{})};
        record(entry);return result;
      }catch(error){
        entry.elapsedMs=Date.now()-started;entry.error={code:safeError(error),...(Number.isInteger(error?.status)?{status:error.status}:{})};
        record(entry);throw error;
      }
    }};
}

const LEADER='You are Nubi Desktop';
const systemText=entry=>entry.request.messages.find(message=>message.role==='system')?.content;
// The main agent's requests only. Planner, reviewer, summarizer and child analysts use other system prompts.
export const leaderEntries=entries=>entries.filter(entry=>typeof systemText(entry)==='string'&&systemText(entry).startsWith(LEADER));
// Text of every tool result the main agent received, in order, without duplicates.
export function leaderToolResults(entries){
  const seen=new Set(),results=[];
  for(const entry of leaderEntries(entries))for(const message of entry.request.messages){
    if(message.role!=='tool')continue;
    const text=typeof message.content==='string'?message.content:JSON.stringify((message.content||[]).filter(part=>part?.type==='text'));
    const key=(message.tool_call_id||'')+'\u0000'+text;
    if(!seen.has(key)){seen.add(key);results.push(text);}
  }
  return results;
}
