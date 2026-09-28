import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryContext} from '../worker/context-memory.mjs';
import {needsContextCheckpoint,requestChars,CHECKPOINT_CHAR_LIMIT} from '../worker/context-budget.mjs';
import {compactMessages} from '../worker/model-context.mjs';

test('a short answer retains its preceding question before old retrievals and summary',()=>{
  const old=Array.from({length:12},(_,i)=>({role:'user',content:`old ${i} `+'자료 '.repeat(650)}));
  const question='선택 기준\n'+'설명 '.repeat(480)+'\n1. 원 단위\n2. 천 원 단위\n'+'참고 '.repeat(480);
  const memory=createHistoryContext([...old,{role:'assistant',content:question},{role:'user',content:'두 번째로 해줘'}]);
  memory.installSummary({advisory:true,text:'예전 요약 '.repeat(700)});
  for(let i=1;i<=4;i++)memory.recall({sourceId:`history-${i}`,offset:0});
  const packet=memory.window('old'),parts=packet.passages.filter(p=>p.sourceId==='history-13');
  assert.equal(parts.map(p=>p.text).join(''),question);
  assert.equal(packet.recentExchange.complete,true);
  assert.ok(JSON.stringify(packet).length<=12000);
  assert.equal(memory.requirements().sources.at(-1).text,'두 번째로 해줘');
});

test('oversized recent question reports partial coverage and remains exactly pageable',()=>{
  const question='처음\n'+'선택 사항 '.repeat(6000)+'\n끝',memory=createHistoryContext([{role:'assistant',content:question},{role:'user',content:'두 번째'}]);
  const packet=memory.window('',5000);
  assert.equal(packet.latestUser.complete,true);
  assert.equal(packet.recentExchange.complete,false);
  assert.ok(JSON.stringify(packet).length<=5000);
  let actual='',offset=0;
  do{const p=memory.recall({sourceId:'history-1',offset}).passages[0];actual+=p.text;offset=p.nextOffset;}while(offset!==null);
  assert.equal(actual,question);
});

test('checkpoint pressure uses lossless wire size without changing original tool evidence',()=>{
  const grid=()=>Array.from({length:100},()=>Array(40).fill('General'));
  const snapshot={address:'A1:AN100',values:[[0]],formulas:[['=1-1']],numberFormats:grid(),formats:{format:grid(),font:grid(),fill:grid(),border:grid()}};
  const messages=[{role:'system',content:'Keep original requirements'},{role:'tool',content:JSON.stringify({snapshot})}],before=structuredClone(messages);
  assert.ok(requestChars(messages)>CHECKPOINT_CHAR_LIMIT);
  assert.ok(requestChars(compactMessages(messages))<CHECKPOINT_CHAR_LIMIT);
  assert.equal(needsContextCheckpoint(messages),false);
  assert.deepEqual(messages,before);
  assert.equal(needsContextCheckpoint([{role:'tool',content:'x'.repeat(CHECKPOINT_CHAR_LIMIT)}]),true);
});
