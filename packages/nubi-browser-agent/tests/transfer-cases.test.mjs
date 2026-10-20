import test from 'node:test';import assert from 'node:assert/strict';
import {cases,documents,schedule,requestFor,verifyAnswer,summarize} from '../evaluation/transfer-cases.mjs';
function setup(task){const sources=new Map(),oracles=new Map();const items=task.kinds.map(kind=>{const d=documents[kind],url='https://developers.naver.com'+d.path,sourceId='fresh-'+kind;sources.set(sourceId,{url});oracles.set(kind,{endpoint:true,display:true,sort:true,time:true});return {kind,url,sourceId,endpoint:d.endpoint,displayMax:100,sort:[...d.sort],timeField:d.timeField};});return {answer:{items,summary:'현재 읽은 문서를 기준으로 요청 항목과 시간 필드를 정리했습니다.'},context:{query:task.query,sources,oracles}};}
test('fixed transfer schedule balances independent cases and arms, with disjoint training inputs',()=>{
 const matrix=schedule();assert.equal(matrix.length,18);for(const task of cases)for(const arm of ['none','reuse'])assert.equal(matrix.filter(x=>x.caseId===task.id&&x.arm===arm).length,3);
 assert.deepEqual(cases.map(x=>x.kinds.length),[3,2,1]);for(const task of cases){assert.notEqual(task.query,'site:developers.naver.com/docs/serviceapi/search 뉴스 블로그 웹문서');assert.match(requestFor(task),/現在|현재/);assert.ok(!requestFor(task).includes(documents[task.kinds[0]].endpoint));}
});
test('independent verifier accepts fresh facts and rejects stale sources, wrong case, duplicate and missing items',()=>{
 for(const task of cases){const f=setup(task);assert.ok(Object.values(verifyAnswer(task,f.answer,f.context)).every(Boolean));}
 for(const change of [x=>x.answer.items[0].timeField='pubDate',x=>x.answer.items[0].sourceId='old-source',x=>x.answer.items.push(x.answer.items[0]),x=>x.answer.items.pop(),x=>x.context.query='old-query',x=>x.context.oracles.delete('book')]){const f=setup(cases[1]);change(f);assert.ok(!Object.values(verifyAnswer(cases[1],f.answer,f.context)).every(Boolean));}
});
test('summary keeps failed and slow attempts and does not score incomplete triples as all succeeded',()=>{
 const rows=[{index:1,caseId:cases[0].id,arm:'reuse',success:true,totalMs:20000,modelCalls:2},{index:2,caseId:cases[0].id,arm:'reuse',success:false,totalMs:60000,modelCalls:5}];
 const result=summarize({trials:rows,schedule:schedule(),memoryUnchanged:true});assert.equal(result.complete,false);assert.equal(result.reuse.medianMs,40000);assert.equal(result.reuse.successes,1);assert.equal(result.reuse.within25,1);assert.equal(result.cases[0].reuse.allThreeSucceeded,false);
});
