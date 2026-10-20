import type { Binding, Checkpoint, Host, Json, Scope, Snapshot, Task } from './types.js';

export class DocumentAgentError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'DocumentAgentError'; }
}
export function fail(code: string): never { throw new DocumentAgentError(code); }
export const clone = <T>(value: T): T => structuredClone(value);
export const validId = (x: unknown): x is string => typeof x === 'string' && /^[\w.:/-]{1,160}$/.test(x);
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, Json>)[key])).join(',') + '}';
  }
  return fail('invalid_data');
}
export async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const sameDocument = (a: Binding, b: Binding): boolean => a.app === b.app && a.officeSessionId === b.officeSessionId && a.documentId === b.documentId;
export function validateTask(task: Task): void {
  if (!task || !validId(task.taskId) || !validId(task.runId) || !validId(task.targetRef) || typeof task.request !== 'string' || !task.request.trim() || task.request.length > 16_000) fail('task_invalid');
}
export function validateSnapshot(snapshot: Snapshot): void {
  const b = snapshot?.binding;
  if (!b || b.app !== 'word' || !validId(b.officeSessionId) || !validId(b.documentId) || !validId(b.revision)) fail('document_binding_invalid');
  if (!Array.isArray(snapshot.blocks) || !snapshot.blocks.length || snapshot.blocks.length > 200) fail('snapshot_invalid');
  const blocks = new Set<string>(), runs = new Set<string>();
  for (const block of snapshot.blocks) {
    if (!validId(block?.id) || blocks.has(block.id) || !Array.isArray(block.runs) || !block.runs.length) fail('snapshot_invalid');
    blocks.add(block.id);
    for (const run of block.runs) {
      if (!validId(run?.id) || runs.has(run.id) || typeof run.text !== 'string') fail('snapshot_invalid');
      runs.add(run.id);
    }
  }
  if (canonical(snapshot).length > 80_000) fail('snapshot_too_large');
}
export function validateCheckpoint(cp: Checkpoint, scope: Scope): void {
  if (cp?.schemaVersion !== 1) fail('checkpoint_schema_incompatible');
  if (cp.scope?.projectId !== scope.projectId || cp.scope.taskId !== scope.taskId || !Number.isSafeInteger(cp.version) || cp.version < 1 || cp.saved !== false) fail('checkpoint_invalid');
  validateTask(cp.task);
  if (cp.task.taskId !== scope.taskId) fail('checkpoint_invalid');
  if (!['PREPARING','WAITING_APPROVAL','APPLYING','COMPLETED','CONFLICT','UNCONFIRMED','VERIFICATION_FAILED','INCOMPLETE','FAILED','CANCELLED','PAUSED'].includes(cp.state)) fail('checkpoint_invalid');
  if (cp.before) validateSnapshot(cp.before);
}
export function validateHost(host: Host): void {
  if (!host || !/^1\.\d+\.\d+$/.test(host.apiVersion) || !validId(host.instanceId)) fail('host_incompatible');
  for (const [port, methods] of [[host.model,['stream']], [host.document,['acquire','read','apply','reconcile','release']], [host.store,['read','compareAndSet']], [host.human,['present','dismiss']], [host.policy,['authorize']], [host.events,['emit']]] as const) {
    for (const method of methods) if (typeof (port as unknown as Record<string,unknown>)?.[method] !== 'function') fail('host_port_missing');
  }
}
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DocumentAgentError('operation_cancelled'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DocumentAgentError('operation_cancelled'));
    signal.addEventListener('abort', abort, {once:true});
    promise.then(value => {signal.removeEventListener('abort',abort);resolve(value);}, error => {signal.removeEventListener('abort',abort);reject(error);});
  });
}
