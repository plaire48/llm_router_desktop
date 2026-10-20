import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createScreenLearning} from '../../dist/knowledge-learning.js';
import {createPlaywrightScreenSource} from '../../dist/knowledge-playwright.js';
import {createWikiScreenStore} from '../../dist/knowledge-wiki.js';
import {createFileWikiDocuments} from '../../dist/knowledge-files.js';
import {startScreenKnowledgeSite} from '../../evaluation/screen-knowledge-site.mjs';

// A real Chrome/Page and durable Markdown; synthetic analyzer/answer, no claim of real-user or model quality.
test('Chrome nested-frame learning displays exact observed context, persists answers and invalidates them after frame replacement',async t=>{
 const browser=await chromium.launch({channel:process.env.NUBI_TEST_BROWSER_CHANNEL??'chrome',headless:true}),site=await startScreenKnowledgeSite(),root=await mkdtemp(join(tmpdir(),'nubi-learning-browser-'));
 t.after(async()=>{await browser.close();await site.close();await rm(root,{recursive:true,force:true});});
 const page=await browser.newPage();await page.goto(site.origin+'/compose');await page.frameLocator('iframe').locator('[contenteditable]').waitFor();
 const source=createPlaywrightScreenSource({page,screenId:'compose',variantId:'default',access:async()=>page.url().startsWith(site.origin+'/'),roots:()=>page.frames().map(frame=>({frame,root:frame.locator('body')}))});
 const scope={projectId:'browser',systemId:'generic',environmentId:'fixture',accessScopeId:'reader'},store=createWikiScreenStore(createFileWikiDocuments({root,authorize:async()=>true}));let analyses=0;
 const options={scope,source,store,analyzer:{id:'synthetic',analyze:async e=>{analyses++;return {screenType:'editor',titleEvidenceId:e.facts.find(f=>f.kind==='heading').id,fieldEvidenceIds:e.facts.filter(f=>f.kind==='field').map(f=>f.id),actionEvidenceIds:e.facts.filter(f=>f.kind==='action').map(f=>f.id),questions:[{id:'meaning',topic:'control_meaning',evidenceId:e.facts.find(f=>f.text==='対象'||f.text==='대상'||f.text==='전달 대상').id,inputMode:'long_text'}]};}},validateContext:async c=>c.observation.binding.documentId===String(await page.evaluate(()=>performance.timeOrigin)),allowAnswer:async()=>true};
 const context=async()=>({projectId:'browser',task:{taskId:'task',runId:'run',request:'화면 용도 학습',criteria:['learned']},observation:{state:'ready',observationId:'observed',binding:{tabId:'owned-page',documentId:String(await page.evaluate(()=>performance.timeOrigin)),revision:'r1'}},signal:new AbortController().signal});
 const learning=createScreenLearning(options),c=await context(),question=await learning.port.next(c);assert.equal(question.context.element,'대상');assert.equal(question.inputMode,'long_text');
 // Host-rendered text, not production Workspace UI. Both choice and free text remain available.
 const prompt=await browser.newPage();await prompt.setContent('<main><h1></h1><p></p><textarea aria-label="설명"></textarea><button>답변</button></main>');await prompt.locator('h1').evaluate((el,text)=>{el.textContent=text;},question.question);await prompt.locator('p').evaluate((el,text)=>{el.textContent=text;},question.context.element);await prompt.getByLabel('설명').fill('검토 담당자를 지정하는 항목입니다.');const reply=await prompt.getByLabel('설명').inputValue();
 assert.equal(await learning.port.answer(c,question.learningKey,reply),'saved');assert.equal(await createScreenLearning(options).port.next(await context()),null);assert.equal(analyses,1);
 const notes=await learning.knowledge.memory().lookup(await context());assert.match(notes.notes[0],/검토 담당자/);assert.ok(!JSON.stringify(notes).includes('CURRENT_TARGET_DO_NOT_STORE'));assert.equal((await learning.knowledge.recall(c.signal)).record.evidence.coverage.frames,2);
 site.change();await page.frameLocator('iframe').locator('input').fill('FRESH_REQUEST_VALUE');const oldQuestion=question.learningKey;await page.frames().find(frame=>frame.name()==='editor').goto(site.origin+'/editor?new=1');
 assert.equal(await learning.port.answer(await context(),oldQuestion,'옛 화면 설명'),'stale');const fresh=await learning.port.next(await context());assert.equal(fresh.context.element,'전달 대상');assert.notEqual(fresh.learningKey,oldQuestion);assert.equal(analyses,2);
});
