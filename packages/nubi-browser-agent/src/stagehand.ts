import {LLMClient,toJsonSchema} from '@browserbasehq/stagehand';
import type {Stagehand,CreateChatCompletionOptions,LLMParsedResponse,LLMResponse,StagehandZodSchema} from '@browserbasehq/stagehand';
import {z} from 'zod';
import type {Page} from 'playwright-core';
import type {BrowserModelPort,WireMessage} from './pi.js';
import type {ScreenAnalyzer,ScreenAnalysis} from './knowledge.js';
import {screenAnalysisInstruction,validateScreenAnalysis} from './knowledge.js';
import {fail} from './contracts.js';
import type {JsonObject} from './types.js';

const schema=z.object({screenType:z.enum(['search','list','detail','editor','dashboard','other']),titleEvidenceId:z.string(),fieldEvidenceIds:z.array(z.string()).max(64),actionEvidenceIds:z.array(z.string()).max(64)}).strict();
export interface StagehandModelBridge {client:LLMClient;run<T>(signal:AbortSignal,authorize:()=>Promise<boolean>,operation:()=>Promise<T>):Promise<T>}
/** The host supplies an already initialized SDK instance and its authorized Page. No init/act/close calls. */
export function createStagehandScreenAnalyzer(options:{stagehand:Pick<Stagehand,'extract'>;modelBridge:StagehandModelBridge;page:Page;validate(evidence:import('./knowledge.js').ScreenEvidence,signal:AbortSignal):Promise<boolean>;selector?:string;timeoutMs?:number}):ScreenAnalyzer {
  const timeout=options.timeoutMs??60_000;if(!Number.isFinite(timeout)||timeout<100||timeout>180_000)fail('stagehand_timeout_invalid');
  return {id:'stagehand-3.7.3',async analyze(e,signal){
    signal.throwIfAborted();if(!await options.validate(e,signal))fail('screen_changed');const result=await options.modelBridge.run(signal,()=>options.validate(e,signal),()=>options.stagehand.extract(screenAnalysisInstruction(e),schema,{page:options.page,...(options.selector?{selector:options.selector}:{}),timeout}));signal.throwIfAborted();if(!await options.validate(e,signal))fail('screen_changed');
    const analysis=result as ScreenAnalysis;validateScreenAnalysis(analysis,e);return structuredClone(analysis);
  }};
}
/** SDK inference calls delegate to the host model. Authentication, cancellation and model selection stay outside. */
export function createStagehandModelBridge(model:BrowserModelPort):StagehandModelBridge {
  let active:{signal:AbortSignal;authorize:()=>Promise<boolean>}|undefined;
  class HostClient extends LLMClient {
    constructor(){super(model.id as ConstructorParameters<typeof LLMClient>[0]);this.type='nubi-host';this.hasVision=false;}
    async createChatCompletion<T>(request:CreateChatCompletionOptions&{options:{response_model:{name:string;schema:StagehandZodSchema}}}):Promise<LLMParsedResponse<T>>;
    async createChatCompletion<T=LLMResponse>(request:CreateChatCompletionOptions):Promise<T>;
    async createChatCompletion(request:CreateChatCompletionOptions):Promise<unknown>{
      const invocation=active;if(!invocation)fail('stagehand_inference_unbound');const current=invocation.signal;current.throwIfAborted();if(!await invocation.authorize())fail('stagehand_access_denied');current.throwIfAborted();const requested=request.options;
      if(requested.image||requested.tools?.length||!requested.response_model)fail('stagehand_inference_scope_invalid');
      const messages:WireMessage[]=requested.messages.map(m=>({role:m.role,content:typeof m.content==='string'?m.content:m.content.map(p=>{if(p.type!=='text'||typeof p.text!=='string')return fail('stagehand_vision_not_enabled');return p.text;}).join('\n')}));
      const parameters=toJsonSchema(requested.response_model.schema) as JsonObject;
      const response=await model.complete(messages,[{type:'function',function:{name:'screen_analysis',description:'Return the requested read-only structured extraction.',parameters}}],{signal:current,modelId:model.id,callId:crypto.randomUUID(),onEvent:()=>{}});current.throwIfAborted();
      if(response.calls?.length!==1||response.calls[0]?.function.name!=='screen_analysis')fail('stagehand_model_response_invalid');
      let parsed:unknown;try{parsed=JSON.parse(response.calls[0]!.function.arguments);}catch{return fail('stagehand_model_response_invalid');}
      const data=requested.response_model.schema.parse(parsed);
      return {data,usage:{prompt_tokens:response.usage?.prompt_tokens??0,completion_tokens:response.usage?.completion_tokens??0,total_tokens:(response.usage?.prompt_tokens??0)+(response.usage?.completion_tokens??0)}};
    }
  }
  return {client:new HostClient(),async run(signal,authorize,operation){if(active)fail('stagehand_busy');signal.throwIfAborted();active={signal,authorize};try{return await operation();}finally{active=undefined;}}};
}
