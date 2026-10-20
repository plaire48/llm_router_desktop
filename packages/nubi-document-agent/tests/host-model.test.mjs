import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {prepareWordDocument} from '../dist/word.js';
import {prepareExcelDocument} from '../dist/excel.js';
import {preparePowerPointDocument} from '../dist/powerpoint.js';
import {deferred,until} from './host.mjs';
const path=new URL('../dist/host-model.js',import.meta.url),api=existsSync(path)?await import(path):{};
for(const [domain,prefix,prepare] of [['word','WD',prepareWordDocument],['excel','EX',prepareExcelDocument],['powerpoint','PP',preparePowerPointDocument]]){
  test(`${domain} host completion adapter preserves tool observations and produces actual draft bytes`,async()=>{
    assert.equal(typeof api.createHostModelTransport,'function','Host model conversion is missing');
    const draft=JSON.parse(await readFile(new URL(`../eval/${prefix}-CREATE-01.reference-draft.json`,import.meta.url)));
    const calls=[],metrics=[];
    const host={id:'selected-model',async complete(messages,tools,ctx){
      assert.equal(ctx.modelId,'selected-model');assert.equal(messages[0].role,'system');
      calls.push(structuredClone(messages));ctx.onText?.('activity');
      const observed=messages.filter(m=>m.role==='tool');
      assert.deepEqual(tools.map(t=>t.function.name),observed.length>=2?[]:[`read_${domain}_sources`,`submit_${domain}_draft`]);
      if(!observed.length)return {content:'',calls:[{id:'read',function:{name:`read_${domain}_sources`,arguments:'{}'}}]};
      assert.equal(observed[0].tool_call_id,'read');assert.match(observed[0].content,/created/);
      if(observed.length===1)return {content:'',calls:[{id:'submit',function:{name:`submit_${domain}_draft`,arguments:JSON.stringify(draft)}}]};
      assert.equal(observed[1].tool_call_id,'submit');return {content:'검토용 초안을 준비했습니다.',calls:[]};
    }};
    const transport=api.createHostModelTransport(host,{onMetric:m=>metrics.push(m)});
    host.id='changed-later';
    const result=await prepare({request:'보고서를 작성하세요.',sources:{created:6}},transport,new AbortController().signal);
    assert.ok(result.bytes.length>1000);assert.equal(result.savedToOffice,false);assert.equal(calls.length,3);
    assert.equal(metrics.filter(m=>m.kind==='model_end').length,3);
    assert.ok(metrics.every(m=>!('content' in m)&&!('arguments' in m)));
  });
}
test('cancellation fences a late host response and settles the stream exactly once',async()=>{
  assert.equal(typeof api.createHostModelTransport,'function');const gate=deferred(),events=[];let entered=false,signal;
  const transport=api.createHostModelTransport({id:'m',async complete(_m,_t,ctx){entered=true;signal=ctx.signal;await gate.promise;return {content:'late',calls:[]};}});
  const handle=transport.stream({system:'x',messages:[{role:'user',text:'x'}],tools:[]},{onDelta:t=>events.push(t),onToolCall:()=>events.push('tool'),onDone:()=>events.push('done'),onError:e=>events.push(e)});
  await until(()=>entered);handle.cancel();gate.resolve();await new Promise(r=>setImmediate(r));
  assert.equal(signal.aborted,true);assert.deepEqual(events,['done']);
});
test('malformed and invented host tool proposals never reach a document tool',async()=>{
  assert.equal(typeof api.createHostModelTransport,'function');
  const events=[];
  const transport=api.createHostModelTransport({id:'m',async complete(){return {content:'',calls:[{id:'x',function:{name:'execute_shell',arguments:'{}'}}]};}});
  await new Promise(resolve=>transport.stream({system:'x',messages:[],tools:[]},{onDelta:()=>events.push('text'),onToolCall:()=>events.push('tool'),onDone:resolve,onError:e=>{events.push(e);resolve();}}));
  assert.deepEqual(events,['host_model_response_invalid']);
});
test('host exceptions are classified without exposing raw credential or account text',async()=>{
  assert.equal(typeof api.createHostModelTransport,'function');const events=[],metrics=[];
  const transport=api.createHostModelTransport({id:'m',async complete(){throw Error('secret-account-token');}},{onMetric:m=>metrics.push(m)});
  await new Promise(resolve=>transport.stream({system:'x',messages:[],tools:[]},{onDelta(){},onToolCall(){},onDone:resolve,onError:e=>{events.push(e);resolve();}}));
  assert.deepEqual(events,['host_model_failed']);assert.doesNotMatch(JSON.stringify(metrics),/secret-account-token/);
});
