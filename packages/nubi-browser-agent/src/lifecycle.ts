import { abortable, bindingEqual, BrowserAgentError, clone, fail, fingerprint, id, validateAction, validateCheckpoint, validateHost, validateTools, validateObservation, validateQuestionInput } from './contracts.js';
import type {QuestionInput} from './types.js';
import type { Action, ActionOutcome, AddonEvent, Checkpoint, CompletionCandidate, ExecutionResult, Host, Lifecycle, Observation, ObserveOptions, OpenTask, OperationContext, Options, Owner, PendingInput, ResumeInput, Tool, Verification, WaitKind } from './types.js';

export const browserAgentManifest = Object.freeze({
  addonId: 'nubi.browser-agent', version: '0.5.0', addonApiVersion: '1.3.0',
  hostApiMajor: 1, checkpointSchemaVersion: 1,
  requiredCapabilities: Object.freeze(['browser', 'policy', 'human', 'task-store', 'events']),
  optionalCapabilities: Object.freeze(['model', 'knowledge', 'devtools', 'stagehand', 'browser-use']),
});
type Entry = { record: Checkpoint; expected: number | null; dirty: boolean };
const terminal = (r: Checkpoint) => r.state === 'COMPLETED' || r.state === 'CANCELLED';
const unresolved = (r: Checkpoint) => r.receipts.some(x => x.status === 'issued' || x.status === 'unconfirmed');
const safeResult = (r: ExecutionResult): ExecutionResult => {
  if (!r || !['confirmed','not_started','unconfirmed'].includes(r.status) || !Array.isArray(r.evidenceRefs) || r.evidenceRefs.length > 64 || r.evidenceRefs.some(x => !id(x))) return {status:'unconfirmed', evidenceRefs:[]};
  return clone(r);
};

/** No UI, provider, Electron or storage implementation is owned by this session. */
export class BrowserSession {
  #state: Lifecycle = 'READY';
  #entries = new Map<string, Entry>();
  #observations = new Map<string, Observation>();
  #pendingActions = new Map<string, Action>();
  #controllers = new Map<AbortController, string | undefined>();
  #cancelledTasks = new Set<string>();
  #tail: Promise<unknown> = Promise.resolve();
  #active = new Set<Promise<unknown>>();
  #listeners = new Set<(event: AddonEvent) => void>();
  #sequence = 0;
  #catalogVersion = 1;
  #tools: Tool[];
  #draining: Promise<void> | null = null;
  #detaching: Promise<void> | null = null;
  #lastError: string | null = null;

