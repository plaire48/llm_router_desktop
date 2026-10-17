import test from 'node:test';
import assert from 'node:assert/strict';
import {compactHistory,contextBudget,contextTokens} from '../context-manager.js';
const draft={goal:'계약 초안 작성',constraints:['발송 금지'],decisions:[],completed:[],pending:['저장 상태 확인'],references:[]};
const corrected={...draft,constraints:['발송 금지','납기는 2026-10-17로 정정됨'],decisions:['740000원으로 정정됨. 기존 700000원은 폐기'],failed:['저장 응답 유실. 저장 여부 미확정이며 재전송 금지'],pending:['저장 상태 확인','문서 nextOffset 3000부터 미열람 범위 확인']};
const source='700000원에서 740000원으로 정정. 납기는 2026-10-17. 발송 금지. 저장 응답 유실, 저장 여부 미확정, 재전송 금지. nextOffset 3000 이후 미열람.';
const messages=[{id:'u1',role:'user',content:source},{id:'a1',role:'assistant',content:'계약 초안 확인 중'}];
const setup=review=>({messages,force:true,recentTurns:0,model:{contextLength:32000,contextSummaryReview:review},signal:new AbortController().signal});
test('review rereads the exact source and previous memory, replaces an incomplete draft before saving',async()=>{
 const saved=[],calls=[];
 const result=await compactHistory({...setup(true),save:async value=>saved.push(value),invoke:async(input,options)=>{
  assert.equal(saved.length,0);assert(contextTokens(input)<=contextBudget(setup(true).model).input);calls.push(options.summaryStage);
  assert.match(JSON.stringify(input),/740000/);assert.match(JSON.stringify(input),/nextOffset 3000/);
  if(calls.length===2){assert.match(JSON.stringify(input),/Candidate summary/);assert.match(JSON.stringify(input),/Previous summary/);}
  return {content:JSON.stringify(calls.length===1?draft:corrected),calls:[]};
 }});
 assert.deepEqual(calls,['draft','review']);assert.equal(saved.length,1);assert.deepEqual(result.memory.summary,corrected);assert.deepEqual(messages[0].content,source);
});
test('failed or cancelled review never commits the draft or moves the covered boundary',async()=>{
 for(const cancelled of [false,true]){
  const controller=new AbortController();let saved=0,calls=0;
  await assert.rejects(compactHistory({...setup(true),signal:controller.signal,save:async()=>saved++,invoke:async()=>{
   if(++calls===1)return {content:JSON.stringify(draft)};
   if(cancelled)controller.abort();return {content:'invalid'};
  }}),cancelled?/cancelled/:/context_compaction_failed/);
  assert.equal(saved,0);assert.equal(calls,cancelled?2:3);
 }
});
test('shared default stays single pass while reviewed Desktop summaries can use more of the output budget',async()=>{
 assert.equal(contextBudget({contextLength:22500,contextSummaryReview:true}).summaryOutput,contextBudget({contextLength:22500}).summaryOutput);
 let calls=0;await compactHistory({...setup(false),invoke:async()=>{calls++;return {content:JSON.stringify(draft)};}});assert.equal(calls,1);
 assert(contextBudget({contextLength:262144,contextSummaryReview:true}).summaryMaxOutput>contextBudget({contextLength:262144}).summaryOutput);
});
test('reviewed compaction reserves the reviewer without making a small valid window unusable',async()=>{
 const model={contextLength:8000,maxInputTokens:3904,maxOutputTokens:1024,contextSummaryReview:true};let calls=0;
 const result=await compactHistory({...setup(true),model,invoke:async(input,options)=>{
  calls++;assert(contextTokens(input)<=contextBudget(model).input);assert(options.maxTokens>0&&options.maxTokens<=1024);
  return {content:JSON.stringify(corrected),calls:[]};
 }});
 assert.equal(calls,2);assert.deepEqual(result.memory.summary,corrected);
});
