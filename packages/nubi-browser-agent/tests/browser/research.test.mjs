import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from 'playwright-core';
import {createPlaywrightDocumentReader} from '../../dist/research-playwright.js';

test('document reader uses current scoped links, reads visible content, releases owned pages and rejects changed links',async t=>{
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(req.url==='/detail'?'<title>Detail</title><main><h1>Detail</h1><p>Fresh fact 42</p><p hidden>HIDDEN_SECRET</p><input value="CURRENT_VALUE"><div contenteditable>PRIVATE_EDITOR</div><p style="display:none">CSS_SECRET</p><table><tr><td>display</td><td>100</td></tr></table></main>':'<title>List</title><main><a href="/detail#one">Read detail</a><a href="/detail#two">Duplicate</a><a href="https://blocked.test/">Blocked</a></main>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext(),page=await context.newPage();t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});await page.goto(origin);
 const ctx={signal:new AbortController().signal},observation={state:'ready',observationId:'obs',binding:{tabId:'t',documentId:'d',revision:'r'}};let opened=0,closed=0;
 const reader=createPlaywrightDocumentReader({page:()=>page,roots:p=>[{frame:p.mainFrame(),root:p.locator('main')}],access:async()=>true,allowUrl:async url=>new URL(url).origin===origin,open:async url=>{opened++;const p=await context.newPage();await p.goto(url);return p;},close:async p=>{closed++;await p.close();},ready:async p=>p.locator('h1').waitFor()});
 const links=await reader.capture(ctx,observation);assert.equal(links.length,1);assert.equal(await reader.validate(ctx,observation,links),true);const result=await reader.read(ctx,links[0]);assert.ok(result.text.includes('Fresh fact 42'));assert.ok(!/HIDDEN_SECRET|CSS_SECRET|CURRENT_VALUE|PRIVATE_EDITOR/.test(result.text));assert.equal(opened,1);assert.equal(closed,1);
 await page.locator('a').first().evaluate(a=>a.href='/different');assert.equal(await reader.validate(ctx,observation,links),false);await reader.forget('obs');assert.equal(await reader.validate(ctx,observation,links),false);
});

test('protected redirected documents are closed before any authorized DOM root is consulted',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext(),page=await context.newPage(),protectedPage=await context.newPage();t.after(()=>browser.close());await protectedPage.setContent('<title>Protected</title><main>PRIVATE</main>');let roots=0,closed=0;
 const reader=createPlaywrightDocumentReader({page:()=>page,roots:()=>{roots++;throw Error('must not read');},access:async()=>false,allowUrl:async()=>true,open:async()=>protectedPage,close:async p=>{closed++;await p.close();},ready:async()=>{throw Error('must not wait');}});
 await assert.rejects(reader.read({signal:new AbortController().signal},{linkId:'a',title:'a',url:'https://example.test/'}),/document_access_denied/);assert.equal(roots,0);assert.equal(closed,1);
});
test('semantic section reads retain current table cells and expose missing-heading fallback',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext(),main=await context.newPage();t.after(()=>browser.close());
 const html='<title>Reference</title><main><h1>Reference</h1><h2>Parameters</h2><table><tr><td>display</td><td>100</td></tr></table><pre>UNRELATED_CODE</pre><h2>Response</h2><p>Fresh response value</p></main>';
 await context.route('https://example.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
 const options={page:()=>main,roots:p=>[{frame:p.mainFrame(),root:p.locator('main')}],allowUrl:async()=>true,access:async()=>true,open:async()=>{const p=await context.newPage();await p.goto('https://example.test/');return p;},close:p=>p.close(),ready:async()=>{}};
 const ctx={signal:new AbortController().signal},link={linkId:'l',url:'https://example.test/',title:'Reference'};
 const scoped=await createPlaywrightDocumentReader({...options,focusHeadings:['Parameters']}).read(ctx,link);assert.ok(scoped.text.includes('display'));assert.ok(scoped.text.includes('100'));assert.ok(!scoped.text.includes('Fresh response'));assert.ok(!scoped.text.includes('UNRELATED_CODE'));assert.equal(scoped.selection.kind,'headings');
 const fallback=await createPlaywrightDocumentReader({...options,focusHeadings:['Missing']}).read(ctx,link);assert.equal(fallback.selection.kind,'full');assert.deepEqual(fallback.selection.missing,['Missing']);assert.ok(fallback.text.includes('Fresh response'));assert.ok(fallback.text.includes('UNRELATED_CODE'));
});
