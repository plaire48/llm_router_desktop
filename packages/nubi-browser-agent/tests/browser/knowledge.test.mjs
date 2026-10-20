import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaywrightScreenSource} from '../../dist/knowledge-playwright.js';
import {createStagehandScreenAnalyzer} from '../../dist/stagehand.js';
import {createScreenKnowledge} from '../../dist/knowledge.js';
import {stagehandBrowserHost} from '../../evaluation/stagehand-browser-host.mjs';
import {startScreenKnowledgeSite} from '../../evaluation/screen-knowledge-site.mjs';
import {startLegacySite} from '../../evaluation/legacy-site.mjs';

test('real Stagehand SDK attaches to the host Chrome, extracts nested-frame knowledge and never owns an action loop',async t=>{
 const controller=new AbortController();let facts=[],calls=0;
 const host=await stagehandBrowserHost({id:'injected-test-model',async complete(_messages,tools){calls++;const value=tools[0].function.parameters.properties.progress?{progress:'Observed the requested fields and actions.',completed:true}:{screenType:'editor',titleEvidenceId:facts.find(f=>f.kind==='heading').id,fieldEvidenceIds:facts.filter(f=>f.kind==='field').map(f=>f.id),actionEvidenceIds:facts.filter(f=>f.kind==='action').map(f=>f.id)};return {content:'',calls:[{id:crypto.randomUUID(),function:{name:'screen_analysis',arguments:JSON.stringify(value)}}]};}},()=>controller.signal);
 const site=await startScreenKnowledgeSite();t.after(async()=>{await host.close();await site.close();});await host.page.goto(site.origin+'/compose');await host.page.frameLocator('iframe').locator('[contenteditable]').waitFor();
 const source=createPlaywrightScreenSource({page:host.page,screenId:'compose',variantId:'default',access:async()=>true,roots:()=>host.page.frames().map(frame=>({frame,root:frame.locator('body')}))});
 const evidence=await source.observe(controller.signal);facts=evidence.facts;assert.equal(evidence.coverage.frames,2);assert.ok(facts.some(f=>f.text==='대상'));assert.ok(facts.some(f=>f.text==='내용'));assert.ok(!JSON.stringify(evidence).includes('CURRENT_'));
 const analyzer=createStagehandScreenAnalyzer({stagehand:host.sdk,modelBridge:host.modelBridge,page:host.page,validate:source.validate});const result=await analyzer.analyze(evidence,controller.signal);assert.equal(result.screenType,'editor');assert.equal(calls,2);assert.equal(result.fieldEvidenceIds.length,2);assert.equal(await source.validate(evidence,controller.signal),true);
 await host.page.frameLocator('iframe').locator('input').fill('NEW_REQUEST_VALUE');const changedValue=await source.observe(controller.signal);assert.equal(changedValue.fingerprint,evidence.fingerprint,'current input values do not change template identity');assert.equal(await source.validate(evidence,controller.signal),true);
 site.change();await host.page.reload();await host.page.frameLocator('iframe').locator('[contenteditable]').waitFor();assert.equal(await source.validate(evidence,controller.signal),false,'document replacement invalidates in-flight evidence');const fresh=await source.observe(controller.signal);assert.notEqual(fresh.fingerprint,evidence.fingerprint);
});

test('screen access is checked before any DOM read, and a changed surface is not persisted',async t=>{
 const controller=new AbortController();const fake={isClosed:()=>false};let reads=0;
 const source=createPlaywrightScreenSource({page:fake,screenId:'screen',variantId:'default',access:async()=>false,roots:()=>{reads++;throw Error('must not read');}});
 await assert.rejects(source.observe(controller.signal),/screen_access_denied/);assert.equal(reads,0);
});

test('real Stagehand also reads three frame levels and child-only navigation invalidates the current analysis evidence',async t=>{
 const controller=new AbortController();let facts=[];
 const host=await stagehandBrowserHost({id:'injected-test-model',async complete(_messages,tools){const value=tools[0].function.parameters.properties.progress?{progress:'Observed the requested controls.',completed:true}:{screenType:'editor',titleEvidenceId:facts.find(f=>f.kind==='heading').id,fieldEvidenceIds:facts.filter(f=>f.kind==='field').map(f=>f.id),actionEvidenceIds:facts.filter(f=>f.kind==='action').map(f=>f.id)};return {content:'',calls:[{function:{name:'screen_analysis',arguments:JSON.stringify(value)}}]};}});
 const site=await startLegacySite();t.after(async()=>{await host.close();await site.close();});await host.page.goto(site.origin);await host.page.frameLocator('iframe[name=outer]').frameLocator('iframe[name=editor]').locator('[contenteditable]').waitFor();
 const source=createPlaywrightScreenSource({page:host.page,screenId:'legacy',variantId:'default',access:async()=>true,roots:()=>host.page.frames().map(frame=>({frame,root:frame.locator('body')}))}),e=await source.observe(controller.signal);facts=e.facts;
 assert.equal(e.coverage.frames,3);assert.deepEqual(facts.filter(f=>f.kind==='field').map(f=>f.text).sort(),['업무 구분','수신자 주소','본문'].sort());assert.ok(facts.some(f=>f.kind==='action'&&f.text==='저장'));
 const result=await createStagehandScreenAnalyzer({stagehand:host.sdk,modelBridge:host.modelBridge,page:host.page,validate:source.validate}).analyze(e,controller.signal);assert.equal(result.fieldEvidenceIds.length,3);assert.equal(site.saveCount(),0);
 const parent=host.page.url(),child=host.page.frames().find(f=>f.name()==='editor');await child.goto(site.origin+'/editor?replacement=1');assert.equal(host.page.url(),parent);assert.equal(await source.validate(e,controller.signal),false);
});
