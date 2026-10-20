import test from 'node:test';import assert from 'node:assert/strict';
const mod=await import('../eval/wiki-search-model.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const observation={results:[{evidenceId:'wiki:one',path:'openwiki/a.md',hash:'h',excerpt:'A recorded source requires approval.',provenance:{start:1,end:1}}]};
test('live search answers have bounded structured fields without executable content or invented source authority',()=>{
 assert.equal(typeof mod.parseSearchAnswer,'function');const answer={answer:'Approval is required.',abstain:false,claims:[{text:'Approval is required.',citations:[{sourceId:'wiki:one',quote:'requires approval.'}]}]};assert.deepEqual(mod.parseSearchAnswer(JSON.stringify(answer)),answer);assert.throws(()=>mod.parseSearchAnswer('```json\n{}\n```'),/search_answer_invalid/);assert.throws(()=>mod.parseSearchAnswer(JSON.stringify({...answer,abstain:'false'})),/search_answer_invalid/);
});
test('model citation accuracy uses only returned source IDs and exact observed quotes',()=>{
 assert.equal(typeof mod.gradeSearchCitations,'function');const answer={claims:[{text:'Approval',citations:[{sourceId:'wiki:one',quote:'requires approval.'},{sourceId:'wiki:invented',quote:'requires approval.'},{sourceId:'wiki:one',quote:'automatic payment allowed'}]}]};const result=mod.gradeSearchCitations(answer,observation);assert.equal(result.total,3);assert.equal(result.valid,1);
});
test('independent review bindings reject missing cases and unsupported claims cannot borrow unseen evidence',()=>{
 assert.equal(typeof mod.parseSearchReview,'function');const item={id:'F001',complete:true,abstained:false,reason:'Source present.',claims:[{text:'Approval',verdict:'supported',citations:[{sourceId:'wiki:one',quote:'requires approval.'}]}]};const inputs=[{id:'F001',observation}];assert.equal(mod.parseSearchReview(JSON.stringify({judgements:[item]}),inputs)[0].claims[0].verdict,'supported');assert.throws(()=>mod.parseSearchReview('{"judgements":[]}',inputs),/search_review_invalid/);assert.throws(()=>mod.parseSearchReview(JSON.stringify({judgements:[{...item,claims:[{...item.claims[0],citations:[{sourceId:'unseen',quote:'requires approval.'}]}]}]}),inputs),/search_review_invalid/);
});
test('missing model reviews remain unjudged instead of silently increasing support scores',()=>{
 assert.equal(typeof mod.summarizeModelSearch,'function');const result=mod.summarizeModelSearch([{state:'answered',answerable:true,elapsedMs:10,citations:{valid:1,total:1},answer:{abstain:false},review:null},{state:'answered',answerable:false,elapsedMs:20,citations:{valid:0,total:0},answer:{abstain:true},review:{abstained:true,complete:true,claims:[]}}]);assert.equal(result.answered,2);assert.equal(result.reviewed,1);assert.equal(result.unjudged,1);assert.equal(result.supportRate,null);assert.equal(result.answerAbstentionPrecision,null);
});

test('the live evaluation turn persists a validated answer and real provider metadata',async()=>{
 assert.equal(typeof mod.answerSearchQuestion,'function');const answer={answer:'승인이 필요합니다.',abstain:false,claims:[{text:'승인 필요',citations:[{sourceId:'wiki:one',quote:'requires approval.'}]}]};
 const providers={status:()=>({model:'fixture-model',models:[{id:'fixture-model',resolvedModel:'fixture-model'}]}),complete:async()=>({content:JSON.stringify(answer),usage:{inputTokens:10,outputTokens:20}})};
 const result=await mod.answerSearchQuestion(providers,{query:'Is approval required?'},observation);assert.deepEqual(result.answer,answer);assert.equal(result.response.configuration.resolvedModel,'fixture-model');assert.equal(result.response.usage.outputTokens,20);
});
test('independent review batches parse and retain each observation-bound judgement',async()=>{
 assert.equal(typeof mod.reviewSearchBatch,'function');const review={judgements:[{id:'0',complete:true,abstained:false,reason:'Observed.',claims:[{text:'Approval',verdict:'supported',citations:[{sourceId:'wiki:one',quote:'requires approval.'}]}]}]};
 const providers={status:()=>({model:'other-model',models:[{id:'other-model',resolvedModel:'other-model'}]}),complete:async()=>({content:JSON.stringify(review),usage:{inputTokens:11}})};
 const result=await mod.reviewSearchBatch(providers,[{id:'0',observation}]);assert.equal(result.review[0].id,'0');assert.equal(result.response.usage.inputTokens,11);
});
test('model conditions are paired per case and reverse order to balance chronology',()=>{
 assert.equal(typeof mod.modelSearchRows,'function');const rows=mod.modelSearchRows([{stage:'baseline'},{stage:'final'}],[{id:'F1',category:'fact',answerable:true},{id:'F2',category:'fact',answerable:true}]);assert.deepEqual(rows.map(r=>[r.id,r.stage]),[['F1','baseline'],['F1','final'],['F2','final'],['F2','baseline']]);assert(rows.every(r=>r.state==='not_run'));
});

test('an invalid reviewer quote stays unverifiable with diagnostics and cannot become support',()=>{
 const value={judgements:[{id:'F1',complete:true,abstained:false,reason:'Review.',claims:[{text:'Invented fact',verdict:'supported',citations:[{sourceId:'wiki:one',quote:'not in the observed excerpt'}]}]}]};
 const result=mod.parseSearchReview(JSON.stringify(value),[{id:'F1',observation}],{invalidCitation:'unverifiable'});assert.equal(result[0].claims[0].verdict,'unverifiable');assert.equal(result[0].claims[0].citationValidation.invalid,1);assert.equal(result[0].claims[0].citationValidation.requestedVerdict,'supported');
});
