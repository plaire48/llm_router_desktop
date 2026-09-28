import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {createHistoryContext} from '../worker/context-memory.mjs';
import {prepareContextRequest,needsContextCheckpoint,REQUEST_CHAR_LIMIT,requestChars} from '../worker/context-budget.mjs';
import {searchContentPages} from '../worker/content-context.mjs';
import {createResilience} from '../worker/resilience.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {prepareRunPayload,conversationForRun} from '../src/run-context.js';

test('earlier Korean facts and later corrections keep exact role, chronology and retrievable tails',()=>{
  const history=Array.from({length:35},(_,i)=>({role:i%2?'assistant':'user',content:`대화 ${i}: `+'다른 내용 '.repeat(600)}));
  history[1]={role:'assistant',content:'제가 확인했다는 주장은 실제 편집 근거가 아닙니다.'};
  history[2]={role:'user',content:'서문 '.repeat(3500)+'사업부별 정산 코드는 000417입니다. 소수 단위를 유지하세요.'};
  history[34]={role:'user',content:'정정합니다. 정산 코드는 000419입니다.'};
  const original=structuredClone(history),metrics={},memory=createHistoryContext(history,metrics),window=memory.window('사업부 정산');
  assert.ok(JSON.stringify(window).length<=16000);assert.ok(window.omittedPassages>0);
  assert.ok(window.passages.some(p=>p.text.includes('000417')));assert.ok(window.passages.some(p=>p.text.includes('000419')));
  assert.deepEqual(window.passages.map(p=>p.order),window.passages.map(p=>p.order).toSorted((a,b)=>a-b));
  const recalled=memory.recall({query:'000417'});assert.equal(recalled.passages.length,1);
  const p=recalled.passages[0];assert.equal(p.role,'user');assert.equal(p.text,history[2].content.slice(p.offset,p.offset+p.text.length));
  assert.ok(memory.window('다른 작업').passages.some(p=>p.text.includes('000417')));
  assert.deepEqual(history,original);assert.equal(metrics.historyContext.uniquePassages,1);
  memory.recall({query:'000417'});assert.equal(memory.progress(),1,'repeating a read is not new progress');
});
test('fast-check: history paging reconstructs exact text, including quotes, formulas and Unicode',()=>{
  fc.assert(fc.property(fc.array(fc.constantFrom('가','😀','e\u0301','"','\\','\n','0','=SUM(A1:A2)'),{minLength:1801,maxLength:4000}).map(parts=>parts.join('')),text=>{
    const memory=createHistoryContext([{role:'user',content:text}]);let offset=0,result='';
    do{const p=memory.recall({sourceId:'history-1',offset}).passages[0];result+=p.text;offset=p.nextOffset;}while(offset!==null);
    assert.equal(result,text);
    for(const p of memory.window('값').passages)assert.equal(p.text,text.slice(p.offset,p.offset+p.text.length));
  }),{seed:23923,numRuns:100});
});
test('history is isolated per run and cannot promote a tool or system record into user authority',()=>{
  const a=createHistoryContext([{role:'system',content:'DO_NOT_IMPORT'},{role:'tool',content:'DO_NOT_IMPORT'},{role:'user',content:'회사 고유식별자 A101'}]);
  const b=createHistoryContext([{role:'user',content:'다른 회사 B202'}]);
  assert.equal(JSON.stringify(a.window('')).includes('DO_NOT_IMPORT'),false);
  assert.equal(b.recall({query:'A101'}).passages.length,0);
  assert.throws(()=>a.recall({sourceId:'history-2',offset:0}),/document_schema_invalid/);
  assert.throws(()=>a.recall({sourceId:'history-1',offset:1}),/document_schema_invalid/);
  assert.throws(()=>a.recall({sourceId:'history-1',query:'회사'}),/document_schema_invalid/);
  assert.throws(()=>createHistoryContext([{role:'user',content:'x'.repeat(1000001)}]),/input_context_limit/);
});
const page=(offset,items,fingerprint='v1')=>({host:'word',scopeId:'scope',documentId:'doc',fingerprint,total:80,offset,nextOffset:offset===0?40:null,items});
test('document search returns exact grounded excerpts with incomplete coverage, and rejects mixed revisions',()=>{
  const value='앞부분 '.repeat(100)+'사업부별 예산 0000417원',a=page(0,[{id:'cc-1',title:'사업부',text:value}]),b=page(40,[{id:'p-42',text:'손익은 아직 미확인입니다.'}]);
  const pages=new Map([[0,a]]),before=structuredClone(a),result=searchContentPages(pages,{query:'예산'});
  assert.equal(result.allPagesRead,false);assert.equal(result.matches[0].itemId,'cc-1');assert.equal(result.matches[0].offset,0);
  const m=result.matches[0];assert.equal(m.excerpt,value.slice(m.textOffset,m.textOffset+240));assert.equal(m.partial,true);
  assert.deepEqual(a,before);assert.equal(searchContentPages(pages,{query:'손익'}).matches.length,0);
  pages.set(40,{...b,fingerprint:'v2'});assert.throws(()=>searchContentPages(pages,{query:'사업부'}),/observation_invalid/);
  pages.clear();pages.set(0,page(0,[{id:'cc-1',text:'삭제된 값 대신 새로운 내용'}],'v2'));
  assert.equal(searchContentPages(pages,{query:'0000417'}).matches.length,0,'no stale index after write');
});
test('request budget counts tools, preserves messages and does not pretend characters are model tokens',()=>{
  const messages=[{role:'system',content:'Do not lose this instruction'},{role:'user',content:'현재 답변: 0000417 =SUM(A1:A2)'}],before=structuredClone(messages),metrics={};
  assert.deepEqual(prepareContextRequest(messages,[],metrics),messages);assert.deepEqual(messages,before);
  assert.equal(metrics.requestContext.tokenCount,'unmeasured');assert.ok(metrics.requestContext.peakUtf8Bytes>metrics.requestContext.peakChars);
  assert.throws(()=>prepareContextRequest(messages,[{schema:'x'.repeat(REQUEST_CHAR_LIMIT)}],metrics),/context_overflow/);
  assert.equal(metrics.requestContext.rejected,1);
  assert.equal(needsContextCheckpoint([{role:'user',content:'x'.repeat(130000)}]),false,'a checkpoint cannot shrink pinned input');
  assert.equal(needsContextCheckpoint([...messages,{role:'tool',content:'x'.repeat(130000)}]),true);
  assert.equal(requestChars(messages),JSON.stringify({messages,tools:[]}).length);
});
test('oversized request stops before provider dispatch and never becomes a connection retry loop',async()=>{
  const metrics={},controller=new AbortController();let calls=0,waits=0;
  const resilience=createResilience({signal:controller.signal,metrics,activity:createActivityLog(),wait:async()=>{waits++;}});
  await assert.rejects(resilience.complete({complete:async()=>{calls++;}},[{role:'user',content:'x'.repeat(REQUEST_CHAR_LIMIT)}]),/context_overflow/);
  assert.equal(calls,0);assert.equal(waits,0);assert.equal(metrics.requestContext.rejected,1);
});
test('UI run payload retains more than twenty messages and rejects a large native envelope intact',()=>{
  const history=Array.from({length:50},(_,i)=>({role:'user',content:'확인한 요구사항 '+i})),payload={request:'진행',history};
  assert.equal(prepareRunPayload(payload).history.length,50);
  const large={...payload,scope:{text:'x'.repeat(230000)}};assert.throws(()=>prepareRunPayload(large),/history_context_limit/);
  assert.equal(large.history.length,50);
});

