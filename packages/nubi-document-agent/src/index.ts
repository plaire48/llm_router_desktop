import { AgentLoop } from '../vendor/genoffice/packages/agent-core/src/loop';
import type { AgentRunResult } from '../vendor/genoffice/packages/agent-core/src/loop';
import type { Binding, Checkpoint, DocumentContext, Host, Proposal, Receipt, Scope, Snapshot, Task } from './types.js';
import { abortable, canonical, clone, DocumentAgentError, fail, fingerprint, sameDocument, validId, validateCheckpoint, validateHost, validateSnapshot, validateTask } from './contracts.js';
import { createWordSkill } from './word-skill.js';
export type * from './types.js';
export { DocumentAgentError } from './contracts.js';
export { createNativeWordReadPort } from './native-word.js';
export type { NativeReadTool, NativeWordBridge, NativeWordConnection, OfficeMember, MemberInfo, WordReadEvidence } from './native-word.js';
export { createOfficeXNativeReadCaller } from './native-stdio.js';
export type { OfficeXReadWire } from './native-stdio.js';
export {createNativeOfficeWritePort} from './native-write.js';
export type {NativeOfficeWriteConnection,NativeOfficeWriteRequest,NativeOfficeStep,NativeOfficeCheck} from './native-write.js';
export {createNativeOfficeSkill,runNativeOfficeTask} from './native-model.js';
export type {NativeOfficeModelInput,NativeOfficeModelOutcome,NativeOfficeAgentSkill} from './native-model.js';

export const manifest = Object.freeze({addonId:'nubi.document-authoring',version:'0.1.0',addonApiVersion:'1.0.0',checkpointSchemaVersion:1,hostApiMajor:1,capabilities:['word.readSnapshot','word.replaceTextInRun'] as const});
const payload = (cp: Checkpoint) => ({scope:cp.scope,task:cp.task,before:cp.before,approvalId:cp.proposal!.approvalId,generation:cp.proposal!.generation,patch:cp.proposal!.patch});

export function createDocumentAddon() {
  return {manifest, async attach(host: Host, scope: {projectId:string}) {
    validateHost(host);
    if (!validId(scope?.projectId)) fail('scope_invalid');
    return new DocumentSession(host,scope.projectId);
  }};
}

