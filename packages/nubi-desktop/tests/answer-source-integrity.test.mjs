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

test('mail, attachment and Wiki share first-use numbers in the saved answer',()=>{
  const sources=new AnswerSources();
  const [mail,attachment]=sources.mail({id:'a'.repeat(64),sourceHash:'original',mail:{subject:'일정 안내',text:'금요일 제출',attachments:[
    {id:'document',filename:'일정.pdf',sha256:'document-hash',text:'오후 3시',segments:[{page:2,text:'오후 3시'}]},
    {id:'not-read',filename:'제외.pdf',sha256:'excluded',contentState:'not_stored'}
  ]}});
  const wiki=sources.file({path:'openwiki/release.md',hash:'wiki-hash',content:'담당자는 개발팀'},'wiki');
  sources.file({path:'unrelated.md',hash:'other',content:'검토만 한 내용'});
  const result=sources.finish(`금요일 제출 [메일](${mail.href}), 오후 3시입니다 [99](${attachment.href}). 개발팀이 담당합니다 [위키](${wiki.href}). 일정 재확인 [9](${mail.href}).`);
  assert.deepEqual(result.sourceReferences.map(s=>[s.number,s.citationId]),[[1,mail.citationId],[2,attachment.citationId],[3,wiki.citationId]]);
  assert.equal(result.content,`금요일 제출 [1](${mail.href}), 오후 3시입니다 [2](${attachment.href}). 개발팀이 담당합니다 [3](${wiki.href}). 일정 재확인 [1](${mail.href}).`);
  assert(!result.sourceReferences.some(s=>s.attachmentId==='not-read'));
  assert(result.consultedSources.some(s=>s.path==='unrelated.md'));
  assert.equal(sources.finish(result.content).content,result.content);
});

test('Markdown examples stay untouched while reference-style citations are numbered',()=>{
  const sources=new AnswerSources(),source=sources.file({path:'rule.md',hash:'h',content:'A rule'});
  const examples=`\`[예시](${source.href})\`\n\n    [예시](${source.href})\n\n![이미지](${source.href})\n\n\\[문자](${source.href})\n\n~~~md\n[예시](${source.href})\n~~~`;
  assert.equal(sources.finish(examples).content,examples);
  assert.equal(sources.finish(examples).sourceReferences.length,0);
  const result=sources.finish(`${examples}\n\n근거 [설명][ref]\n\n[ref]: ${source.href}`);
  assert.equal(result.sourceReferences.length,1);
  assert(result.content.startsWith(examples));
  assert(result.content.includes(`근거 [1](${source.href})`));
  assert.deepEqual(sources.finish('[없는 출처][ref]\n\n[ref]: #nubi-cite-fake').unresolvedCitationIds,['fake']);
});

test('an answer independent of available evidence receives no automatic citation',()=>{
  const sources=new AnswerSources();sources.file({path:'openwiki/history.md',hash:'old',content:'Earlier research'},'wiki');
  const content='안녕하세요! 어떤 작업을 도와드릴까요?';
  const result=sources.finish(content);
  assert.equal(result.content,content);assert.deepEqual(result.sourceReferences,[]);
  assert.equal(result.consultedSources.length,1);
  const ready={status:'ready',checks:[{requirementId:'request',state:'supported'}]};
  assert.equal(reviewCitationIntegrity(ready,sources.review(content)),ready);
});
