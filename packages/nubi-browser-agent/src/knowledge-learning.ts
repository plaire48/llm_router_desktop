import type {BrowserLearningPort} from './pi.js';
import type {MemoryContext} from './memory.js';
import type {QuestionInput} from './types.js';
import type {ScreenEvidence,ScreenKnowledgeRecord,ScreenLearningQuestion} from './knowledge.js';
import {createScreenKnowledge,sameKnowledgeScope,validateScreenRecord,validateScreenEvidence} from './knowledge.js';
import {abortable,clone,fail} from './contracts.js';

export type ScreenLearningOptions=Parameters<typeof createScreenKnowledge>[0]&{
  /** Bind the injected source to this Pi observation's exact host tab/document/access scope. */
  validateContext(context:MemoryContext,evidence:ScreenEvidence):Promise<boolean>;
  /** Required host privacy/retention gate. False keeps the answer out of the wiki. */
  allowAnswer(input:{context:MemoryContext;record:ScreenKnowledgeRecord;question:ScreenLearningQuestion;answer:string}):Promise<boolean>;
};
const skip='잘 모르겠어요';
const sameScreen=(a:ScreenEvidence,b:ScreenEvidence)=>a.screenId===b.screenId&&a.variantId===b.variantId&&a.fingerprint===b.fingerprint&&JSON.stringify(a.facts)===JSON.stringify(b.facts)&&JSON.stringify(a.coverage)===JSON.stringify(b.coverage);
const key=async(record:ScreenKnowledgeRecord,version:string,q:ScreenLearningQuestion)=>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([record.scope,record.evidence.screenId,record.evidence.variantId,record.evidence.fingerprint,version,q])));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
};
/** Questions and answers are data in the existing screen wiki, never a second model/action loop. */
export function createScreenLearning(options:ScreenLearningOptions):{knowledge:ReturnType<typeof createScreenKnowledge>;port:BrowserLearningPort} {
  const scope=clone(options.scope),knowledge=createScreenKnowledge({...options,scope});
  if(typeof options.validateContext!=='function'||typeof options.allowAnswer!=='function')fail('screen_learning_host_invalid');
  const current=async(context:MemoryContext)=>{
    context.signal.throwIfAborted();if(context.projectId!==scope.projectId)fail('knowledge_scope_invalid');
    const evidence=await abortable(options.source.observe(context.signal),context.signal);
    validateScreenEvidence(evidence);
    if(!await abortable(options.validateContext(context,clone(evidence)),context.signal)||!await abortable(options.source.validate(evidence,context.signal),context.signal))fail('screen_learning_context_changed');
    const row=await abortable(options.store.read(clone(scope),evidence.screenId,evidence.variantId,context.signal),context.signal);
    if(row){validateScreenRecord(row.record);if(!row.version||!sameKnowledgeScope(scope,row.record.scope)||row.record.evidence.screenId!==evidence.screenId||row.record.evidence.variantId!==evidence.variantId)fail('screen_store_scope_mismatch');}
    return {evidence,row};
  };
  const unanswered=(record:ScreenKnowledgeRecord)=>record.analysis.questions?.find(q=>!record.clarifications?.some(a=>a.questionId===q.id));
  const port:BrowserLearningPort={
    async next(context){
      context.signal.throwIfAborted();if(context.projectId!==scope.projectId)fail('knowledge_scope_invalid');
      // Check ownership before analysis, not only before presentation.
      const bound=createScreenKnowledge({...options,scope,source:{
        async observe(signal){const evidence=await options.source.observe(signal);if(!await abortable(options.validateContext(context,clone(evidence)),signal))fail('screen_learning_context_changed');return evidence;},
        async validate(evidence,signal){return await abortable(options.validateContext(context,clone(evidence)),signal)&&await options.source.validate(evidence,signal);},
      }});await bound.analyzeAndSave(context.signal,{requireQuestions:true});
      const {evidence,row}=await current(context);if(!row||!sameScreen(evidence,row.record.evidence))fail('screen_changed');
      const q=unanswered(row.record);if(!q)return null;
      const record=row.record,fact=record.evidence.facts.find(f=>f.id===q.evidenceId)!,title=record.evidence.facts.find(f=>f.id===record.analysis.titleEvidenceId)!.text;
      const question:QuestionInput={
        question:q.topic==='screen_purpose'?'이 화면은 주로 어떤 업무에 사용하나요?':q.topic==='control_meaning'?'표시한 항목이나 기능은 어떤 용도인가요?':'이 화면이나 항목을 사용할 때 알아야 할 업무 규칙이 있나요?',
        context:{title,element:fact.text},inputMode:q.inputMode,inputPlaceholder:'업무 용도만 설명해 주세요. 비밀번호나 개인정보는 입력하지 마세요.',
        choices:q.topic==='screen_purpose'?['조회와 검색','작성과 수정','승인과 결재',skip]:[skip],
        learningKey:await key(record,row.version,q),
      };context.signal.throwIfAborted();return question as QuestionInput&{learningKey:string};
    },
    async answer(context,learningKey,answer){
      if(typeof learningKey!=='string'||!/^[a-f0-9]{64}$/.test(learningKey)||typeof answer!=='string'||!answer.trim()||answer.length>1000)fail('screen_learning_answer_invalid');
      const {evidence,row}=await current(context);if(!row||!sameScreen(evidence,row.record.evidence))return 'stale';
      const q=unanswered(row.record);if(!q||await key(row.record,row.version,q)!==learningKey)return 'stale';
      if(answer!==skip&&!await abortable(options.allowAnswer({context,record:clone(row.record),question:clone(q),answer}),context.signal))fail('screen_learning_answer_denied');
      // Recheck both owners after a possibly asynchronous privacy decision.
      if(!await abortable(options.validateContext(context,clone(evidence)),context.signal)||!await abortable(options.source.validate(evidence,context.signal),context.signal))return 'stale';
      context.signal.throwIfAborted();const record:ScreenKnowledgeRecord={...clone(row.record),clarifications:[...clone(row.record.clarifications??[]),{questionId:q.id,source:'user',status:answer===skip?'skipped':'answered',...(answer===skip?{}:{answer}),answeredAt:new Date().toISOString()}]};
      validateScreenRecord(record);
      if(!await abortable(options.store.compareAndSet(row.version,clone(record),context.signal),context.signal))fail('screen_wiki_conflict');
      const saved=await abortable(options.store.read(clone(scope),evidence.screenId,evidence.variantId,context.signal),context.signal);
      if(!saved||JSON.stringify(saved.record)!==JSON.stringify(record))fail('screen_wiki_readback_failed');
      context.signal.throwIfAborted();return 'saved';
    },
  };
  return {knowledge,port};
}
