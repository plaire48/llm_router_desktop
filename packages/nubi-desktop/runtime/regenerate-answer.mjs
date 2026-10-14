import {randomUUID} from 'node:crypto';
import {requireWikiChatReady} from './wiki-chat-admission.mjs';
import {conversationMessages} from './conversation-context.mjs';

// Redo the latest request through the ordinary agent, including tools and review.
// Superseded answers are archived separately; operation receipts are never erased.
export async function regenerateAnswer({taskId,messageId}={}){
  this.ready();
  requireWikiChatReady(this);
  if (this.agent?.running || this.skillImportBusy || this.computerBusy || this.newFileBusy || this.setupBusy || this.reconciling) throw Error('agent_busy');
  if (this.unsettledOperations?.size) throw Error('tool_unsettled');
  const provider = this.providers?.status();
  if (!provider?.connected) throw Error('provider_missing');
  const task = this.task(taskId), source = task.messages?.at(-1);
  if (task.state !== 'review' || task.question || task.peerWait || ['pending','connected'].includes(task.computerConnectionRequest?.state) ||
      source?.role !== 'assistant' || !source.content || (messageId !== undefined && source.id !== messageId)) throw Error('answer_changed');
  const pending = ['proposal:','setup-action:','command-repair:','computer-action:'].flatMap(prefix =>
    this.store.list(prefix).filter(row => row.taskId === taskId && ['proposed','starting'].includes(row.state)).map(row=>({key:prefix+row.id,row})));
  if(pending.some(({row})=>row.state==='starting'))throw Error('approval_pending');
  if(this.store.list('process:').some(row => row.taskId === taskId && ['running','stopping','checking'].includes(row.state)))throw Error('regeneration_process_active');


  const store=this.store,revisionId=randomUUID(),original=structuredClone(task);
  conversationMessages(task);
  const priorRun=source.runId||task.responseTiming?.runId;
  const next={...task,messages:task.messages.slice(0,-1),state:'ready',error:null,workPlan:null,resultReview:null,trace:[],sources:[],changePlan:null,checkpoint:null,responseTiming:null,recovery:null,
    activityHistory:(task.activityHistory||[]).filter(run=>run.runId!==priorRun),thoughts:(task.thoughts||[]).filter(thought=>thought.runId!==priorRun),
    replyRegeneration:{state:'requested',revisionId,messageId:source.id},context:{...task.context,phase:'ready'}};
  // The old answer and its unapproved proposals move together. A storage
  // failure must not leave half of a redo visible or erase execution receipts.
  store.db.exec('BEGIN IMMEDIATE');
  try{
    store.set('answer-revision:'+revisionId,{taskId,at:new Date().toISOString(),message:source,activityHistory:task.activityHistory||[],workPlan:task.workPlan||null,resultReview:task.resultReview||null,supersededActions:pending});
    for(const {key,row} of pending)store.set(key,{...row,state:'superseded',supersededBy:revisionId});
    store.set('task:'+taskId,next);store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
  try{
    const result=await this.startAgent({taskId,mailReferences:task.mailReferences||[]});
    try{store.event('answer_redo_started',{taskId,runId:result.runId,revisionId});}catch{}
    return result;
  }catch(error){
    // Failure before a new run starts restores the visible answer. Once tools
    // run, normal interruption/recovery owns the new task and its receipts.
    if(this.store===store&&!this.disposed&&!this.agent?.running){
      store.set('task:'+taskId,original);
      for(const {key,row} of pending)if(store.get(key)?.supersededBy===revisionId)store.set(key,row);
      store.delete('answer-revision:'+revisionId);
    }
    throw error;
  }
}
