import type {Action,ActionOutcome,JsonObject,Observation,ObserveOptions,OpenTask} from './types.js';
export {createReplayMemory} from './replay-memory.js';
export type {ReviewedProcedure,ProcedureStore,ReplayMemoryOptions} from './replay-memory.js';

/** Historical guidance is never authorization, a current target ID or a task checkpoint. */
export interface ProcedureSummary {
  id:string;version:number;title:string;
  inputs:{slot:string;label:string}[];
}
export interface MemoryContext {projectId:string;task:OpenTask;observation:Observation;signal:AbortSignal}
export interface MemoryTrace {tool:string;arguments:JsonObject;receipt:Extract<ActionOutcome,{kind:'result'}>['receipt'];metadata?:JsonObject}
export interface ProcedureApi {
  observe(options?:ObserveOptions):Promise<Observation>;
  /** Bound to the latest observation, catalog, policy and durable receipt lane. */
  act(tool:string,args:JsonObject):Promise<JsonObject>;
}
export interface BrowserMemoryPort {
  /** Optional explicit read-only continuation, resolved against the procedure's fresh final observation. */
  followUp?:{required?:boolean;parameters:JsonObject;run(input:JsonObject,context:MemoryContext,api:ProcedureApi):Promise<JsonObject>};
  lookup(context:MemoryContext):Promise<{notes:string[];procedures:ProcedureSummary[]}>;
  /** The host resolves stored ID/version, checks wiki/scope before every step and uses its existing replay engine. */
  run(selection:{id:string;version:number;values:JsonObject},context:MemoryContext,api:ProcedureApi):Promise<JsonObject>;
  /** Optional one-use, run-local repair of unissued suffix targets chosen by the actor from fresh evidence. */
  resume?(selection:{continuationId:string;observationId:string;targets:{stepIndex:number;targetId:string}[]},context:MemoryContext,api:ProcedureApi):Promise<JsonObject>;
  /** Optional bounded metadata. A host reading live DOM must recheck access/binding first; credentials and reasoning are excluded. */
  capture?(context:MemoryContext,action:Action):Promise<JsonObject|undefined>;
  /** Acknowledge a host-owned learning job only after independent task verification. Never auto-promote a draft. */
  learn?(experience:{projectId:string;task:OpenTask;trace:MemoryTrace[];signal:AbortSignal}):Promise<void>;
}
