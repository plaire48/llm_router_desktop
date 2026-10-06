import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, appendFile, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pdfFile} from './fixtures/documents.mjs';

const visits = [], pdf = pdfFile('OBSERVED_PDF_REFERENCE_2026').buffer;
const server = createServer((req, res) => {
  visits.push(req.url);
  if (req.url === '/rules.pdf') {res.writeHead(200, {'content-type':'application/pdf'}); return res.end(pdf);}
  const send = () => {res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end('<title>Owned guide</title><h1>OBSERVED_GUIDE</h1><a href="/rules.pdf">Rules PDF</a>');};
  if (['/slow-new','/slow-pending'].includes(req.url)) setTimeout(send, 600); else send();
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-pdf-navigation-')), extension = resolve(profile, 'extension');
const results = []; let context;
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive:true});
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.navigationTest={runBrowserAgent,stopBrowserAgent,browserAgentContext,ready:()=>serial(()=>{})};\n');
  context = await chromium.launchPersistentContext(profile, {headless:true, executablePath:process.env.CHROME_BINARY,
    args:[`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await navigationTest.ready(); await chrome.storage.local.set({browserWorkMode:'current'});});
  const page = await context.newPage(); await page.goto(origin + '/guide');
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const run = async (name, args={}, options={}) => {
    const start = Date.now();
    const value = await worker.evaluate(({tabId,name,args,options}) => navigationTest.runBrowserAgent('pdf-navigation', {tabId}, name, args, options), {tabId,name,args,options});
    return {...value, elapsedMs:Date.now()-start};
  };
  await run('browser_snapshot');
  if (process.env.NUBI_NAVIGATION_PDF_ONLY !== '1') {
  const opened = await run('navigate_page', {url:origin+'/slow-new', new_tab:'yes'});
  results.push({scenario:'delayed-new-tab', elapsedMs:opened.elapsedMs, error:opened.result.error || null});
  assert.equal(opened.result.error, undefined, JSON.stringify(opened.result));
  assert.notEqual(opened.tabId, tabId);
  assert(opened.result.observation.frames.some(frame => frame.text?.includes('OBSERVED_GUIDE')));
  assert.equal(visits.filter(path => path === '/slow-new').length, 1);
  assert.equal((await worker.evaluate(() => navigationTest.browserAgentContext('pdf-navigation'))).tabId, opened.tabId);
  console.log('PASS a new tab with delayed headers is adopted once and returns its actual document');
  const waiting = await run('navigate_page',{url:origin+'/slow-pending',new_tab:'yes'},{navigationLoadMs:100});
  assert.equal(waiting.result.error,'workspace_loading');
  assert.equal(waiting.result.actionIssued,true);
  const pendingId = waiting.result.navigationTargetTabId;
  assert(pendingId);
  await new Promise(done => setTimeout(done,700));
  const recovered = await run('navigate_page',{url:origin+'/slow-pending',new_tab:'yes'});
  assert.equal(recovered.result.error,undefined,JSON.stringify(recovered.result));
  assert.equal(recovered.result.reusedCreatedTab,true);
  assert.equal(recovered.result.actionIssued,false);
  assert.equal(recovered.tabId,pendingId);
  assert.equal(visits.filter(path => path === '/slow-pending').length,1);
  console.log('PASS a timed-out new-tab attach recovers the exact previously created tab without a duplicate request');
  }

  const moved = await run('navigate_page', {url:origin+'/rules.pdf'});
  results.push({scenario:'native-pdf-navigation', elapsedMs:moved.elapsedMs, error:moved.result.error || null});
  assert.equal(moved.result.error, undefined, JSON.stringify(moved.result));
  assert(moved.elapsedMs < 6000, `Native PDF navigation waited ${moved.elapsedMs}ms`);
  assert.equal(moved.result.observation.documentFormat, 'pdf');
  assert.equal(moved.result.observation.frames[0].elements.length, 0);
  assert(moved.result.observation.topDocumentId);
  const snapshot = await run('browser_snapshot');
  results.push({scenario:'native-pdf-snapshot', elapsedMs:snapshot.elapsedMs, error:snapshot.result.error || null});
  assert(snapshot.elapsedMs < 3000, `PDF snapshot waited ${snapshot.elapsedMs}ms`);
  assert.equal(snapshot.result.documentFormat, 'pdf');
  const content = await run('read_page', {mode:'content'});
  assert.equal(content.result.method, 'pdfjs_text');
  assert.match(content.result.ranges.map(row => row.markdown).join(''), /OBSERVED_PDF_REFERENCE_2026/);
  assert.equal(content.result.source_document_id, snapshot.result.topDocumentId);
  console.log('PASS native PDF observation returns actual document identity without waiting for viewer DOM; original text is read by PDF.js');
  const back = await run('go_back');
  assert.equal(back.result.error, undefined, JSON.stringify(back.result));
  assert(back.result.observation.frames.some(frame => frame.text?.includes('OBSERVED_GUIDE')));
  if (process.env.NUBI_NAVIGATION_PDF_ONLY !== '1') assert.equal(page.url(), origin+'/guide', 'The original user tab was preserved');
  console.log('PASS history recovery observes the owned prior page without replaying a write or closing the user tab');
  await worker.evaluate(() => navigationTest.stopBrowserAgent('pdf-navigation'));
} finally {
  const output = process.env.NUBI_NAVIGATION_RESULT || 'verification/navigation-quality-2026-10-01/browser.json';
  await mkdir(resolve(output, '..'), {recursive:true});
  await writeFile(output, JSON.stringify({actualBrowser:true,actualModel:false,syntheticSite:true,results,visits}, null, 2)+'\n');
  await context?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  await rm(profile, {recursive:true,force:true});
}
