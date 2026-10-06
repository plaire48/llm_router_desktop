// Real Chrome: what the host records so a replay can repeat a click at a point
// and a tab switch. A click at image coordinates reports the innermost observed
// control that held the point (a replay clicks that control, found again); a
// point on no observed control reports none. A tab switch returns the page it
// switched to (a replay finds that tab again by its page, not by its id).
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const page = `<!doctype html><html lang="ko"><title>결재</title><body style="margin:0;font:14px sans-serif">
<div id="row" style="position:absolute;left:40px;top:60px;width:500px;height:48px;background:#eef" onclick="clicks.push('row')">
  <span style="position:absolute;left:10px;top:14px">출장 보고서</span>
  <button id="approve" type="button" style="position:absolute;left:300px;top:8px;width:120px;height:32px" onclick="event.stopPropagation();clicks.push('approve')"><span>결재선 지정</span></button>
</div>
<canvas id="map" width="200" height="120" style="position:absolute;left:40px;top:200px;background:#cfc"></canvas>
<a id="open" href="/popup" target="_blank">결재선 창 열기</a>
<script>window.clicks=[];</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url.startsWith('/popup') ? '<!doctype html><title>결재선 창</title><p>결재선</p>' : page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-replay-kinds-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, viewport: {width: 900, height: 600},
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const url = `${origin}/list`, tab = await context.newPage(); await tab.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  const run = (name, args = {}) => worker.evaluate(({tabId, name, args}) => contentTest.runBrowserAgent('kinds', {tabId}, name, args, {vision: true, onCapture: async () => ({availableInChat: true})}).then(v => v.result), {tabId, name, args});
  const elements = snap => (snap.observation || snap).frames.flatMap(f => f.elements || []);

  let snap = await run('browser_snapshot');
  const button = elements(snap).find(el => el.name === '결재선 지정');
  let shot = await run('capture_page', {full_page: false});
  // The capture returns a fresh observation; its refs are the ones a click names.
  const shown = elements(shot).find(el => el.name === '결재선 지정') || button;
  let result = await run('click_at', {screenshot_id: shot.screenshot_id, x: 380, y: 84});
  assert.equal(result.error, undefined, JSON.stringify(result).slice(0, 300));
  assert.equal(result.pointedRef, shown.ref, `the point on the button text reports the button, not its row: ${JSON.stringify({...result, observation: undefined, effect: undefined})}`);
  assert.deepEqual(await tab.evaluate(() => clicks), ['approve']);
  pass('a click at a point reports the innermost observed control that held it');

  snap = await run('browser_snapshot'); shot = await run('capture_page', {full_page: false});
  result = await run('click_at', {screenshot_id: shot.screenshot_id, x: 140, y: 260});
  assert.equal(result.error, undefined, JSON.stringify(result).slice(0, 300));
  assert.equal(result.pointedRef, undefined, 'a point on a canvas holds no observed control');
  pass('a point on no observed control reports none, so that step is not replayed');

  snap = await run('browser_snapshot');
  const link = elements(snap).find(el => el.name === '결재선 창 열기');
  await run('click_element', {ref: link.ref});
  const tabs = await run('list_tabs');
  const popup = tabs.tabs.find(item => (item.url || '').includes('/popup'));
  assert(popup, JSON.stringify(tabs).slice(0, 300));
  result = await run('switch_tab', {tab_id: popup.tab_id});
  assert.equal(result.error, undefined, JSON.stringify(result).slice(0, 300));
  assert.equal(new URL(result.observation.url).pathname, '/popup');
  assert.equal(result.observation.title, '결재선 창');
  pass('a tab switch returns the page and title of the tab it switched to');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
