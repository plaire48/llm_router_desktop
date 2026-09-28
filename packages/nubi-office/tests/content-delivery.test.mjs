import test from 'node:test';
import assert from 'node:assert/strict';
import {createdContentFindings} from '../worker/content-context.mjs';
const pages=(items,host='word')=>new Map([[0,{host,scopeId:'s',documentId:'d',fingerprint:'f',offset:0,total:items.length,nextOffset:null,created:true,items}]]);
test('created containers and a model declaration cannot substitute for authored native content',()=>{
  const result=createdContentFindings(pages([]),0);assert.equal(result.status,'unmet');assert.deepEqual(result.checks.map(c=>c.status),['unmet','unmet']);
  assert.equal(createdContentFindings(pages([{id:'p-1',text:'기본 텍스트'}]),0).status,'unmet');
});
test('blank, placeholder, labels and speaker notes do not qualify as visible body',()=>{
  for(const item of [{id:'p',text:' \r\n\u0007\u200b\u2060'},{id:'cc',text:'입력 안내',showingPlaceholder:true},{id:'s',kind:'slide',name:'제목',notes:'발표자만 보는 메모'}])assert.equal(createdContentFindings(pages([item]),1).status,'unmet');
});
test('native body plus a verified write passes only the minimum delivery check',()=>{
  for(const host of ['word','powerpoint']){
    const original=pages([{id:'body',text:'실제 보고 내용'}],host),before=structuredClone(original),result=createdContentFindings(original,1);
    assert.equal(result.status,'met');assert.equal(result.facts.visibleTextItems,1);assert.deepEqual(original,before);assert.equal(result.complete,undefined);assert.equal(result.saved,undefined);
  }
});
test('missing pages, partial text and stale source must not pass a delivery check',()=>{
  const incomplete=pages([{id:'p',text:'앞부분',truncated:true,textLength:5000}]);assert.throws(()=>createdContentFindings(incomplete,1),/evidence_incomplete/);
  const missing=pages([{id:'p',text:'내용'}]);missing.get(0).total=80;assert.throws(()=>createdContentFindings(missing,1),/observation_invalid/);
  for(const writes of [-1,NaN,0.1])assert.throws(()=>createdContentFindings(pages([]),writes),/observation_invalid/);
});
