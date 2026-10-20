import test from 'node:test';import assert from 'node:assert/strict';import JSZip from 'jszip';
import {composeWord} from '../dist/composition.js';import {createHostModelTransport} from '../dist/host-model.js';
const quality=await import('../dist/quality.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const plan=()=>({title:'Review',blocks:[{kind:'paragraph',text:'Before'}]}),signal=()=>new AbortController().signal;
const api=()=>{assert.equal(typeof quality.runCompositionQuality,'function','common review/repair cycle is absent');return quality.runCompositionQuality;};
const input=()=>({domain:'word',plan:plan(),request:'Correct only the observed text.',sources:{original:'After'},maxRepairs:1});
const build=async({plan,signal})=>composeWord(plan,signal,{fontFamily:'Apple SD Gothic Neo'});
const receipt=(c,failed=[])=>({artifactHash:c.artifactHash,planHash:c.planHash,checks:['structure','facts','preservation','render','layout','visual'].map(kind=>({kind,status:failed.includes(kind)?'failed':'passed',evidence:'Observed test-host evidence'})),pages:{count:1,rendered:[{page:1,imageHash:'a'.repeat(64)}],reviewed:[1]},findings:failed.length?[{code:'wrong_text',kind:failed[0],severity:'major',path:'/blocks/0',message:'Replace Before with the source-supported After.'}]:[]});
function transport(patches){let n=0;return createHostModelTransport({id:'test-model',async complete(messages){if(!messages.some(m=>m.role==='tool'))return{content:'',calls:[{id:'read'+n,function:{name:'read_word_sources',arguments:{}}}]};if(!n++){return{content:'',calls:[{id:'patch',function:{name:'submit_word_draft',arguments:{patches}}}]};}return{content:'Draft proposed',calls:[]};}});}
test('actual DOCX is repaired, rebuilt and re-reviewed before verified_draft',async()=>{
 const run=api(),original=input();let seen=0;
 const result=await run(original,{build,transport:transport([{op:'replace',path:'/blocks/0/text',value:'After'}]),async inspect({candidate}){return receipt(candidate,seen++?[]:['facts']);}},signal());
 assert.equal(result.status,'verified_draft');assert.equal(result.repairs,1);assert.equal(result.rounds.length,2);assert.notEqual(result.rounds[0].artifactHash,result.rounds[1].artifactHash);assert.equal(original.plan.blocks[0].text,'Before');const z=await JSZip.loadAsync(result.candidate.bytes);assert.match(await z.file('word/document.xml').async('string'),/After/);assert.equal(result.savedToOffice,false);
});
test('missing reviewed pages prevents a clean receipt from declaring completion',async()=>{
 const run=api(),i=input();i.maxRepairs=0;
 const result=await run(i,{build,async inspect({candidate}){const r=receipt(candidate);r.pages.reviewed=[];return r;}},signal());assert.equal(result.status,'needs_review');assert.equal(result.repairs,0);
});
test('a receipt for an older artifact is rejected',async()=>{
 await assert.rejects(()=>api()(input(),{build,async inspect({candidate}){return{...receipt(candidate),artifactHash:'0'.repeat(64)};}},signal()),e=>e.code==='quality_receipt_stale');
});
test('a repair cannot silently change content outside the observed issue',async()=>{
 const i=input();i.plan.blocks.push({kind:'paragraph',text:'Keep this exact clause'});
 await assert.rejects(()=>api()(i,{build,transport:transport([{op:'replace',path:'/blocks/1/text',value:'Changed'}]),async inspect({candidate}){return receipt(candidate,['facts']);}},signal()),e=>e.code==='quality_repair_scope');
});
test('a regression in a previously passed gate retains the previous draft',async()=>{
 let seen=0;const result=await api()(input(),{build,transport:transport([{op:'replace',path:'/blocks/0/text',value:'After'}]),async inspect({candidate}){return receipt(candidate,seen++?['preservation']:['facts']);}},signal());assert.equal(result.status,'repair_regression');assert.equal(result.candidate.plan.blocks[0].text,'Before');assert.equal(result.rounds.length,2);assert.equal(result.savedToOffice,false);
});
test('unchanged repair terminates without pretending it improved the file',async()=>{
 const result=await api()(input(),{build,transport:transport([{op:'replace',path:'/blocks/0/text',value:'Before'}]),async inspect({candidate}){return receipt(candidate,['facts']);}},signal());assert.equal(result.status,'stalled');assert.equal(result.rounds.length,1);
});
test('cancellation ignores a late review receipt',async()=>{
 const c=new AbortController(),run=api();await assert.rejects(()=>run(input(),{build,async inspect({candidate}){c.abort();return receipt(candidate);}},c.signal),e=>e.code==='operation_cancelled');
});
test('Excel cannot be verified without an actual calculation receipt',async()=>{
 const run=api(),i={...input(),domain:'excel',maxRepairs:0,plan:{title:'Calc',sheets:[{name:'Data',widths:[20],cells:[{address:'A1',formula:'SUM(1,2)'}]}],outputs:[]}};
 const {composeExcel}=await import('../dist/composition.js');const result=await run(i,{build:({plan,signal})=>composeExcel(plan,{},signal),async inspect({candidate}){return receipt(candidate);}},signal());assert.equal(result.status,'needs_review');
});
test('a blocking finding cannot be hidden by passing status labels',async()=>{
 const i=input();i.maxRepairs=0;const result=await api()(i,{build,async inspect({candidate}){const r=receipt(candidate);r.findings=receipt(candidate,['facts']).findings;return r;}},signal());assert.notEqual(result.status,'verified_draft');
});
test('PPT text fit and overlap inspection produces exact repair locations',()=>{
 assert.equal(typeof quality.inspectCompositionQuality,'function');const p={title:'Layout',slides:[{notes:'Synthetic',elements:[{kind:'text',x:1,y:1,w:2,h:.6,fontSize:24,text:'긴 업무 설명을 좁은 상자에 여러 줄로 넣어서 넘치게 만듭니다'.repeat(3)},{kind:'text',x:1,y:1.2,w:4,h:1,fontSize:24,text:'겹치는 문장'}]}]};const findings=quality.inspectCompositionQuality('powerpoint',p);assert.ok(findings.some(f=>f.code==='text_fit'&&f.path==='/slides/0/elements/0'));assert.ok(findings.some(f=>f.code==='object_overlap'&&f.path==='/slides/0'));
});
test('a major finding in any gate prevents verified_draft',async()=>{
 const i=input();i.maxRepairs=0;const result=await api()(i,{build,async inspect({candidate}){const r=receipt(candidate);r.findings=[{code:'amount_error',kind:'calculation',severity:'major',path:'/blocks/0',message:'Observed wrong amount in this Word paragraph.'}];return r;}},signal());assert.notEqual(result.status,'verified_draft');
});
test('domain and request stay pinned when the caller mutates its input during a host call',async()=>{
 const i=input();i.maxRepairs=0;const result=await api()(i,{async build(ctx){const b=await build(ctx);i.domain='excel';i.request='Different task';return b;},async inspect({candidate}){return receipt(candidate);}},signal());assert.equal(result.candidate.domain,'word');assert.equal(result.status,'verified_draft');
});
test('repair may also fix a separately observed minor issue without widening to unobserved content',async()=>{
 const i=input();i.plan.blocks.push({kind:'paragraph',text:'Typo'});let seen=0;
 const result=await api()(i,{build,transport:transport([{op:'replace',path:'/blocks/0/text',value:'After'},{op:'replace',path:'/blocks/1/text',value:'Clean'}]),async inspect({candidate}){const r=receipt(candidate,seen++?[]:['facts']);if(r.findings.length)r.findings.push({code:'typo',kind:'visual',severity:'minor',path:'/blocks/1',message:'Correct observed typo.'});return r;}},signal());assert.equal(result.status,'verified_draft');assert.equal(result.candidate.plan.blocks[1].text,'Clean');
});
test('an explicitly failed gate with an observed minor defect can be repaired without inventing a major finding',async()=>{
 let seen=0;const result=await api()(input(),{build,transport:transport([{op:'replace',path:'/blocks/0/text',value:'After'}]),async inspect({candidate}){const r=receipt(candidate,seen++?[]:['visual']);r.findings.forEach(f=>f.severity='minor');return r;}},signal());assert.equal(result.status,'verified_draft');assert.equal(result.repairs,1);
});
