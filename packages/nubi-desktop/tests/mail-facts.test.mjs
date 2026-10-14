import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {groundFacts,FACT_LIMITS,parseFactDecision,extractMailFacts,recordMailFacts,queryMailFacts,listMailFacts,factIdentity} from '../runtime/mail-facts.mjs';
async function setup(t){const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-facts-'));const store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true,maxRetries:5});});return store;}
test('the model answer is parsed strictly into short facts',async()=>{
  assert.equal(parseFactDecision('nope'),null);assert.equal(parseFactDecision('{"facts":"x"}'),null);
  const facts=parseFactDecision('```json\n{"facts":[{"subject":" A 프로젝트 ","predicate":"납기","value":"2026-11-30","validFrom":"2026-10-02"},{"subject":"","predicate":"x","value":"y"},{"subject":"B","predicate":"담당자","value":"김민수","validFrom":"언제"}]}\n```');
  assert.deepEqual(facts,[{subject:'A 프로젝트',predicate:'납기',value:'2026-11-30',validFrom:'2026-10-02T00:00:00.000Z'},{subject:'B',predicate:'담당자',value:'김민수',validFrom:null}]);
  const calls=[];const got=await extractMailFacts({mail:{subject:'납기 안내',from:'pm@x',date:'2026-10-02T09:00:00Z',text:'납기는 2026-11-30입니다.'},summary:{summary:'납기 11월 30일',facts:['납기 2026-11-30']},invoke:async(wire,tools,signal,kind,options)=>{calls.push({kind,options,wire});return {content:JSON.stringify({facts:[{subject:'A',predicate:'납기',value:'납기는 2026-11-30입니다.',quote:'납기는 2026-11-30입니다.'}]})};}});
  assert.equal(calls[0].kind,'mail_facts');assert.deepEqual(calls[0].options.responseFormat,{type:'json_object'});assert.match(calls[0].wire[1].content,/excerpt/);assert.equal(got.facts[0].validFrom,null);assert.equal(got.coverage.complete,true);
});
test('a later value closes the earlier one; repeats and older mails do not override',async t=>{
  const store=await setup(t);
  const first=recordMailFacts(store,[{subject:'A 프로젝트',predicate:'납기',value:'2026-11-30',validFrom:null},{subject:'A 프로젝트',predicate:'담당자',value:'김민수',validFrom:null}],{sourceId:'m1',sourceSubject:'납기 안내',sourceDate:'2026-10-02T09:00:00Z',wikiFile:'m1.md'});
  assert.equal(first.saved.length,2);assert.equal(first.saved[0].validFrom,'2026-10-02T09:00:00.000Z');
  const repeat=recordMailFacts(store,[{subject:'A프로젝트',predicate:'납기',value:'2026-11-30',validFrom:null}],{sourceId:'m2',sourceDate:'2026-10-05T09:00:00Z',wikiFile:'m2.md'});
  assert.deepEqual([repeat.saved.length,repeat.closed.length],[1,1]);assert.equal(listMailFacts(store).filter(row=>row.predicate==='납기').length,2,'dated repetitions stay available for intervening imports');
  assert.equal(factIdentity('A 프로젝트','납기'),factIdentity('A프로젝트',' 납기 '));
  const change=recordMailFacts(store,[{subject:'A 프로젝트',predicate:'납기',value:'2026-12-15',validFrom:null}],{sourceId:'m3',sourceDate:'2026-10-12T09:00:00Z',wikiFile:'m3.md'});
  assert.equal(change.closed.length,1);assert.equal(change.closed[0].invalidAt,'2026-10-12T09:00:00.000Z');assert.equal(change.saved[0].supersedes,change.closed[0].id);
  const late=recordMailFacts(store,[{subject:'A 프로젝트',predicate:'납기',value:'2026-11-01',validFrom:null}],{sourceId:'m0',sourceDate:'2026-09-20T09:00:00Z'});
  assert.deepEqual([late.saved.length,late.closed.length],[1,0],'an older mail organised later keeps the newer value');
  const now=queryMailFacts(store,{asOf:'2026-10-14T00:00:00Z',includeHistory:true});
  assert.deepEqual(now.facts.map(row=>[row.predicate,row.value]),[['납기','2026-12-15'],['담당자','김민수']]);
  assert.deepEqual(now.facts[0].history.map(entry=>[entry.value,entry.invalidAt]),[['2026-11-30','2026-10-12T09:00:00.000Z'],['2026-11-30','2026-10-05T09:00:00.000Z'],['2026-11-01','2026-10-02T09:00:00.000Z']]);
  const before=queryMailFacts(store,{asOf:'2026-10-08T00:00:00Z'});assert.equal(before.facts.find(row=>row.predicate==='납기').value,'2026-11-30');
  assert.equal(queryMailFacts(store,{asOf:'2026-09-01T00:00:00Z'}).facts.length,0);
  assert.deepEqual(queryMailFacts(store,{query:'담당자 누구'}).facts.map(row=>row.value),['김민수']);
  assert.deepEqual(queryMailFacts(store,{wikiFile:'m1.md'}).facts.map(row=>row.value).sort(),['2026-12-15','김민수'],'a wiki file finds the current values of the facts it introduced');
  assert.deepEqual(queryMailFacts(store,{sourceId:'m3'}).facts.map(row=>row.value),['2026-12-15']);
});

test('admission rejects reversed decisions and invented owners for every kind without mutating input',()=>{
  for(const kind of ['approval','amount','deadline','owner','status','decision','other',undefined]){
    const fact={subject:'출시',predicate:'결정',kind,value:'승인됨',quote:'배포 승인을 거절합니다.'};
    assert.deepEqual(groundFacts([fact],'배포 승인을 거절합니다.'),[]);
    assert.deepEqual(groundFacts([{...fact,value:'김민수',quote:undefined}],'담당자는 아직 정하지 않았습니다.'),[]);
    assert.equal(fact.quote,'배포 승인을 거절합니다.');
  }
  const text='보안 검토를 통과할 때만 배포를 승인합니다.';
  const [fact]=groundFacts([{subject:'배포',predicate:'상태',value:text,quote:text,validFrom:'2030-01-01'}],text);
  assert.equal(fact.value,text);assert.equal(fact.validFrom,null);assert.equal(fact.grounding,'source_excerpt');assert.match(fact.sourceHash,/^sha256:/);
});

test('late corrections beyond the old excerpt limit are extracted and overlapping evidence deduplicated',async()=>{
  const quote='정정: 납기는 12월 15일이며 비용은 900만원입니다.';
  const text='설명입니다. '.repeat(600)+quote,calls=[];
  const result=await extractMailFacts({mail:{text},invoke:async messages=>{
    const part=JSON.parse(messages[1].content);calls.push(part.section);
    return {content:JSON.stringify({facts:part.excerpt.includes(quote)?[{subject:'납기',predicate:'정정',value:quote,quote}]:[]})};
  }});
  assert.ok(calls.length>1);assert.equal(result.facts.length,1);assert.equal(result.facts[0].value,quote);assert.equal(result.coverage.coveredCharacters,text.length);assert.equal(result.coverage.complete,true);
});

test('failed sections, exhausted coverage and cancellation never masquerade as complete extraction',async()=>{
  const text='가'.repeat(FACT_LIMITS.excerpt*15);let calls=0;
  const result=await extractMailFacts({mail:{text},invoke:async()=>{calls++;if(calls===2)throw Error('transport');return {content:'{"facts":[]}'};}});
  assert.equal(calls,FACT_LIMITS.sections);assert.equal(result.coverage.failedSections,1);assert.equal(result.coverage.complete,false);assert.ok(result.coverage.coveredCharacters<text.length);
  const controller=new AbortController();controller.abort();
  await assert.rejects(extractMailFacts({mail:{text:'메일'},signal:controller.signal,invoke:async()=>assert.fail('must not call')}),/cancelled/);
});

test('all import orders preserve historical A -> B -> A and current value',async t=>{
  const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  for(const order of permutations){
    const store=await setup(t),values=['A','B','A'];
    for(const i of order)recordMailFacts(store,[{subject:'배포',predicate:'상태',value:values[i]}],{sourceId:'m'+i,sourceDate:`2026-10-0${i+1}`});
    for(let i=0;i<3;i++)assert.deepEqual(queryMailFacts(store,{asOf:`2026-10-0${i+1}T12:00:00Z`}).facts.map(f=>f.value),[values[i]],order.join(','));
    assert.equal(queryMailFacts(store,{asOf:'2026-10-01',sourceId:'m2'}).facts.length,0,'future evidence cannot justify an earlier answer');
    const replay=recordMailFacts(store,[{subject:'배포',predicate:'상태',value:'A'}],{sourceId:'m0',sourceDate:'2026-10-01'});
    assert.equal(replay.saved.length,0);assert.equal(listMailFacts(store).length,3);
  }
});

test('same-time contradictions remain visible and legacy facts are explicitly unverified',async t=>{
  const store=await setup(t);
  for(const [sourceId,value] of [['yes','승인'],['no','거절']])recordMailFacts(store,[{subject:'배포',predicate:'상태',value}],{sourceId,sourceDate:'2026-10-01'});
  const facts=queryMailFacts(store,{asOf:'2026-10-02'}).facts;
  assert.equal(facts.length,2);assert.ok(facts.every(f=>f.conflict&&f.grounding==='legacy_unverified'));
  recordMailFacts(store,[],{sourceId:'partial',coverage:{complete:false,coveredCharacters:3000,totalCharacters:8000}});
  assert.equal(queryMailFacts(store,{sourceId:'partial'}).coverage[0].complete,false);
});

test('quotation admission preserves conditional context and exact source offsets',()=>{
 const text='보안 검토가 끝나면 배포를 승인합니다.';
 assert.deepEqual(groundFacts([{subject:'배포',predicate:'상태',value:'배포를 승인합니다.',quote:'배포를 승인합니다.'}],text),[]);
 const source='인사말입니다.\n\n'+text;
 const [fact]=groundFacts([{subject:'배포',predicate:'상태',value:text,quote:text}],source);
 assert.equal(source.slice(fact.span.start,fact.span.end),text);
});

test('a failed write rolls back interval changes as well as the new observation',async t=>{
 const store=await setup(t);recordMailFacts(store,[{subject:'배포',predicate:'상태',value:'검토'}],{sourceId:'first',sourceDate:'2026-10-01'});
 const set=store.set.bind(store);let calls=0;store.set=(...args)=>{if(++calls===2)throw Error('disk_error');return set(...args);};
 assert.throws(()=>recordMailFacts(store,[{subject:'배포',predicate:'상태',value:'보류'}],{sourceId:'second',sourceDate:'2026-10-02'}),/disk_error/);
 assert.equal(listMailFacts(store).length,1);assert.equal(listMailFacts(store)[0].invalidAt,null);
});
