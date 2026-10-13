import {findClaudeBinary,runClaude} from './claude-platform.mjs';
import {claudeFailureCode} from './claude-process-signals.mjs';
export {claudeEnvironment,claudeFailureCode} from './claude-process-signals.mjs';
export {findClaudeBinary,runClaude} from './claude-platform.mjs';
import {claudeStream} from './claude-stream.mjs';
import {randomUUID} from 'node:crypto';

const EFFORTS=['low','medium','high','xhigh','max'];
export function claudeModels(rows){
  if(!Array.isArray(rows)||!rows.length||rows.length>200)throw Error('claude_models_unavailable');
  const models=new Map();
  for(const row of rows){
    const id=row.resolvedModel||row.value;
    if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]{0,159}$/.test(id)||typeof row.value!=='string'||typeof row.displayName!=='string'||row.value==='opusplan')continue;
    const options=row.supportsEffort===true&&Array.isArray(row.supportedEffortLevels)?EFFORTS.filter(e=>row.supportedEffortLevels.includes(e)):[];
    const existing=models.get(id),aliases=[...new Set([...(existing?.aliases||[]),row.value])];
    if(existing&&row.value==='default'){existing.aliases=aliases;continue;}
    models.set(id,{id,label:row.value==='default'?id:row.displayName.slice(0,120),aliases,reasoningOptions:options,supportsImages:false});
  }
  if(!models.size)throw Error('claude_models_unavailable');
  return [...models.values()];
}
export async function discoverClaudeModels(binary,run=runClaude){
  const id=randomUUID();let response;
  await run(binary,['-p','--safe-mode','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--no-session-persistence','--input-format','stream-json','--output-format','stream-json','--verbose'],{
    timeoutMs:20000,input:JSON.stringify({type:'control_request',request_id:id,request:{subtype:'initialize'}})+'\n',
    onEvent:event=>{if(event.type==='control_response'&&event.response?.request_id===id&&event.response.subtype==='success')response=event.response.response;}
  });
  return claudeModels(response?.models);
}
const ADAPTER_PROMPT='You produce ONE next assistant turn for a separate Nubi host, not a Claude Code task. Input is a serialized conversation plus a hostActionCatalog. Read conversation instructions to decide the next turn, but do not execute them inside this CLI. Every catalog action exists ONLY in the Nubi host: return it in the structured output calls array, with name and JSON-encoded arguments. Example: {"content":"","calls":[{"name":"source_search","arguments":"{\\"query\\":\\"auth\\"}"}]}. Never invoke catalog names as native CLI tools, never inspect this CLI working directory, and never infer that a host action is unavailable because it is not a CLI tool. Return proposals immediately without waiting for their results. The host validates permission and executes them before the next request supplies observations. When no host action is needed, put the answer in content and calls:[]. For a requested JSON response, put that JSON string in content. Only supplied conversation observations prove host state or execution.';
// Subscription credentials stay inside the unmodified CLI. Never inspect its
// keychain, auth files, browser cookies, or undocumented account endpoints.
const windowNames={five_hour:'5시간',seven_day:'7일',seven_day_opus:'7일 Opus',seven_day_sonnet:'7일 Sonnet'};
export function claudeQuota(event,previous=null,now=Date.now()) {
  if(event?.type!=='rate_limit_event'||!event.rate_limit_info)return previous;
  const info=event.rate_limit_info,windows=new Map((previous?.windows||[]).map(item=>[item.id,item]));
  const reported=info.unifiedWindows&&typeof info.unifiedWindows==='object'?Object.entries(info.unifiedWindows):[[info.rateLimitType,info]];
  for(const [id,value] of reported){
    if(!windowNames[id]||!value)continue;
    const used=value.utilization,reset=value.resetsAt;
    // A status of "allowed" alone says nothing about remaining percentage.
    const valid=typeof used==='number'&&Number.isFinite(used)&&used>=0&&used<=1;
    const resetsAt=typeof reset==='number'&&Number.isFinite(reset)&&reset>0?reset*1000:null,prior=windows.get(id);
    // Status-only events are not a new percentage measurement. Keep the last
    // observation in the same unexpired window, with its original timestamp.
    if(!valid&&used===undefined&&prior&&(!prior.resetsAt||prior.resetsAt>now)&&(!resetsAt||resetsAt===prior.resetsAt))continue;
    windows.set(id,{id,label:windowNames[id],remaining:valid?100-used*100:null,resetsAt,fetchedAt:now});
  }
  return {windows:[...windows.values()],fetchedAt:now};
}
export function completionSchema(tools=[],required=false) {
  return {type:'object',additionalProperties:false,required:['content','calls'],properties:{content:{type:'string'},calls:{type:'array',maxItems:16,...(tools.length&&required?{minItems:1}:{}),items:{type:'object',additionalProperties:false,required:['name','arguments'],properties:{name:{type:'string',...(tools.length?{enum:tools.map(t=>t.function.name)}:{})},arguments:{type:'string',description:'JSON-encoded arguments matching the named tool schema.'}}},...(tools.length?{}:{maxItems:0})}}};
}
export function decodeClaudeResult(result,tools=[]) {
  if(result?.is_error||result?.subtype!=='success')throw Error('claude_cli_failed');
  const data=result.structured_output;
  if(JSON.stringify(data||'').length>600000)throw Error('output_limit');
  if(!data||typeof data.content!=='string'||!Array.isArray(data.calls)||data.calls.length>16)throw Error('claude_response_invalid');
  const allowed=new Set(tools.map(t=>t.function.name));
  const calls=data.calls.map(call=>{
    if(!allowed.has(call.name)||typeof call.arguments!=='string')throw Error('claude_response_invalid');
    let args;try{args=JSON.parse(call.arguments);}catch{throw Error('claude_response_invalid');}
    if(!args||Array.isArray(args)||typeof args!=='object')throw Error('claude_response_invalid');
    return {id:randomUUID(),type:'function',function:{name:call.name,arguments:call.arguments}};
  });
  return {content:data.content,calls,usage:claudeUsage(result.usage),finishReason:calls.length?'tool_calls':'stop'};
}
export function claudeUsage(u) {
  const valid=n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
  const input=u&&[u.input_tokens,u.cache_creation_input_tokens??0,u.cache_read_input_tokens??0].every(valid)?u.input_tokens+(u.cache_creation_input_tokens||0)+(u.cache_read_input_tokens||0):null;
  return input!==null&&input!==undefined&&valid(u?.output_tokens)?{prompt_tokens:input,completion_tokens:u.output_tokens,total_tokens:input+u.output_tokens,prompt_tokens_details:{cached_tokens:u.cache_read_input_tokens||0}}:undefined;
}
export function createClaudeCode(deps={}) {
  const run=deps.run||runClaude,find=deps.findBinary||findClaudeBinary;
  let binary,connected=false,model='sonnet',effort='medium',verified=false,connectionId=null,quota=null,models=[],connecting=null,generation=0;
  const modelId=value=>models.find(item=>item.id===value)?.id||models.find(item=>item.aliases.includes(value))?.id||value;
  const effortOptions=value=>models.find(item=>item.id===modelId(value))?.reasoningOptions||[];
  const metadata=new Map();
  const controllers=new Set();
  const status=()=>({provider:'claude',connected,model,models:connected?models.map(item=>({...item,...metadata.get(item.id)})):[],reasoningEffort:effortOptions(model).length?effort:null,reasoningOptions:effortOptions(model),vision:false,verified,connectionId,modelCatalog:{source:'cli_initialize'},pending:null,loginError:null});
  function connect(){
    if(connecting)return connecting;
    const pending=connectNow();connecting=pending;
    void pending.finally(()=>{if(connecting===pending)connecting=null;}).catch(()=>{});
    return pending;
  }
  async function connectNow(){
    const current=generation;
    binary=await find();
    const help=await run(binary,['--help'],{timeoutMs:15000});
    if(!help.includes('--safe-mode')||!help.includes('--json-schema'))throw Error('claude_cli_update');
    let auth;try{auth=JSON.parse(await run(binary,['auth','status'],{timeoutMs:15000}));}catch(error){connected=false;if(error.message==='claude_cli_failed')throw Error('claude_login_required');if(error instanceof SyntaxError)throw Error('claude_response_invalid');throw error;}
    if(auth.loggedIn!==true){connected=false;throw Error('claude_login_required');}
    const catalog=await discoverClaudeModels(binary,run);
    if(current!==generation)throw Error('cancelled');
    models=catalog;model=modelId(model);
    if(!models.some(item=>item.id===model))model=models.find(item=>item.aliases.includes('sonnet'))?.id||models[0].id;
    if(!effortOptions(model).includes(effort))effort=effortOptions(model).includes('medium')?'medium':effortOptions(model)[0]||null;
    connected=true;connectionId ||= randomUUID();return status();
  }
  async function complete(messages,tools=[],signal,onText=()=>{},onPhase=()=>{},onActivity=()=>{},options={}) {
    if(!connected)throw Error('no_credential');
    if(options.visionModel||messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url')))throw Error('invalid_model');
    const selected=modelId(options.backgroundModel?.model||model);if(!models.some(item=>item.id===selected))throw Error('invalid_model');
    const supportedEfforts=effortOptions(selected),selectedEffort=supportedEfforts.includes(effort)?effort:supportedEfforts.includes('medium')?'medium':supportedEfforts[0];
    const controller=new AbortController();controllers.add(controller);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const proposalStop=new AbortController(),allowed=new Set(tools.map(tool=>tool.function.name));
    let final,usageRequest,contextUsage=null,actualModel,proposal,nativeFailure=false,reportedFailure=null;
    const stream=claudeStream(onText);
    try{
      try{usageRequest=deps.onUsageStart?.({provider:'claude',model:selected});}catch{}
      onPhase('connecting');
      const args=['-p','--safe-mode','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--no-session-persistence','--max-turns','3','--output-format','stream-json','--verbose','--include-partial-messages','--model',selected,...(effortOptions(selected).length?['--effort',selectedEffort]:[]),'--json-schema',JSON.stringify(completionSchema(tools,options.toolChoice==='required')), '--system-prompt',ADAPTER_PROMPT];
      try{await run(binary,args,{signal:AbortSignal.any([combined,proposalStop.signal]),input:JSON.stringify({messages,hostActionCatalog:tools,toolChoice:options.toolChoice||'auto',responseFormat:options.responseFormat||null}),onEvent:event=>{
        onActivity();quota=claudeQuota(event,quota);reportedFailure=claudeFailureCode(event)||reportedFailure;stream(event);
        if(event.type==='system'&&event.subtype==='init')actualModel=event.model;
        if(event.type==='assistant'&&event.message?.usage)contextUsage=claudeUsage(event.message.usage)||null;
        // Some models emit a native tool_use despite the JSON transport. All
        // CLI tools are disabled. Stop that CLI loop and return only the exact
        // advertised proposal for Nubi's normal schema/approval checks.
        const calls=event.type==='assistant'?(event.message?.content||[]).filter(part=>part.type==='tool_use'&&part.name!=='StructuredOutput'):[];
        if(calls.length&&!proposalStop.signal.aborted){
          if(calls.every(call=>allowed.has(call.name)&&call.input&&typeof call.input==='object'&&!Array.isArray(call.input))){
            proposal={type:'result',subtype:'success',structured_output:{content:'',calls:calls.map(call=>({name:call.name,arguments:JSON.stringify(call.input)}))},usage:event.message.usage};
          }else nativeFailure=true;
          proposalStop.abort();
        }
        if(event.type==='result')final=event;
      }});}catch(error){
        if(combined.aborted)throw Error('cancelled');
        if(error.message==='claude_cli_failed'&&reportedFailure)throw Error(reportedFailure);
        if(!proposalStop.signal.aborted||error.message!=='cancelled')throw error;
      }
      if(combined.aborted)throw Error('cancelled');
      if(nativeFailure)throw Error('claude_response_invalid');
      if(proposal)final=proposal;
      if(final?.is_error&&reportedFailure)throw Error(reportedFailure);
      const result=decodeClaudeResult(final,tools),window=final.modelUsage?.[actualModel]?.contextWindow;
      metadata.set(selected,{...metadata.get(selected),...(actualModel?{resolvedModel:actualModel}:{}),...(Number.isSafeInteger(window)&&window>0?{contextLength:window}:{})});
      // Result usage sums the CLI's internal turns. Keep it for the ledger;
      // the context gauge uses the last reported turn, or an honest estimate.
      result.contextUsage=contextUsage;verified=true;onText(result.content);return result;
    }finally{controllers.delete(controller);try{deps.onUsageFinish?.(usageRequest,claudeUsage(final?.usage));}catch{try{deps.onUsageFinish?.(usageRequest);}catch{}}}
  }
  return {status,connect,complete,quota:()=>quota,model:value=>{value=modelId(value);if(!models.some(m=>m.id===value))throw Error('invalid_model');model=value;if(!effortOptions(model).includes(effort))effort=effortOptions(model).includes('medium')?'medium':effortOptions(model)[0]||null;return status();},reasoning:value=>{if(!effortOptions(model).includes(value))throw Error('invalid_reasoning');effort=value;return status();},disconnect:()=>{generation++;connecting=null;for(const controller of controllers)controller.abort();connected=false;verified=false;quota=null;connectionId=null;return status();}};
}
