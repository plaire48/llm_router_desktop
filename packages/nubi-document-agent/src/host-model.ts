import {randomUUID} from 'node:crypto';
import type {AgentMessage,AgentToolCall} from '../vendor/genoffice/packages/agent-core/src/types';
import type {AgentTransport} from './types.js';
import {clone,fail} from './contracts.js';
export interface HostMessage {role:'system'|'user'|'assistant'|'tool';content:string|Array<{type:string;[key:string]:unknown}>;tool_calls?:Array<{id:string;type:'function';function:{name:string;arguments:string}}>;tool_call_id?:string}
export interface HostTool {type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}}
export interface HostCompletion {content:string;calls?:Array<{id:string;function:{name:string;arguments:string|Record<string,unknown>}}>;
  finishReason?:string;usage?:{prompt_tokens?:number;completion_tokens?:number}}
export interface HostModelPort {
  id:string;
  complete(messages:HostMessage[],tools:HostTool[],context:{signal:AbortSignal;modelId:string;onText:(text?:string)=>void;onActivity:()=>void}):Promise<HostCompletion>;
}
export interface HostModelMetric {kind:'model_start'|'first_content'|'model_end';callId:string;modelId:string;elapsedMs:number;tools?:string[];error?:string}
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const id=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=200&&!/[\x00-\x1f]/.test(x);
const safeError=(error:unknown)=>{const message=error instanceof Error?error.message:'';return ['claude_login_required','no_credential','rate_limited','cancelled','worker_disconnected','invalid_model','host_model_response_invalid'].includes(message)?message:'host_model_failed';};
function messages(system:string,history:AgentMessage[]):HostMessage[] {
  return [{role:'system',content:system},...history.flatMap((m):HostMessage[]=>{
    if(m.role==='user')return [{role:'user',content:m.images?.length?[{type:'text',text:m.text},...m.images.map(image=>({type:'image_url',image_url:{url:`data:${image.mime};base64,${image.base64}`}}))]:m.text}];
    if(m.role==='assistant')return [{role:'assistant',content:m.text,...(m.toolCalls?.length?{tool_calls:m.toolCalls.map(call=>({id:call.id,type:'function' as const,function:{name:call.name,arguments:JSON.stringify(call.input)}}))}:{})}];
    return m.results.map(result=>({role:'tool' as const,tool_call_id:result.id,content:result.isError?JSON.stringify({isError:true,output:result.output}):result.output}));
  })];
}
/** Value-only adapter. Host owns authentication/model selection; GenOffice continues to own this draft loop. */
export function createHostModelTransport(host:HostModelPort,options:{onMetric?:(metric:HostModelMetric)=>void}={}):AgentTransport {
  if(!id(host?.id)||typeof host.complete!=='function')fail('host_model_invalid');
  const modelId=host.id,complete=host.complete.bind(host);
  return {stream(request,callbacks){
    const controller=new AbortController(),callId=randomUUID(),started=performance.now();let closed=false,first=false;
    const metric=(kind:HostModelMetric['kind'],extra:Partial<HostModelMetric>={})=>{try{options.onMetric?.({kind,callId,modelId,elapsedMs:Math.round(performance.now()-started),...extra});}catch{}};
    const finish=(error?:string)=>{if(closed)return;closed=true;metric('model_end',error?{error}:{});if(error)callbacks.onError(error);else callbacks.onDone();};
    const cancel=()=>{if(closed)return;controller.abort();finish();};
    queueMicrotask(async()=>{
      if(closed)return;metric('model_start',{tools:request.tools.map(t=>t.name)});
      try{
        callbacks.onPhase?.({kind:'requesting'});
        const tools:HostTool[]=request.tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:clone(tool.inputSchema)}}));
        const result=await complete(messages(request.system,clone(request.messages)),tools,{signal:controller.signal,modelId,onText:()=>{if(!closed&&!first){first=true;metric('first_content');callbacks.onPhase?.({kind:'responding'});}},onActivity:()=>{}});
        if(closed)return;
        if(!record(result)||typeof result.content!=='string'||result.content.length>500_000||result.calls!==undefined&&!Array.isArray(result.calls)||(result.calls?.length??0)>16)fail('host_model_response_invalid');
        const seen=new Set<string>(),allowed=new Set(tools.map(tool=>tool.function.name)),calls:AgentToolCall[]=[];
        // Validate the complete response before dispatching any proposal.
        for(const call of result.calls??[]){
          if(!id(call?.id)||seen.has(call.id)||!allowed.has(call.function?.name))fail('host_model_response_invalid');seen.add(call.id);
          let input:unknown=call.function.arguments,inputError:string|undefined;
          try{if(typeof input==='string'){if(input.length>500_000)fail('host_model_response_invalid');input=JSON.parse(input);}if(!record(input))throw Error();}catch{input={};inputError='host_tool_arguments_invalid';}
          calls.push({id:call.id,name:call.function.name,input:clone(input as Record<string,unknown>),...(inputError?{inputError}:{})});
        }
        const usage=result.usage;
        if(usage&&Number.isSafeInteger(usage.prompt_tokens)&&usage.prompt_tokens!>=0&&Number.isSafeInteger(usage.completion_tokens)&&usage.completion_tokens!>=0)callbacks.onUsage?.({inputTokens:usage.prompt_tokens,outputTokens:usage.completion_tokens});
        if(result.finishReason==='length'||result.finishReason==='max_tokens')callbacks.onStopReason?.('max_tokens');
        if(result.content)callbacks.onDelta(result.content);for(const call of calls){if(closed)return;callbacks.onToolCall(call);}finish();
      }catch(error){if(!closed)finish(safeError(error));}
    });
    return {cancel};
  }};
}
