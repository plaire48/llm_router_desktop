import test from 'node:test';
import assert from 'node:assert/strict';
import {learnBrowserScreen,answerBrowserScreen,callDevelopmentBrowser,cancelBrowserAgent,disposeDevelopmentBrowser} from '../runtime/browser-agent-host.mjs';
import {workspaceScreenKnowledge} from '../runtime/browser-screen-knowledge.mjs';
const signal=()=>new AbortController().signal;
const snapshot='- heading "업무 관리" [level=1]\n- button "처리" [ref=e1]\n- paragraph: PRIVATE_BODY';
function fixture(t,{questions=true}={}){
 const values=new Map(),tasks=new Map([['t',{id:'t',state:'ready',request:'화면을 학습해 주세요'}]]);let documentId='d',origin='https://current.invalid',text=snapshot,calls=0;
 const store={get:k=>structuredClone(values.get(k)),set:(k,v)=>values.set(k,structuredClone(v)),event(){}},preview={id:'p',kind:'web',projectId:'project',taskId:'t',url:'https://old.invalid',request:'학습',tabId:'tab',documentId:'d',sessionTaskId:'session',state:'bound'};
 store.set('development-preview:t',preview);
 const service={projectId:'project',store,task:id=>{if(!tasks.has(id))throw Error('task_missing');return tasks.get(id);},providers:{status:()=>({model:'fixture'})},playwrightRequest:async(_,args)=>{if(args.documentId&&args.documentId!==documentId)throw Error('browser_document_changed');return {tabId:'tab',documentId,origin};},mcpRegistry:()=>({fingerprint:(name,args)=>name+JSON.stringify(args),call:async(name)=>{assert.equal(name,'mcp__playwright__browser_snapshot');return {ok:true,text};}})};
 const complete=async()=>{calls++;return {calls:[{function:{name:'screen_analysis',arguments:JSON.stringify({screenType:'editor',titleEvidenceId:'f0',fieldEvidenceIds:[],actionEvidenceIds:['f1'],questions:questions?[{id:'purpose',topic:'screen_purpose',evidenceId:'f0',inputMode:'text'}]:[]})}}]};};
 t.after(()=>disposeDevelopmentBrowser(service));
 return {service,store,tasks,complete,calls:()=>calls,setText:v=>text=v,setDocument:v=>documentId=v,setOrigin:v=>origin=v,values};
}
async function ask(f){const result=await learnBrowserScreen(f.service,'t',signal(),f.complete),task=f.tasks.get('t');task.state='waiting_input';task.question=result.question;return result;}
test('current origin screen learning asks in host format, saves user guidance, and recalls without another analysis',async t=>{
 const f=fixture(t),first=await ask(f);assert.equal(first.question.inputMode,'text');assert.equal(first.question.screenContext.title,'업무 관리');assert.equal(first.question.options.length,4);assert.equal(f.calls(),1);
 const result=await answerBrowserScreen(f.service,f.tasks.get('t'),'승인과 결재');assert.equal(result.status,'saved');assert.equal(result.procedureVerified,false);
 const second=await learnBrowserScreen(f.service,'t',signal(),f.complete);assert.equal(second.questionRequired,false);assert.equal(f.calls(),1);
 const observed=await callDevelopmentBrowser(f.service,{taskId:'t',name:'mcp__playwright__browser_snapshot',args:{tabId:'tab'},signal:signal()});assert.match(observed.screenKnowledge.notes.join(' '),/승인과 결재/);
 const persisted=JSON.stringify([...f.values].filter(([k])=>k.startsWith('browser-screen-wiki:')));assert.equal(persisted.includes('PRIVATE_BODY'),false);assert.equal(persisted.includes('[ref=e1]'),false);
 const old=workspaceScreenKnowledge(f.service,{preview:{url:'https://old.invalid',tabId:'tab'},text:snapshot,validate:async()=>true});assert.equal((await old.recall(signal())).status,'missing');
 await assert.rejects(answerBrowserScreen(f.service,f.tasks.get('t'),'overwrite'),/question_changed/);
});
test('unambiguous screen retains structure without interrupting the user',async t=>{const f=fixture(t,{questions:false}),result=await learnBrowserScreen(f.service,'t',signal(),f.complete);assert.equal(result.questionRequired,false);assert.equal(result.question,undefined);});
test('skip persists no invented explanation',async t=>{const f=fixture(t);await ask(f);assert.equal((await answerBrowserScreen(f.service,f.tasks.get('t'),'잘 모르겠어요')).status,'skipped');const result=await learnBrowserScreen(f.service,'t',signal(),f.complete);assert.equal(result.questionRequired,false);});
for(const changed of ['document','origin','snapshot','preview','project','cancel'])test(`${changed} change refuses delayed screen answer`,async t=>{
 const f=fixture(t);await ask(f);
 if(changed==='document')f.setDocument('other');if(changed==='origin')f.setOrigin('https://elsewhere.invalid');if(changed==='snapshot')f.setText(snapshot+'\n- button "새 작업"');if(changed==='preview')f.store.set('development-preview:t',{...f.store.get('development-preview:t'),id:'other'});if(changed==='project')f.service.projectId='other';if(changed==='cancel')f.tasks.get('t').state='cancelled';
 const result=await answerBrowserScreen(f.service,f.tasks.get('t'),'DO_NOT_SAVE');assert.notEqual(result.status,'saved');assert.equal(JSON.stringify([...f.values.values()]).includes('DO_NOT_SAVE'),false);
});
test('question identity, oversized answers and cancelled questions never reach the writer',async t=>{
 const f=fixture(t);await ask(f);const task=f.tasks.get('t'),id=task.question.id;task.question.id='wrong';await assert.rejects(answerBrowserScreen(f.service,task,'answer'),/question_changed/);task.question.id=id;
 await assert.rejects(answerBrowserScreen(f.service,task,'a'.repeat(1001)),/answer_invalid/);await cancelBrowserAgent(f.service,'t');await assert.rejects(answerBrowserScreen(f.service,task,'answer'),/question_changed/);
});

test('failed readback after publishing an answer reports uncertainty rather than definite absence',async t=>{
 const f=fixture(t);await ask(f);const get=f.store.get;f.store.get=k=>{const value=get(k);if(k.startsWith('browser-screen-wiki:')&&value?.content.includes('READBACK_FAILURE'))throw Error('storage_read_failed');return value;};
 const result=await answerBrowserScreen(f.service,f.tasks.get('t'),'READBACK_FAILURE');assert.equal(result.status,'unconfirmed');assert.match(result.instruction,/not confirmed/);assert(JSON.stringify([...f.values.values()]).includes('READBACK_FAILURE'));
});
