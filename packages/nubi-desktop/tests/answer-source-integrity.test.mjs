import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AnswerSources,reviewCitationIntegrity} from '../runtime/answer-sources.mjs';
import {runReviewedAgent,resultReviewInput} from '../runtime/result-review.mjs';

test('source coverage is explicitly reviewed only when observed sources exist',()=>{
  const input={task:{request:'Find the value',criteria:[]},evidence:[],candidate:'A result',model:{contextLength:32000}};
  assert(!resultReviewInput({...input,receipts:{}}).data.requirements.some(r=>r.id==='host:sources'));
  const sources=new AnswerSources();sources.file({path:'policy.md',hash:'h',content:'The rate is 2'});
  const data=resultReviewInput({...input,receipts:{citationIntegrity:sources.review('A result')}}).data;
  assert(data.requirements.some(r=>r.id==='host:sources'));
  assert.equal(data.evidence.find(e=>e.id==='host').usable,true);
});

test('unknown citation is repaired by the bounded review loop without another action',async()=>{
  const sources=new AnswerSources();
  const source=sources.file({path:'policy.md',hash:'observed',content:'The rate is 2.',start:1,end:1});
  const ready={status:'ready',checks:[{requirementId:'request',state:'supported',evidenceIds:['user'],detail:'result'}],nextStep:''};
  let runs=0;const reviews=[];
  const result=await runReviewedAgent({messages:[],signal:new AbortController().signal,
    run:async()=>({content:++runs===1?'Rate 2 [rule](#nubi-cite-invented)':'Rate 2 [rule]('+source.href+')'}),
    snapshot:()=>({evidence:[],receipts:{}}),waiting:()=>false,continuation:()=>[],
    review:async({candidate})=>reviewCitationIntegrity(ready,sources.review(candidate)),
    onReview:async verdict=>reviews.push(verdict)});
  assert.equal(runs,2);assert.deepEqual(reviews.map(r=>r.status),['revise','ready']);
  assert.equal(sources.finish(result.content).sourceReferences[0].hash,'observed');
  assert.equal(ready.status,'ready','original review is not mutated');
});

test('examples in code do not create citations and matching titles never resolve fake IDs',()=>{
  const sources=new AnswerSources();sources.file({path:'rule.md',hash:'h',content:'A rule',title:'Rule'});
  assert.deepEqual(sources.review('`[Rule](#nubi-cite-fake)`').unresolved,[]);
  assert.deepEqual(sources.review('```md\n[Rule](#nubi-cite-fake)\n```').unresolved,[]);
  const result=sources.review('[Rule](#nubi-cite-fake)');
  assert.deepEqual(result.unresolved,['fake']);assert.equal(result.resolved.length,0);
});

test('failed citation repair remains a limited review, never a ready result',async()=>{
  const sources=new AnswerSources();let final;
  await runReviewedAgent({messages:[],signal:new AbortController().signal,
    run:async()=>({content:'[Rule](#nubi-cite-fake)'}),snapshot:()=>({evidence:[],receipts:{}}),
    waiting:()=>false,continuation:()=>[],
    review:async({candidate})=>reviewCitationIntegrity({status:'ready',checks:[{requirementId:'request',state:'supported'}]},sources.review(candidate)),
    onReview:async verdict=>{final=verdict;}});
  assert.equal(final.status,'revise');assert.match(final.handoff,/review_(stalled|limit)/);
});
