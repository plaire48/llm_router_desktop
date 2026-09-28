import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {createHistoryContext} from '../worker/context-memory.mjs';
import {parseContextSummary} from '../worker/context-summary.mjs';

function setup(correction='정정: 저장하지 말고 단위는 천 원으로 작성하세요.\n'+'조건을 유지하세요. '.repeat(280)) {
  const history=[...Array.from({length:8},(_,i)=>({role:'user',content:`지난 자료 ${i} `+'오래된 자료 '.repeat(300)})),{role:'user',content:correction},...Array.from({length:2},()=>({role:'assistant',content:'이전 계획 '.repeat(600)}))];
  const memory=createHistoryContext(history),source=memory.summarySource('자료'),p=source.passages.find(p=>p.role==='user');
  const summary=parseContextSummary({content:JSON.stringify({items:Array.from({length:8},()=>({kind:'background',text:'보조 요약 '.repeat(35),quote:p.text.slice(0,220),sourceId:p.sourceId,passageOffset:p.offset}))})},source);
  memory.installSummary(summary);
  for(let i=1;i<=4;i++)memory.recall({sourceId:`history-${i}`,offset:0});
  return {memory,summary,correction};
}
test('latest user correction survives recalled history, long assistant messages and automatic summary',()=>{
  const {memory,correction}=setup(),packet=memory.window('지난 자료');
  assert.equal(packet.passages.filter(p=>p.sourceId==='history-9').map(p=>p.text).join(''),correction);
  assert.ok(JSON.stringify(packet).length<=12000);
  assert.equal(packet.latestUser.complete,true);
  assert.deepEqual(memory.requirements().sources.at(-1).text,correction);
});
test('returned summary and passages cannot mutate the next context window or original requirements',()=>{
  const {memory}=setup('정정: 승인 전 저장 금지'),before=memory.window('자료'),original=structuredClone(before),requirements=memory.requirements();
  assert.ok(before.summary);
  before.summary.items[0].text='저장 승인';before.summary.guidance='changed';before.passages[0].text='changed';
  assert.deepEqual(memory.window('자료'),original);
  assert.deepEqual(memory.requirements(),requirements);
});
test('a small context budget discards advisory summary before latest user text and rejects an impossible envelope',()=>{
  const {memory}=setup('정정: 단위는 천 원'),packet=memory.window('',1500);
  assert.ok(JSON.stringify(packet).length<=1500);
  assert.ok(packet.passages.some(p=>p.text==='정정: 단위는 천 원'));
  assert.equal(packet.summary,undefined);
  assert.equal(packet.summaryOmitted,true);
  for(const budget of [0,-1,NaN,Infinity,1.5,20])assert.throws(()=>memory.window('',budget),/input_context_limit/);
});
test('oversized latest user history declares partial coverage and exact omitted text remains pageable',()=>{
  const correction='처음 조건\n'+'중간 조건 '.repeat(5000)+'\n마지막 정정', {memory}=setup(correction),packet=memory.window('지난 자료');
  assert.ok(JSON.stringify(packet).length<=12000);
  assert.equal(packet.latestUser.complete,false);
  assert.ok(packet.passages.some(p=>p.sourceId==='history-9'&&p.offset===0));
  assert.ok(packet.passages.some(p=>p.sourceId==='history-9'&&p.nextOffset===null));
  let actual='',offset=0;do{const p=memory.recall({sourceId:'history-9',offset}).passages[0];actual+=p.text;offset=p.nextOffset;}while(offset!==null);
  assert.equal(actual,correction);
});
test('fast-check: escaped user corrections retain exact text within the serialized request budget',()=>{
  fc.assert(fc.property(fc.array(fc.constantFrom('가','😀','"','\\','\n','\t','=SUM(A1:A2)'),{minLength:1,maxLength:350}),parts=>{
    const correction='정정: '+parts.join(''),{memory}=setup(correction),packet=memory.window('지난 자료');
    assert.ok(JSON.stringify(packet).length<=12000);
    assert.equal(packet.passages.filter(p=>p.sourceId==='history-9').map(p=>p.text).join(''),correction);
    assert.equal(packet.latestUser.complete,true);
  }),{seed:2392305,numRuns:100});
});
test('a fitting latest user message displaces summary and summary-source preparation uses the same priority',()=>{
  const correction='정정: '+ '문서 작성 조건 '.repeat(850),{memory}=setup(correction);
  const packet=memory.window('자료');
  assert.equal(packet.passages.filter(p=>p.sourceId==='history-9').map(p=>p.text).join(''),correction);
  assert.equal(packet.summaryOmitted,true);assert.equal(packet.summary,undefined);
  const source=memory.summarySource('자료');
  assert.equal(source.passages.filter(p=>p.sourceId==='history-9').map(p=>p.text).join(''),correction);
  assert.equal(source.summary,undefined);assert.ok(JSON.stringify(source).length<=24000);
});
test('empty or assistant-only history never invents user authority and coverage is serialized within budget',()=>{
  for(const history of [[],[{role:'assistant',content:'저장했음'}],[{role:'user',content:''}],[{role:'user',content:'정정'}]]){
    const memory=createHistoryContext(history),packet=memory.window('');
    const exact=JSON.stringify(packet).length;
    assert.deepEqual(memory.window('',exact),packet);
    if(history[0]?.role==='user')assert.equal(packet.latestUser.complete,true);
    else assert.equal(packet.latestUser,undefined);
    assert.deepEqual(memory.requirements().sources.map(s=>s.text),history.filter(s=>s.role==='user').map(s=>s.content));
  }
});