  constructor(private readonly host: Host, readonly owner: Readonly<Owner>, private readonly lease: string, tools: Tool[], private readonly timeoutMs: number) {
    this.owner = Object.freeze(clone(owner)); this.#tools = validateTools(tools); this.#emit('attached');
  }
  get lifecycle(): Lifecycle { return this.#state; }
  status() { return {lifecycle:this.#state, owner:clone(this.owner), sequence:this.#sequence, catalogVersion:this.#catalogVersion, lastError:this.#lastError}; }
  catalog() { return {version:this.#catalogVersion, tools:clone(this.#tools)}; }
  subscribe(listener: (event: AddonEvent) => void): () => void {
    if (this.#state === 'DETACHED') fail('addon_detached');
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  #emit(kind: AddonEvent['kind'], record?: Checkpoint) {
    const event: AddonEvent = {instanceId:this.owner.instanceId,generation:this.owner.generation,projectId:this.owner.projectId,sequence:++this.#sequence,kind,...(record?{taskId:record.scope.taskId,stateVersion:record.version,state:record.state}:{})};
    // A failing observer must never turn an acknowledged write into a failed dispatch.
    try { this.host.events.emit(clone(event)); } catch { /* Observer only. */ }
    for (const listener of this.#listeners) { try { listener(clone(event)); } catch { /* Observer only. */ } }
  }
  #entry(taskId: string): Entry {
    const e = this.#entries.get(taskId); if (!e) return fail('task_not_open');
    if (e.dirty) fail('checkpoint_unsaved'); return e;
  }
  #context(e: Entry, signal: AbortSignal): OperationContext {
    return {owner:clone(this.owner),lease:this.lease,scope:clone(e.record.scope),signal};
  }
  async #save(e: Entry): Promise<void> {
    e.dirty = true;
    const next = clone({...e.record,version:(e.expected ?? 0)+1});
    let accepted: boolean;
    try { accepted = await this.host.store.compareAndSet(next.scope,e.expected,next); }
    catch { return fail('checkpoint_write_failed'); }
    if (!accepted) fail('checkpoint_conflict');
    e.record = next; e.expected = next.version; e.dirty = false; this.#emit('checkpoint',next);
  }
  #work<T>(operation: (signal: AbortSignal) => Promise<T>, taskId?: string): Promise<T> {
    if (this.#state !== 'READY') return Promise.reject(new BrowserAgentError('addon_not_ready'));
    if(taskId && this.#cancelledTasks.has(taskId))return Promise.reject(new BrowserAgentError('task_cancelled'));
    const controller = new AbortController(); this.#controllers.set(controller,taskId);
    // One lane across this lease: even separate task IDs cannot race the same tab.
    const run = this.#tail.then(async () => {
      if (controller.signal.aborted || this.#state !== 'READY') fail('operation_cancelled');
      return operation(controller.signal);
    });
    this.#tail = run.catch(() => {}); this.#active.add(run);
    void run.finally(() => {this.#active.delete(run);this.#controllers.delete(controller);}).catch(() => {});
    return run;
  }
  openTask(input: OpenTask): Promise<Checkpoint> {
    input = clone(input);
    if (!id(input.taskId) || !id(input.runId) || typeof input.request !== 'string' || !input.request.trim() || input.request.length > 20_000 || !Array.isArray(input.criteria) || !input.criteria.length || input.criteria.length > 32 || input.criteria.some(x=>!id(x)) || new Set(input.criteria).size!==input.criteria.length) return Promise.reject(new BrowserAgentError('task_invalid'));
    return this.#work(async signal => {
      const present = this.#entries.get(input.taskId);
      if (present) {
        const e=this.#entry(input.taskId);
        if (e.record.request!==input.request || JSON.stringify(e.record.criteria)!==JSON.stringify(input.criteria)) fail('task_identity_changed');
        return clone(e.record);
      }
      const scope={projectId:this.owner.projectId,taskId:input.taskId};
      const saved = await abortable(this.host.store.read(scope),signal);
      let e: Entry;
      if (saved) {
        validateCheckpoint(saved,scope.projectId,scope.taskId);
        if (saved.request!==input.request || JSON.stringify(saved.criteria)!==JSON.stringify(input.criteria)) fail('task_identity_changed');
        e={record:clone(saved),expected:saved.version,dirty:false};
        for(const receipt of e.record.receipts) if(receipt.status==='issued') receipt.status='unconfirmed';
        if (!terminal(e.record)) e.record.state='PAUSED';
      } else e={record:{schemaVersion:1,version:0,scope,runId:input.runId,request:input.request,criteria:input.criteria,state:'RUNNING',receipts:[],pending:null},expected:null,dirty:false};
      this.#entries.set(input.taskId,e); await this.#save(e); return clone(e.record);
    },input.taskId);
  }
  checkpoint(taskId: string): Checkpoint { return clone(this.#entry(taskId).record); }
  pauseTask(taskId: string): Promise<Checkpoint> {
    return this.#work(async()=>{const e=this.#entry(taskId);if(!terminal(e.record)&&e.record.state!=='WAITING_FOR_USER'){e.record.state='PAUSED';this.#observations.delete(taskId);await this.#save(e);}return clone(e.record);},taskId);
  }
  requestInput(taskId: string, input: QuestionInput): Promise<PendingInput> {
    input=clone(input);
    try{validateQuestionInput(input);}catch(error){return Promise.reject(error);}
    return this.#work(async()=>{const e=this.#entry(taskId);if(terminal(e.record)||e.record.pending)fail('task_not_questionable');
      const pending:PendingInput={...input,requestId:crypto.randomUUID(),kind:'clarification',instanceId:this.owner.instanceId,generation:this.owner.generation};
      e.record.pending=pending;e.record.state='WAITING_FOR_USER';this.#observations.delete(taskId);await this.#save(e);
      try{await this.host.human.present({...clone(pending),scope:clone(e.record.scope)});}catch{fail('human_unavailable');}return clone(pending);
    },taskId);
  }
  resumeTask(taskId: string): Promise<Checkpoint> {
    return this.#work(async () => {
      const e=this.#entry(taskId); if(terminal(e.record)) fail('task_terminal');
      if(e.record.state!=='PAUSED') fail('task_not_paused');
      if(e.record.pending) {await this.host.human.dismiss(e.record.pending.requestId);this.#pendingActions.delete(e.record.pending.requestId);}
      e.record.pending=null;e.record.state='REVALIDATING';this.#observations.delete(taskId);await this.#save(e);return clone(e.record);
    },taskId);
  }
  async #wait(e: Entry, kind: WaitKind, action?: Action, fp?: string): Promise<PendingInput> {
    const pending: PendingInput={requestId:crypto.randomUUID(),kind,instanceId:this.owner.instanceId,generation:this.owner.generation,...(action?{actionId:action.actionId,fingerprint:fp}:{})};
    e.record.pending=pending;e.record.state='WAITING_FOR_USER';
    if(action)this.#pendingActions.set(pending.requestId,clone(action));
    await this.#save(e);
    try {await this.host.human.present({...clone(pending),scope:clone(e.record.scope)});} catch {fail('human_unavailable');}
    return clone(pending);
  }
  observe(taskId: string, tabId: string, options?: ObserveOptions): Promise<Observation> {
    options=options?clone(options):undefined;
    if(!id(tabId))return Promise.reject(new BrowserAgentError('tab_invalid'));
    return this.#work(async signal => {
      const e=this.#entry(taskId);if(!['RUNNING','REVALIDATING'].includes(e.record.state))fail('task_not_running');
      const observed=await abortable(this.host.browser.observe(this.#context(e,signal),tabId,options),signal);
      validateObservation(observed,tabId);
      this.#observations.delete(taskId);
      if(observed.state==='login_required') {
        await this.#wait(e,'login');
        return {state:observed.state,binding:clone(observed.binding),observationId:observed.observationId};
      }
      if(observed.state!=='ready') {e.record.state='PAUSED';await this.#save(e);return {state:'forbidden',binding:clone(observed.binding),observationId:observed.observationId};}
      this.#observations.set(taskId,clone(observed));e.record.state='RUNNING';await this.#save(e);return clone(observed);
    },taskId);
  }
  execute(taskId: string, action: Action): Promise<ActionOutcome> {
    try { action=clone(action);validateAction(action); } catch(error) {return Promise.reject(error);}
    return this.#work(signal=>this.#execute(this.#entry(taskId),action,signal),taskId);
  }
  async #execute(e: Entry, action: Action, signal: AbortSignal, approvalRequestId?: string): Promise<ActionOutcome> {
    const fp=await fingerprint(action),old=e.record.receipts.find(x=>x.actionId===action.actionId);
    if(old && old.fingerprint!==fp)fail('action_identity_changed');
    if(old?.status==='confirmed')return {kind:'result',receipt:clone(old),reused:true};
    if(old && ['issued','unconfirmed'].includes(old.status))fail('execution_unconfirmed');
    if(e.record.pending?.fingerprint===fp)return {kind:'waiting',pending:clone(e.record.pending)};
    if(e.record.state!=='RUNNING')fail('task_not_running');
    const tool=this.#tools.find(x=>x.name===action.tool);if(!tool)fail('tool_unavailable');
    if(action.catalogVersion!==this.#catalogVersion)fail('catalog_changed');
    if(tool.effect==='write' && unresolved(e.record))fail('execution_unconfirmed');
    const observed=this.#observations.get(e.record.scope.taskId);
    if(!observed || !bindingEqual(observed.binding,action.binding))fail('observation_required');
    if((action.observationId!==undefined || observed.binding.frameTreeRevision!==undefined) && observed.observationId!==action.observationId)fail('observation_changed');
    const context=this.#context(e,signal);
    const validate=async()=>{
      if(!await abortable(this.host.browser.validate(context,action.binding),signal)){
        this.#observations.delete(e.record.scope.taskId);e.record.state='REVALIDATING';await this.#save(e);fail('binding_changed');
      }
    };
    await validate();
    const policy=await abortable(this.host.policy.decide({...context,action:clone(action),fingerprint:fp,...(approvalRequestId?{approvalRequestId}:{})}),signal);
    if(policy==='ask')return {kind:'waiting',pending:await this.#wait(e,'approval',action,fp)};
    if(policy!=='allow')fail('policy_denied');
    await validate();
    const receipt=old ?? {actionId:action.actionId,fingerprint:fp,tool:tool.name,effect:tool.effect,status:'not_started' as const,evidenceRefs:[]};
    if(!old)e.record.receipts.push(receipt);
    receipt.status='issued';await this.#save(e);
    // #save replaces the checkpoint with a clone, so resolve the durable receipt again.
    const durable=e.record.receipts.find(x=>x.actionId===action.actionId)!;
    let dispatched=false,result:ExecutionResult;
    try {
      if(signal.aborted)fail('operation_cancelled');
      dispatched=true;
      result=safeResult(await abortable(this.host.browser.execute(context,clone(action)),signal));
    } catch {
      result={status:dispatched && tool.effect==='write'?'unconfirmed':'not_started',evidenceRefs:[]};
    }
    durable.status=result.status;durable.evidenceRefs=result.evidenceRefs;
    if(tool.effect==='write')this.#observations.delete(e.record.scope.taskId);
    if(result.status==='confirmed' && result.observation?.state==='ready'){
      try{validateObservation(result.observation,action.binding.tabId);this.#observations.set(e.record.scope.taskId,clone(result.observation));}
      catch{delete result.observation;}
    } else delete result.observation;
    if(result.status!=='confirmed')e.record.state='PAUSED';
    await this.#save(e);
    return {kind:'result',receipt:clone(durable),...(result.data!==undefined?{data:result.data}:{}),...(result.observation?{observation:clone(result.observation)}:{})};
  }
  respond(input: ResumeInput): Promise<Checkpoint | ActionOutcome> {
    input=clone(input);
    return this.#work(async signal=>{
      const e=this.#entry(input.taskId),pending=e.record.pending;
      if(!pending || e.record.state!=='WAITING_FOR_USER' || input.requestId!==pending.requestId || input.instanceId!==this.owner.instanceId || input.generation!==this.owner.generation || pending.instanceId!==this.owner.instanceId || pending.generation!==this.owner.generation)fail('input_stale');
      const action=this.#pendingActions.get(pending.requestId);
      e.record.pending=null;e.record.state='REVALIDATING';await this.#save(e);
      await abortable(this.host.human.dismiss(pending.requestId),signal);this.#pendingActions.delete(pending.requestId);
      if(!action){this.#observations.delete(input.taskId);return clone(e.record);}
      // Approval authorizes only the unchanged target; the host verifies the actual grant.
      if(!await abortable(this.host.browser.validate(this.#context(e,signal),action.binding),signal)){
        this.#observations.delete(input.taskId);return clone(e.record);
      }
      e.record.state='RUNNING';await this.#save(e);
      return this.#execute(e,action,signal,pending.requestId);
    },input.taskId);
  }
  reconcile(taskId: string, actionId: string): Promise<Checkpoint> {
    return this.#work(async signal=>{
      const e=this.#entry(taskId),receipt=e.record.receipts.find(x=>x.actionId===actionId);
      if(!receipt || !['issued','unconfirmed'].includes(receipt.status))fail('reconciliation_not_needed');
      const result=safeResult(await abortable(this.host.browser.reconcile(this.#context(e,signal),clone(receipt)),signal));
      if(result.status==='confirmed' && !result.evidenceRefs.length)fail('reconciliation_evidence_required');
      receipt.status=result.status;receipt.evidenceRefs=result.evidenceRefs;
      e.record.state='REVALIDATING';this.#observations.delete(taskId);await this.#save(e);return clone(e.record);
    },taskId);
  }
  complete(taskId: string, candidate?: CompletionCandidate): Promise<{completed:boolean; verification:Verification}> {
    candidate=candidate?clone(candidate):undefined;
    if(candidate&&(typeof candidate.answer!=='string'||candidate.answer.length>20_000))return Promise.reject(new BrowserAgentError('candidate_invalid'));
    return this.#work(async signal=>{
      const e=this.#entry(taskId);if(e.record.state!=='RUNNING' || e.record.pending || unresolved(e.record))fail('task_not_verifiable');
      e.record.state='VERIFYING';await this.#save(e);
      let verification:Verification;
      try {verification=clone(await abortable(this.host.browser.verify(this.#context(e,signal),clone(e.record),candidate),signal));}
      catch {e.record.state='PAUSED';await this.#save(e);return fail('verification_failed');}
      const rows=verification?.criteria;
      const completed=Array.isArray(rows) && rows.length===e.record.criteria.length && new Set(rows.map(x=>x.id)).size===rows.length && e.record.criteria.every(key=>rows.some(x=>x.id===key && x.satisfied===true && Array.isArray(x.evidenceRefs) && x.evidenceRefs.length>0 && x.evidenceRefs.every(id)));
      e.record.state=completed?'COMPLETED':'RUNNING';await this.#save(e);return {completed,verification};
    },taskId);
  }
  cancelTask(taskId: string): Promise<Checkpoint> {
    if(this.#state!=='READY')return Promise.reject(new BrowserAgentError('addon_not_ready'));
    const existing=this.#entry(taskId);if(existing.record.state==='COMPLETED')return Promise.reject(new BrowserAgentError('task_terminal'));
    this.#cancelledTasks.add(taskId);
    for(const [controller,ownerTask] of this.#controllers)if(ownerTask===taskId)controller.abort();
    return this.#work(async()=>{const e=this.#entry(taskId);if(e.record.state==='COMPLETED')fail('task_terminal');
      if(e.record.pending){await this.host.human.dismiss(e.record.pending.requestId);this.#pendingActions.delete(e.record.pending.requestId);}
      e.record.pending=null;e.record.state='CANCELLED';this.#observations.delete(taskId);await this.#save(e);return clone(e.record);
    });
  }
  refreshCatalog(): Promise<{version:number;tools:Tool[]}> {
    return this.#work(async signal=>{const next=validateTools(await abortable(this.host.browser.tools(this.lease,signal),signal));
      if(signal.aborted)fail('operation_cancelled');this.#tools=next;this.#catalogVersion++;this.#emit('catalog');return this.catalog();});
  }
  async #drain(): Promise<void> {
    if(this.#state==='DETACHED')return;
    this.#state='DRAINING';this.#emit('draining');
    for(const controller of this.#controllers.keys())controller.abort();
    let timer:ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.allSettled([...this.#active]),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new BrowserAgentError('drain_timeout')),this.timeoutMs);})]);
      for(const e of this.#entries.values()){
        if(!terminal(e.record))e.record.state='PAUSED';
        for(const receipt of e.record.receipts)if(receipt.status==='issued')receipt.status='unconfirmed';
        await this.#save(e);await this.host.store.flush(e.record.scope);
        if(e.record.pending)await this.host.human.dismiss(e.record.pending.requestId);
      }
      this.#pendingActions.clear();this.#observations.clear();this.#lastError=null;
    }catch(error){this.#lastError=error instanceof BrowserAgentError?error.code:'checkpoint_flush_failed';throw new BrowserAgentError(this.#lastError);}
    finally{clearTimeout(timer);}
  }
  suspend(): Promise<void> {
    if(this.#state==='DETACHED')return Promise.resolve();
    if(!this.#draining)this.#draining=this.#drain().finally(()=>{this.#draining=null;});
    return this.#draining;
  }
  detach(): Promise<void> {
    if(this.#state==='DETACHED')return Promise.resolve();
    if(!this.#detaching)this.#detaching=(async()=>{
      await this.suspend();
      try {await this.host.browser.release(this.lease);}catch{this.#lastError='lease_release_failed';fail('lease_release_failed');}
      this.#state='DETACHED';this.#emit('detached');this.#listeners.clear();
    })().finally(()=>{this.#detaching=null;});
    return this.#detaching;
  }
}

/** Registration has no I/O. Host ports are touched only by attach or an explicit operation. */
export function createBrowserAddon(options: Options = {}) {
  const timeout=options.drainTimeoutMs ?? 3000;
  if(!Number.isFinite(timeout) || timeout<10 || timeout>60_000)fail('drain_timeout_invalid');
  let session:BrowserSession | null=null, attaching:Promise<BrowserSession> | null=null;
  let attachedHost:Host | null=null, project:string | null=null,generation=0,disposed=false;
  let orphan:{host:Host;lease:string} | null=null;
  const detach=async()=>{
    let current=session;
    if(attaching){try{current=await attaching;}catch{if(!orphan)return;}}
    await current?.detach();
    if(orphan){try{await orphan.host.browser.release(orphan.lease);}catch{fail('attach_cleanup_failed');}orphan=null;}
  };
  return {
    manifest:browserAgentManifest,
    attach(host:Host,input:{projectId:string}):Promise<BrowserSession>{
      if(disposed)return Promise.reject(new BrowserAgentError('addon_disposed'));
      if(orphan && !attaching)return Promise.reject(new BrowserAgentError('attach_cleanup_required'));
      try{validateHost(host);if(!id(input.projectId))fail('project_invalid');}catch(error){return Promise.reject(error);}
      if(attaching || session?.lifecycle!=='DETACHED' && session){
        if(host!==attachedHost || project!==input.projectId)return Promise.reject(new BrowserAgentError('addon_already_attached'));
        if(attaching)return attaching;
        return session!.lifecycle==='READY'?Promise.resolve(session!):Promise.reject(new BrowserAgentError('addon_not_ready'));
      }
      attachedHost=host;project=input.projectId;
      const owner={addonId:browserAgentManifest.addonId,instanceId:crypto.randomUUID(),projectId:input.projectId,generation:++generation};
      attaching=(async()=>{
        const lease=await host.browser.acquire(owner);
        orphan={host,lease};
        try{if(!id(lease))fail('lease_invalid');const tools=validateTools(await host.browser.tools(lease,new AbortController().signal));session=new BrowserSession(host,owner,lease,tools,timeout);orphan=null;return session;}
        catch(error){try{await host.browser.release(lease);orphan=null;}catch{fail('attach_cleanup_failed');}throw error;}
      })().finally(()=>{attaching=null;});
      return attaching;
    },
    detach,
    async dispose(){await detach();disposed=true;},
  };
}