export class DocumentSession {
  private attached = true;
  private suspended = false;
  private generation = crypto.randomUUID();
  private sequence = 0;
  private active = new Map<string,{controller:AbortController;done:Promise<Checkpoint>}>();
  constructor(private host: Host, private projectId: string) {}
  private scope(taskId: string): Scope { if (!validId(taskId)) fail('task_invalid'); return {projectId:this.projectId,taskId}; }
  private emit(taskId: string, kind: string, state?: Checkpoint['state'], tool?: string): void {
    try { this.host.events.emit({instanceId:this.host.instanceId,generation:this.generation,sequence:++this.sequence,taskId,kind,...(state?{state}:{}),...(tool?{tool}:{})}); } catch { /* The durable task store remains authoritative. */ }
  }
  private async read(taskId: string): Promise<Checkpoint | null> {
    let cp: Checkpoint | null;
    try { cp = await this.host.store.read(this.scope(taskId)); } catch { return fail('store_unavailable'); }
    if (cp) validateCheckpoint(cp,this.scope(taskId));
    return cp ? clone(cp) : null;
  }
  private async put(cp: Checkpoint): Promise<Checkpoint> {
    const next = {...clone(cp),version:cp.version+1};
    let stored: boolean;
    try { stored = await this.host.store.compareAndSet(cp.scope,cp.version,next); } catch { return fail('store_unavailable'); }
    if (!stored) fail('store_conflict');
    cp.version = next.version;
    this.emit(cp.task.taskId,'state',cp.state);
    return clone(cp);
  }
  private work(taskId: string, fn: (signal:AbortSignal)=>Promise<Checkpoint>): Promise<Checkpoint> {
    if (!this.attached) return Promise.reject(new DocumentAgentError('session_detached'));
    if (this.suspended) return Promise.reject(new DocumentAgentError('session_suspended'));
    if (this.active.has(taskId)) return Promise.reject(new DocumentAgentError('task_busy'));
    const controller = new AbortController();
    const done = Promise.resolve().then(()=>fn(controller.signal));
    this.active.set(taskId,{controller,done});
    void done.then(()=>this.active.delete(taskId),()=>this.active.delete(taskId));
    return done;
  }
  private async withDocument<T>(cp: Checkpoint, signal: AbortSignal, fn: (ctx:DocumentContext)=>Promise<T>): Promise<T> {
    const scope = this.scope(cp.task.taskId);
    // The host must honor cancellation before granting a lease and before any dispatch.
    const acquired = await this.host.document.acquire(scope,cp.task.targetRef,signal);
    const ctx = {...clone(acquired),scope};
    try {
      if (signal.aborted) fail('operation_cancelled');
      if (!validId(ctx.leaseId)) fail('lease_invalid');
      return await fn(ctx);
    } finally { await this.host.document.release(ctx); }
  }
  private async observe(ctx: DocumentContext, signal: AbortSignal): Promise<Snapshot> {
    const snapshot = clone(await abortable(this.host.document.read(ctx,signal),signal));
    validateSnapshot(snapshot);
    if (!sameDocument(ctx.binding,snapshot.binding)) fail('document_binding_changed');
    return snapshot;
  }
  async inspect(taskId: string): Promise<Checkpoint | null> {
    if (!this.attached) fail('session_detached');
    return this.read(taskId);
  }
  prepare(task: Task): Promise<Checkpoint> {
    return this.work(task?.taskId,async signal=>{
      validateTask(task);
      const existing = await this.read(task.taskId);
      if (existing) {
        if (canonical(existing.task) !== canonical(task)) fail('task_conflict');
        return existing;
      }
      const cp: Checkpoint = {schemaVersion:1,version:0,scope:this.scope(task.taskId),task:clone(task),state:'PREPARING',verification:'not_run',saved:false};
      await this.put(cp);
      return this.prepareCheckpoint(cp,signal);
    });
  }
  private async prepareCheckpoint(cp: Checkpoint, signal: AbortSignal): Promise<Checkpoint> {
    try {
      await this.withDocument(cp,signal,async ctx=>{
        cp.before = await this.observe(ctx,signal);
        const word = createWordSkill(cp.before,signal);
        let stop = () => {};
        const completion = new Promise<AgentRunResult>((resolve,reject)=>{
          const loop = new AgentLoop({transport:this.host.model,skill:word.skill,maxTurns:8,compaction:false,events:{
            onToolStart:call=>this.emit(cp.task.taskId,'tool_started',undefined,call.name),
            onToolExecuted:e=>this.emit(cp.task.taskId,'tool_finished',undefined,e.call.name),
            onDone:resolve,onError:()=>reject(new DocumentAgentError('model_failed'))
          }});
          stop = ()=>loop.reset();
          signal.addEventListener('abort',stop,{once:true});
          loop.run(cp.task.request);
        });
        const result = await abortable(completion,signal).finally(()=>signal.removeEventListener('abort',stop));
        const patch = word.proposal();
        if (signal.aborted) fail('operation_cancelled');
        if (!patch || result.cancelled || result.turnLimit) {cp.state='INCOMPLETE';return;}
        cp.proposal = {approvalId:crypto.randomUUID(),fingerprint:'',generation:this.generation,patch};
        cp.proposal.fingerprint = await fingerprint(payload(cp));
        cp.state = 'WAITING_APPROVAL';
      });
      await this.put(cp);
      if (signal.aborted) fail('operation_cancelled');
      if (cp.proposal) await abortable(this.host.human.present({...clone(cp.proposal),taskId:cp.task.taskId},signal),signal);
      return clone(cp);
    } catch (error) {
      if (error instanceof DocumentAgentError && ['store_unavailable','store_conflict'].includes(error.code)) throw error;
      cp.state = signal.aborted ? (signal.reason === 'detach' ? 'PAUSED' : 'CANCELLED') : 'FAILED';
      cp.error = signal.aborted ? 'operation_cancelled' : 'preparation_failed';
      if (cp.proposal) {
        try {await this.host.human.dismiss(cp.proposal.approvalId);} catch {cp.error='approval_cleanup_pending';}
      }
      return this.put(cp);
    }
  }
  private async checkProposal(cp: Checkpoint): Promise<Proposal> {
    if (!cp.before || !cp.proposal || !validId(cp.proposal.approvalId) || cp.proposal.fingerprint !== await fingerprint(payload(cp))) fail('proposal_integrity_failed');
    return cp.proposal;
  }
  apply(taskId: string, approvalId: string): Promise<Checkpoint> {
    return this.work(taskId,async signal=>{
      const cp = await this.read(taskId); if (!cp) fail('task_missing');
      if (['COMPLETED','UNCONFIRMED','APPLYING','VERIFICATION_FAILED'].includes(cp.state)) return clone(cp);
      if (cp.state !== 'WAITING_APPROVAL') fail('task_not_awaiting_approval');
      const proposal = await this.checkProposal(cp);
      if (proposal.generation !== this.generation) fail('approval_stale');
      if (approvalId !== proposal.approvalId) fail('approval_mismatch');
      const authorized = await abortable(this.host.policy.authorize({...cp.scope,approvalId,fingerprint:proposal.fingerprint}),signal);
      if (!authorized) fail('approval_required');
      let issued = false;
      try {
        await this.withDocument(cp,signal,async ctx=>{
          const now = await this.observe(ctx,signal);
          if (canonical(now) !== canonical(cp.before)) {cp.state='CONFLICT';return;}
          cp.state='APPLYING'; await this.put(cp); issued=true;
          if (signal.aborted) fail('operation_cancelled');
          const receipt = await abortable(this.host.document.apply(ctx,clone(proposal.patch),signal),signal);
          this.acceptReceipt(cp,receipt);
          if (receipt.status === 'not_started') {cp.state='CONFLICT';return;}
          if (receipt.status !== 'confirmed') {cp.state='UNCONFIRMED';return;}
          await this.verify(cp,ctx,signal);
        });
        const result = await this.put(cp);
        try {await this.host.human.dismiss(approvalId);} catch { /* Approval records are never inferred from UI dismissal. */ }
        return result;
      } catch (error) {
        if (error instanceof DocumentAgentError && ['store_unavailable','store_conflict'].includes(error.code)) throw error;
        cp.state = issued ? 'UNCONFIRMED' : signal.aborted ? 'CANCELLED' : 'FAILED';
        cp.error = 'application_unconfirmed';
        return this.put(cp);
      }
    });
  }
  private acceptReceipt(cp: Checkpoint, receipt: Receipt): void {
    if (!receipt || receipt.operationId !== cp.proposal!.patch.operationId || !['confirmed','not_started','unconfirmed'].includes(receipt.status)) fail('receipt_invalid');
    cp.receipt = clone(receipt);
  }
  private async verify(cp: Checkpoint, ctx: DocumentContext, signal: AbortSignal): Promise<void> {
    const after = await this.observe(ctx,signal), expected = clone(cp.before!);
    const patch = cp.proposal!.patch;
    const run = expected.blocks.find(x=>x.id===patch.blockId)?.runs.find(x=>x.id===patch.runId);
    if (!run) fail('proposal_integrity_failed');
    run.text = run.text.slice(0,patch.start)+patch.newText+run.text.slice(patch.end);
    const correct = sameDocument(after.binding,expected.binding) && canonical(after.blocks) === canonical(expected.blocks);
    cp.verification = correct ? 'verified' : 'failed';
    cp.state = correct ? 'COMPLETED' : 'VERIFICATION_FAILED';
  }
  reconcile(taskId: string): Promise<Checkpoint> {
    return this.work(taskId,async signal=>{
      const cp = await this.read(taskId); if (!cp) fail('task_missing');
      if (!['UNCONFIRMED','APPLYING'].includes(cp.state)) return cp;
      const proposal = await this.checkProposal(cp);
      try {
        await this.withDocument(cp,signal,async ctx=>{
          if (!sameDocument(ctx.binding,proposal.patch.binding)) {cp.state='UNCONFIRMED';return;}
          const receipt = await abortable(this.host.document.reconcile(ctx,proposal.patch.operationId,signal),signal);
          this.acceptReceipt(cp,receipt);
          if (receipt.status === 'confirmed') await this.verify(cp,ctx,signal);
          else cp.state = receipt.status === 'not_started' ? 'CONFLICT' : 'UNCONFIRMED';
        });
      } catch {cp.state='UNCONFIRMED';}
      return this.put(cp);
    });
  }
  resume(taskId: string): Promise<Checkpoint> {
    this.suspended = false;
    return this.work(taskId,async signal=>{
      const cp = await this.read(taskId); if (!cp) fail('task_missing');
      if (!['PAUSED','CONFLICT','INCOMPLETE','FAILED','WAITING_APPROVAL'].includes(cp.state)) fail('task_not_resumable');
      if (cp.proposal) await abortable(this.host.human.dismiss(cp.proposal.approvalId),signal);
      delete cp.proposal; delete cp.before; delete cp.receipt; delete cp.error;
      cp.state='PREPARING';cp.verification='not_run';await this.put(cp);
      return this.prepareCheckpoint(cp,signal);
    });
  }
  async cancel(taskId: string): Promise<void> {
    if (!this.attached) fail('session_detached');
    const active = this.active.get(taskId);
    if (active) {active.controller.abort('cancel');await active.done.catch(()=>{});return;}
    const cp = await this.read(taskId); if (!cp || cp.state==='COMPLETED' || cp.state==='UNCONFIRMED') return;
    cp.state=cp.state==='APPLYING'?'UNCONFIRMED':'CANCELLED';await this.put(cp);
    if (cp.proposal) await this.host.human.dismiss(cp.proposal.approvalId);
  }
  async suspend(): Promise<void> {
    if (!this.attached) fail('session_detached');
    this.suspended=true;
    const pending = [...this.active.values()];
    for (const active of pending) active.controller.abort('detach');
    await Promise.all(pending.map(x=>x.done));
  }
  async detach(): Promise<void> {
    if (!this.attached) return;
    this.attached=false;
    const pending = [...this.active.values()];
    for (const active of pending) active.controller.abort('detach');
    await Promise.all(pending.map(x=>x.done));
  }
}
