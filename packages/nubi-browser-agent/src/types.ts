export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type TaskState = 'RUNNING' | 'WAITING_FOR_USER' | 'REVALIDATING' | 'VERIFYING' | 'COMPLETED' | 'PAUSED' | 'CANCELLED';
export type Lifecycle = 'READY' | 'DRAINING' | 'DETACHED';
export type WaitKind = 'login' | 'captcha' | 'file_selection' | 'approval' | 'clarification';
export interface Scope { projectId: string; taskId: string }
export interface Owner { addonId: string; instanceId: string; projectId: string; generation: number }
export interface Binding { tabId: string; documentId: string; revision: string; frameTreeRevision?: string }
export interface ObserveOptions { mode?: 'accessibility' | 'structure'; frameId?: string }
export interface Observation { state: 'ready' | 'login_required' | 'forbidden'; binding: Binding; observationId: string; data?: Json }
export interface Tool { name: string; effect: 'read' | 'write'; description?: string; parameters?: JsonObject }
export interface Action { actionId: string; tool: string; arguments: JsonObject; binding: Binding; catalogVersion: number; observationId?: string }
export interface Receipt {
  actionId: string; fingerprint: string; tool: string; effect: Tool['effect'];
  status: 'not_started' | 'issued' | 'confirmed' | 'unconfirmed'; evidenceRefs: string[];
}
export interface QuestionInput {
  question:string;choices?:string[];inputMode?:'text'|'long_text';inputPlaceholder?:string;
  /** Display-only observed labels. Never selectors, form values or execution permission. */
  context?:{title:string;element:string};
  /** Opaque host learning correlation; meaningful only to the injected learning port. */
  learningKey?:string;
}
export interface PendingInput extends Partial<QuestionInput> { requestId: string; kind: WaitKind; instanceId: string; generation: number; actionId?: string; fingerprint?: string }
export interface Checkpoint {
  schemaVersion: 1; version: number; scope: Scope; runId: string; request: string;
  criteria: string[]; state: TaskState; receipts: Receipt[]; pending: PendingInput | null;
}
export interface ExecutionResult { status: Receipt['status']; evidenceRefs: string[]; data?: Json; observation?: Observation }
export interface Verification { criteria: { id: string; satisfied: boolean; evidenceRefs: string[] }[] }
export interface CompletionCandidate { answer: string }
export interface OperationContext { owner: Owner; lease: string; scope: Scope; signal: AbortSignal }
export interface PolicyContext extends OperationContext { action: Action; fingerprint: string; approvalRequestId?: string }

/** The host owns tab leases, auth protection, current DOM revisions and result oracles. */
export interface BrowserPort {
  acquire(owner: Owner): Promise<string>;
  release(lease: string): Promise<void>;
  tools(lease: string, signal: AbortSignal): Promise<Tool[]>;
  observe(context: OperationContext, tabId: string, options?: ObserveOptions): Promise<Observation>;
  validate(context: OperationContext, binding: Binding): Promise<boolean>;
  execute(context: OperationContext, action: Action): Promise<ExecutionResult>;
  reconcile(context: OperationContext, receipt: Receipt): Promise<ExecutionResult>;
  verify(context: OperationContext, checkpoint: Checkpoint, candidate?: CompletionCandidate): Promise<Verification>;
}
export interface TaskStorePort {
  read(scope: Scope): Promise<Checkpoint | null>;
  /** True acknowledges an atomic, durable record before external dispatch, not a deferred write. */
  compareAndSet(scope: Scope, expectedVersion: number | null, checkpoint: Checkpoint): Promise<boolean>;
  /** Finish pending storage work before ownership is released. */
  flush(scope: Scope): Promise<void>;
}
export interface HumanRequest extends PendingInput { scope: Scope }
export interface Host {
  apiVersion: string;
  capabilities: readonly string[];
  browser: BrowserPort;
  store: TaskStorePort;
  policy: { decide(context: PolicyContext): Promise<'allow' | 'deny' | 'ask'> };
  human: { present(request: HumanRequest): Promise<void>; dismiss(requestId: string): Promise<void> };
  events: { emit(event: AddonEvent): void };
}
export interface AddonEvent {
  instanceId: string; generation: number; projectId: string; sequence: number;
  kind: 'attached' | 'checkpoint' | 'catalog' | 'draining' | 'detached';
  taskId?: string; stateVersion?: number; state?: TaskState;
}
export interface OpenTask { taskId: string; runId: string; request: string; criteria: string[] }
export interface ResumeInput { taskId: string; requestId: string; instanceId: string; generation: number }
export interface Options { drainTimeoutMs?: number }
export type ActionOutcome = { kind: 'waiting'; pending: PendingInput } | { kind: 'result'; receipt: Receipt; reused?: boolean; data?: Json; observation?: Observation };
