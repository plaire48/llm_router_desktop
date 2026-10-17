import {createHash} from 'node:crypto';
import {RECOVERABLE_CODES} from './tool-feedback.mjs';

// Host refusals and read failures can be corrected without rerunning an action.
// Permission, cancellation and uncertain writes remain the host's boundaries.
const excluded=new Set(['path_scope','git_access_denied','git_unsafe_directory','rules_unavailable','elevation_unavailable','elevation_approval_required','shell_unavailable']);
const recoverable=new Set(RECOVERABLE_CODES.filter(code=>!excluded.has(code)));
const metadata=new Set(['update_plan','discover_capabilities']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=(tool,args)=>createHash('sha256').update(JSON.stringify([tool,canonical(args)])).digest('hex');
export const TOOL_RECOVERY_GUIDANCE='When a tool fails, inspect its actual result and correct the cause using available tools. Change the path, range, arguments or method rather than repeating the same failure. Do not end with an error explanation or ask the user to do diagnostics you can perform. After a repair, inspect the new result against the original goal. Preserve approvals, cancellation, access restrictions and uncertain writes; never replay an issued command to obtain a better result.';

export function createToolRecoveryLoop({readTools,onContinue=()=>{}}){
  let pending=null,continuations=0;
  const failures=new Map(),alternatives=new Set();
  return {
    before(tool,args){
      const prior=failures.get(fingerprint(tool,args));
      if(!prior||prior.count<2)return null;
      return {ok:false,error:prior.error,actionIssued:false,recovery:{strategy:'change_method',execution:'not_started'},instruction:'This identical call already failed twice and was NOT executed again. Inspect the retained error, choose a different path/range/tool or correct the input from fresh evidence. Do not repeat it or ask the user to perform available diagnostics. Preserve scope and approval requirements.'};
    },
    observe(tool,args,result){
      if(result?.error||result?.ok===false){
        if(!recoverable.has(result.error)||result.execution==='unconfirmed'||result.execution==='unknown'||result.cancelled||!(result.actionIssued===false||readTools.has(tool))){pending=null;return;}
        const key=fingerprint(tool,args),prior=failures.get(key);
        failures.set(key,{error:result.error,count:(prior?.count||0)+1});
        if(failures.size>32)failures.delete(failures.keys().next().value);
        pending={tool,error:result.error};
      }else if(!metadata.has(tool)&&!result?.deferred&&result?.cancelled!==true){
        // An alternative supplied evidence or prepared a corrected proposal.
        // This only ends the recovery nudge; independent result review still owns completion.
        pending=null;failures.clear();
      }
    },
    stall(tool,args){
      const key=fingerprint(tool,args);
      if(!pending||!failures.has(key)||alternatives.has(key)||alternatives.size>=2)return false;
      alternatives.add(key);onContinue({...pending,strategy:'change_method'});return true;
    },
    settle({blocked=false}={}){
      if(blocked||!pending||continuations>=2)return {status:'accepted'};
      continuations++;onContinue({...pending,attempt:continuations});
      return {status:'revise',feedback:JSON.stringify({recoverableFailure:pending,instruction:TOOL_RECOVERY_GUIDANCE+' Use a concrete alternative before answering. If the failed lookup is genuinely unnecessary, answer from sufficient existing evidence and state any material limitation. Do not invent a successful recovery.'})};
    },
  };
}
