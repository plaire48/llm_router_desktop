import type { AgentTransport } from '../vendor/genoffice/packages/agent-core/src/types.js';
export type { AgentTransport } from '../vendor/genoffice/packages/agent-core/src/types.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Scope { projectId: string; taskId: string }
export interface Task { taskId: string; runId: string; request: string; targetRef: string }
export interface Binding { app: 'word'; officeSessionId: string; documentId: string; revision: string }
export interface Run { id: string; text: string; style: Record<string, Json> }
export interface Block { id: string; style: Record<string, Json>; runs: Run[] }
export interface Snapshot { binding: Binding; blocks: Block[] }
export interface DocumentContext { scope: Scope; leaseId: string; binding: Binding }
export interface Patch {
  operationId: string; binding: Binding; blockId: string; runId: string;
  start: number; end: number; oldText: string; newText: string;
}
export interface Receipt { operationId: string; status: 'confirmed' | 'not_started' | 'unconfirmed' }
export interface Proposal { approvalId: string; fingerprint: string; generation: string; patch: Patch }
export type State = 'PREPARING' | 'WAITING_APPROVAL' | 'APPLYING' | 'COMPLETED' | 'CONFLICT' |
  'UNCONFIRMED' | 'VERIFICATION_FAILED' | 'INCOMPLETE' | 'FAILED' | 'CANCELLED' | 'PAUSED';
export interface Checkpoint {
  schemaVersion: 1; version: number; scope: Scope; task: Task; state: State;
  before?: Snapshot; proposal?: Proposal; receipt?: Receipt;
  verification: 'not_run' | 'verified' | 'failed'; saved: false; error?: string;
}
export interface Host {
  apiVersion: string; instanceId: string; model: AgentTransport;
  document: {
    acquire(scope: Scope, targetRef: string, signal: AbortSignal): Promise<{ leaseId: string; binding: Binding }>;
    read(context: DocumentContext, signal: AbortSignal): Promise<Snapshot>;
    /** Atomically check binding/revision/lease/old text before writing; preserve all other observed structure. */
    apply(context: DocumentContext, patch: Patch, signal: AbortSignal): Promise<Receipt>;
    /** Read an existing operation's receipt; never reissue a write. */
    reconcile(context: DocumentContext, operationId: string, signal: AbortSignal): Promise<Receipt>;
    release(context: DocumentContext): Promise<void>;
  };
  store: {
    read(scope: Scope): Promise<Checkpoint | null>;
    /** Resolve true only once the CAS update is durably committed under the host storage policy. */
    compareAndSet(scope: Scope, expectedVersion: number, next: Checkpoint): Promise<boolean>;
  };
  human: {
    /** Check cancellation and generation before showing a prompt, including after any UI await. */
    present(prompt: Proposal & { taskId: string }, signal: AbortSignal): Promise<void>;
    dismiss(approvalId: string): Promise<void>;
  };
  /** The host checks its real approval record for this exact proposal and current permission. */
  policy: { authorize(input: Scope & { approvalId: string; fingerprint: string }): Promise<boolean> };
  events: { emit(event: { instanceId: string; generation: string; sequence: number; taskId: string; kind: string; state?: State; tool?: string }): void };
}
