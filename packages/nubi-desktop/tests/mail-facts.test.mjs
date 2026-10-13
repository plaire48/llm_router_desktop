import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {parseFactDecision,extractMailFacts,recordMailFacts,queryMailFacts,listMailFacts,factIdentity} from '../runtime/mail-facts.mjs';
async function setup(t){const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-facts-'));const store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true,maxRetries:5});});return store;}
test('the model answer is parsed strictly into short facts',async()=>{
  assert.equal(parseFactDecision('nope'),null);assert.equal(parseFactDecision('{"facts":"x"}'),null);
  const facts=parseFactDecision('```json\n{"facts":[{"subject":" A 프로젝트 ","predicate":"납기","value":"2026-11-30","validFrom":"2026-10-02"},{"subject":"","predicate":"x","value":"y"},{"subject":"B","predicate":"담당자","value":"김민수","validFrom":"언제"}]}\n```');
  assert.deepEqual(facts,[{subject:'A 프로젝트',predicate:'납기',value:'2026-11-30',validFrom:'2026-10-02T00:00:00.000Z'},{subject:'B',predicate:'담당자',value:'김민수',validFrom:null}]);
  const calls=[];const got=await extractMailFacts({mail:{subject:'납기 안내',from:'pm@x',date:'2026-10-02T09:00:00Z',text:'본문'},summary:{summary:'납기 11월 30일',facts:['납기 2026-11-30']},invoke:async(wire,tools,signal,kind,options)=>{calls.push({kind,options,wire});return {content:JSON.stringify({facts:[{subject:'A',predicate:'납기',value:'2026-11-30'}]})};}});
  assert.equal(calls[0].kind,'mail_facts');assert.deepEqual(calls[0].options.responseFormat,{type:'json_object'});assert.match(calls[0].wire[1].content,/listedFacts/);assert.equal(got[0].validFrom,null);
});
test('a later value closes the earlier one; repeats and older mails do not override',async t=>{
  const store=await setup(t);
  const first=recordMailFacts(store,[{subject:'A 프로젝트',predicate:'납기',value:'2026-11-30',validFrom:null},{subject:'A 프로젝트',predicate:'담당자',value:'김민수',validFrom:null}],{sourceId:'m1',sourceSubject:'납기 안내',sourceDate:'2026-10-02T09:00:00Z',wikiFile:'m1.md'});
  assert.equal(first.saved.length,2);assert.equal(first.saved[0].validFrom,'2026-10-02T09:00:00.000Z');
  const repeat=recordMailFacts(store,[{subject:'A프로젝트',predicate:'납기',value:'2026-11-30',validFrom:null}],{sourceId:'m2',sourceDate:'2026-10-05T09:00:00Z',wikiFile:'m2.md'});
  assert.deepEqual([repeat.saved.length,repeat.closed.length],[0,0]);assert.equal(listMailFacts(store).find(row=>row.predicate==='납기').sources.length,2,'a repeated value adds its source');
  assert.equal(factIdentity('A 프로젝트','납기'),factIdentity('A프로젝트',' 납기 '));
  const change=recordMailFacts(store,[{subject:'A 프로젝트',predicate:'납기',value:'2026-12-15',validFrom:null}],{sourceId:'m3',sourceDate:'2026-10-12T09:00:00Z',wikiFile:'m3.md'});
  assert.equal(change.closed.length,1);assert.equal(change.closed[0].invalidAt,'2026-10-12T09:00:00.000Z');assert.equal(change.saved[0].supersedes,change.closed[0].id);
  const late=recordMailFacts(store,[{subject:'A 프로젝트',predicate:'납기',value:'2026-11-01',validFrom:null}],{sourceId:'m0',sourceDate:'2026-09-20T09:00:00Z'});
  assert.deepEqual([late.saved.length,late.closed.length],[0,0],'an older mail organised later keeps the newer value');
  const now=queryMailFacts(store,{asOf:'2026-10-14T00:00:00Z',includeHistory:true});
  assert.deepEqual(now.facts.map(row=>[row.predicate,row.value]),[['납기','2026-12-15'],['담당자','김민수']]);
  assert.deepEqual(now.facts[0].history.map(entry=>[entry.value,entry.invalidAt]),[['2026-11-30','2026-10-12T09:00:00.000Z']]);
  const before=queryMailFacts(store,{asOf:'2026-10-08T00:00:00Z'});assert.equal(before.facts.find(row=>row.predicate==='납기').value,'2026-11-30');
  assert.equal(queryMailFacts(store,{asOf:'2026-09-01T00:00:00Z'}).facts.length,0);
  assert.deepEqual(queryMailFacts(store,{query:'담당자 누구'}).facts.map(row=>row.value),['김민수']);
  assert.deepEqual(queryMailFacts(store,{wikiFile:'m1.md'}).facts.map(row=>row.value).sort(),['2026-12-15','김민수'],'a wiki file finds the current values of the facts it introduced');
  assert.deepEqual(queryMailFacts(store,{sourceId:'m3'}).facts.map(row=>row.value),['2026-12-15']);
});