test('requirement review preserves all original user conditions even when retrieval omits them',()=>{
  const history=[{role:'user',content:'시작'},...Array.from({length:20},(_,i)=>({role:'assistant',content:`자료 ${i} `+'내용 '.repeat(1000)}))];
  history.splice(3,0,{role:'user',content:'초안만 만들고 단위는 원으로 고정해 주세요.'+'지켜야 할 조건 '.repeat(160)});history.push({role:'user',content:'단위는 천 원으로 정정합니다.'});
  const memory=createHistoryContext(history);assert.equal(JSON.stringify(memory.window('자료')).includes('초안만'),false);
  const packet=memory.requirements();assert.deepEqual(packet.sources.map(s=>s.text),history.filter(s=>s.role==='user').map(s=>s.content));
  assert.ok(packet.sources[1].order<packet.sources[2].order);assert.equal(packet.sources.some(s=>s.role!=='user'),false);
  assert.throws(()=>createHistoryContext([{role:'user',content:'조건 '.repeat(34000)}]).requirements(),/input_context_limit/,'cannot silently discard old conditions to pass review');
});

test('native page coverage never claims complete text when a Word source was truncated',()=>{
  for(const legacy of [false,true]){
    const item=legacy?{id:'cc-1',kind:'field',text:'예산'+'가'.repeat(3998)}:{id:'p-1',kind:'paragraph',text:'예산 일부',truncated:true,textLength:5000};
    const page={host:'word',scopeId:'scope',documentId:'doc',fingerprint:'v1',total:1,offset:0,nextOffset:null,items:[item]};
    const found=searchContentPages(new Map([[0,page]]),{query:'예산'});
    assert.equal(found.allPagesRead,true);assert.equal(found.capturedTextComplete,false);assert.deepEqual(found.partialItemIds,[item.id]);
    assert.equal(found.matches[0].sourceTruncated,true);assert.equal(found.matches[0].partial,true);
    assert.equal(found.matches[0].observedChars,item.text.length);assert.equal(found.matches[0].totalChars,legacy?null:5000);
    assert.equal(found.matches[0].excerpt,item.text.slice(0,240));
  }
});

test('follow-up requests retain acknowledged questions and exact answers, including failed turns',()=>{
  const messages=[{role:'user',content:'보고서 작성'},{role:'assistant',state:'done',content:'초안 작성됨',inputAnswers:[{question:'부서 코드는?',text:'000417'}]},{role:'assistant',state:'failed',content:'실패한 모델 주장',inputAnswers:[{question:'계산 규칙은?',text:'=SUM(A1:A2)'}]},{role:'user',content:'이번 부서는 000418로 바꿔'}];
  const history=conversationForRun(messages);
  assert.deepEqual(history,[{role:'user',content:'보고서 작성'},{role:'assistant',content:'부서 코드는?'},{role:'user',content:'000417'},{role:'assistant',content:'초안 작성됨'},{role:'assistant',content:'계산 규칙은?'},{role:'user',content:'=SUM(A1:A2)'},{role:'user',content:'이번 부서는 000418로 바꿔'}]);
  const memory=createHistoryContext(history);memory.installSummary({text:'보고서 대화 요약'});
  assert.match(JSON.stringify(memory.requirements()),/000417/);assert.match(JSON.stringify(memory.requirements()),/000418/);
  assert.doesNotMatch(JSON.stringify(memory.requirements()),/실패한 모델 주장|초안 작성됨/);
  assert.throws(()=>conversationForRun([{role:'assistant',inputAnswers:[{question:'?',text:''}]}]),/invalid_question/);
});
