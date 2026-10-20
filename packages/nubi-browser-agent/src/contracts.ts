import type { Action, Binding, Checkpoint, Host, Json, Tool, Observation, QuestionInput } from './types.js';

export class BrowserAgentError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'BrowserAgentError'; }
}
export function fail(code: string): never { throw new BrowserAgentError(code); }
export const clone = <T>(value: T): T => structuredClone(value);
export const id = (value: unknown): value is string => typeof value === 'string' && /^[\w.:/-]{1,160}$/.test(value);
export function canonical(value: Json): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key]!)).join(',') + '}';
  return JSON.stringify(value);
}
export async function fingerprint(action: Action): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(action as unknown as Json));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const bindingEqual = (a: Binding, b: Binding): boolean => a.tabId === b.tabId && a.documentId === b.documentId && a.revision === b.revision && a.frameTreeRevision === b.frameTreeRevision;
export const validBinding = (x: Binding): boolean => !!x && id(x.tabId) && id(x.documentId) && id(x.revision) && (x.frameTreeRevision===undefined || id(x.frameTreeRevision));
export function validateObservation(value: Observation, tabId: string): void {
  if(!value || !validBinding(value.binding) || value.binding.tabId!==tabId || !id(value.observationId) || !['ready','login_required','forbidden'].includes(value.state))fail('observation_invalid');
}
function validJson(value: unknown, depth = 0): boolean {
  if(depth>32)return false;
  if(value===null || typeof value==='string' || typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value))return value.every(x=>validJson(x,depth+1));
  return typeof value==='object' && !!value && Object.getPrototypeOf(value)===Object.prototype && Object.values(value).every(x=>validJson(x,depth+1));
}
export function validateAction(action: Action): void {
  if (!action || !id(action.actionId) || !id(action.tool) || !validBinding(action.binding) || !Number.isSafeInteger(action.catalogVersion)) fail('action_invalid');
  if(action.observationId!==undefined&&!id(action.observationId))fail('action_invalid');
  try { if (!action.arguments || typeof action.arguments!=='object' || Array.isArray(action.arguments) || !validJson(action.arguments) || JSON.stringify(action.arguments).length > 20_000) fail('action_invalid'); }
  catch { fail('action_invalid'); }
}
export function validateTools(tools: Tool[]): Tool[] {
  if (!Array.isArray(tools) || tools.length > 64 || new Set(tools.map(x => x.name)).size !== tools.length || tools.some(x => !id(x.name) || !['read', 'write'].includes(x.effect))) fail('catalog_invalid');
  if(tools.some(x=>x.description!==undefined&&(typeof x.description!=='string'||x.description.length>2000)||x.parameters!==undefined&&(!validJson(x.parameters)||Array.isArray(x.parameters)||!x.parameters||typeof x.parameters!=='object'||JSON.stringify(x.parameters).length>16000)))fail('catalog_invalid');
  return clone(tools);
}
export function validateHost(host: Host): void {
  if (!host || !/^1\.\d+\.\d+$/.test(host.apiVersion)) fail('host_version_incompatible');
  for (const cap of ['browser', 'policy', 'human', 'task-store', 'events']) if (!host.capabilities?.includes(cap)) fail('host_capability_missing');
  for (const [port, methods] of [[host.browser, ['acquire','release','tools','observe','validate','execute','reconcile','verify']], [host.store, ['read','compareAndSet','flush']], [host.policy, ['decide']], [host.human, ['present','dismiss']], [host.events, ['emit']]] as const) {
    for (const method of methods) if (typeof (port as unknown as Record<string, unknown>)?.[method] !== 'function') fail('host_port_invalid');
  }
}
export function validateCheckpoint(value: Checkpoint, projectId: string, taskId: string): void {
  if (value.schemaVersion !== 1) fail('checkpoint_schema_incompatible');
  if (value.scope?.projectId !== projectId || value.scope.taskId !== taskId || !Number.isSafeInteger(value.version) || value.version < 1) fail('checkpoint_invalid');
  if (!Array.isArray(value.criteria) || !value.criteria.length || !Array.isArray(value.receipts) || !['RUNNING','WAITING_FOR_USER','REVALIDATING','VERIFYING','COMPLETED','PAUSED','CANCELLED'].includes(value.state)) fail('checkpoint_invalid');
  if(!id(value.runId) || typeof value.request!=='string' || value.criteria.some(x=>!id(x)) || new Set(value.criteria).size!==value.criteria.length || new Set(value.receipts.map(x=>x.actionId)).size!==value.receipts.length)fail('checkpoint_invalid');
  for(const r of value.receipts)if(!r || !id(r.actionId) || !id(r.tool) || !/^[a-f0-9]{64}$/.test(r.fingerprint) || !['read','write'].includes(r.effect) || !['not_started','issued','confirmed','unconfirmed'].includes(r.status) || !Array.isArray(r.evidenceRefs) || r.evidenceRefs.some(x=>!id(x)))fail('checkpoint_invalid');
  if(value.pending && (!id(value.pending.requestId) || !id(value.pending.instanceId) || !Number.isSafeInteger(value.pending.generation) || !['login','captcha','file_selection','approval','clarification'].includes(value.pending.kind)))fail('checkpoint_invalid');
  if(value.pending?.question!==undefined && (typeof value.pending.question!=='string'||!value.pending.question.trim()||value.pending.question.length>180))fail('checkpoint_invalid');
  if(value.pending?.choices!==undefined && (!Array.isArray(value.pending.choices)||value.pending.choices.length>4||value.pending.choices.some(x=>typeof x!=='string'||!x.trim()||x.length>80)))fail('checkpoint_invalid');
  if(value.pending?.kind==='clarification')validateQuestionInput(value.pending as QuestionInput);
}
export function validateQuestionInput(input:QuestionInput):void {
  if(!input||Object.keys(input).some(k=>!['question','choices','inputMode','inputPlaceholder','context','learningKey'].includes(k)&&!['requestId','kind','instanceId','generation'].includes(k))||typeof input.question!=='string'||!input.question.trim()||input.question.length>180)fail('question_invalid');
  if(input.choices!==undefined&&(!Array.isArray(input.choices)||input.choices.length>4||new Set(input.choices).size!==input.choices.length||input.choices.some(x=>typeof x!=='string'||!x.trim()||x.length>80)))fail('question_invalid');
  if(input.inputMode!==undefined&&!['text','long_text'].includes(input.inputMode)||input.inputPlaceholder!==undefined&&(typeof input.inputPlaceholder!=='string'||input.inputPlaceholder.length>100)||input.learningKey!==undefined&&!/^[a-f0-9]{64}$/.test(input.learningKey))fail('question_invalid');
  if(input.context!==undefined&&(!input.context||Object.keys(input.context).sort().join(',')!=='element,title'||Object.values(input.context).some(v=>typeof v!=='string'||!v.trim()||v.length>240)))fail('question_invalid');
}
/** A late port result cannot mutate module state after cancellation. The host must also fence dispatch. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new BrowserAgentError('operation_cancelled'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new BrowserAgentError('operation_cancelled'));
    signal.addEventListener('abort', abort, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
