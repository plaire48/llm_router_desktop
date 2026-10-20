import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {searchFixture,validateSearchFixture} from '../eval/wiki-search/fixtures.mjs';
const evaluation=await import('../eval/wiki-search.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
test('the S1 oracle has 200 disjoint categorized cases with real hashed line spans and stays outside the corpus',async()=>{
 const data=searchFixture(),counts=validateSearchFixture(data);assert.equal(counts.cases,200);assert(counts.pages>401);
 const saved=(await Promise.all(['fact','procedure','code','multi','none'].map(async category=>JSON.parse(await readFile(new URL('../eval/wiki-search/cases/'+category+'.json',import.meta.url),'utf8'))))).flat();assert.deepEqual(saved,data.cases);
 for(const category of ['fact','procedure','code','multi','none'])for(const [language,count] of [['direct',20],['korean-paraphrase',10],['mixed',10]])assert.equal(data.cases.filter(c=>c.category===category&&c.language===language).length,count);
 assert.equal(Object.keys(data.files).some(p=>p.includes('/cases/')),false);assert.throws(()=>validateSearchFixture({...data,cases:data.cases.slice(1)}),/count/);
});
test('S1 retrieval metrics require matching hash and spans and count each required evidence group once',()=>{
 assert.equal(typeof evaluation.gradeRetrieval,'function');const testCase=searchFixture().cases.find(c=>c.id==='M001'),[a,b]=testCase.evidenceGroups.map(g=>g.alternatives[0]);
 const hit=ref=>({path:ref.page,hash:ref.sourceHash,excerpt:ref.quote,provenance:{start:ref.start,end:ref.end}});
 const one=evaluation.gradeRetrieval(testCase,[hit(a),hit(a)]);assert.equal(one.groupsHit,1);assert.equal(one.groupsTotal,2);assert.equal(one.reciprocalRank,1);
 assert.equal(evaluation.gradeRetrieval(testCase,[{...hit(a),hash:'wrong'},hit(b)]).groupsHit,1);assert.equal(evaluation.gradeRetrieval(testCase,[hit(a),hit(b)]).groupsHit,2);
});
test('S1 does not relabel retrieval-only abstention as model answer precision or support',()=>{
 assert.equal(typeof evaluation.summarizeSearch,'function');const data=searchFixture(),none=data.cases.find(c=>c.category==='none'),yes=data.cases.find(c=>c.category==='fact');
 const rows=[{id:yes.id,category:yes.category,answerable:true,elapsedMs:5,groupsHit:0,groupsTotal:1,reciprocalRank:0,returned:0},{id:none.id,category:none.category,answerable:false,elapsedMs:7,groupsHit:0,groupsTotal:0,reciprocalRank:0,returned:0}];
 const summary=evaluation.summarizeSearch(rows);assert.equal(summary.recallAt5,0);assert.equal(summary.retrievalAbstentionPrecision,.5);assert.equal(summary.answerEvidenceSupport,null);assert.equal(summary.citationAccuracy,null);assert.equal(summary.answerAbstentionPrecision,null);assert.equal(summary.latency.p95,7);
});
