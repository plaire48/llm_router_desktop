// Real Chrome: a field that a choice reveals is named in the observation while it
// is hidden. Measured (M-08, one model, three runs): the email field appears only
// after choosing online, the model saw no such field and asked the user instead
// of making the choice. Hidden fields of a closed dialog and secret fields are not
// named, and no value leaves the page.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const page = `<!doctype html><html lang="ko"><title>신청</title><body>
<button id="open" onclick="document.querySelector('#settings').showModal()">신청 설정</button>
<dialog id="settings"><form><h2>참석 설정</h2>
<label>참석 유형<select id="kind" onchange="document.querySelector('#online').hidden=this.value!=='온라인'"><option>현장</option><option>온라인</option></select></label>
<div id="online" hidden><label>이메일<input type="email" value="hidden-value@example.test"></label><label>인증번호<input id="otp"></label></div>
<label>현장 메모<textarea>기존 현장 안내</textarea></label></form></dialog>
<dialog id="closed"><form><label>숨은 칸<input hidden></label></form></dialog>
</body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-conditional-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const tab = await context.newPage(); await tab.goto(origin + '/form');
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, origin + '/form');
  const run = (name, args = {}) => worker.evaluate(({tabId, name, args}) => contentTest.runBrowserAgent('conditional', {tabId}, name, args).then(v => v.result), {tabId, name, args});
  const hiddenOf = snap => (snap.observation || snap).frames.flatMap(frame => frame.hiddenFields?.fields || []);
  const elements = snap => (snap.observation || snap).frames.flatMap(frame => frame.elements || []);

  let snap = await run('browser_snapshot');
  assert.deepEqual(hiddenOf(snap), [], 'a closed dialog names nothing');
  await run('click_element', {ref: elements(snap).find(el => el.name === '신청 설정').ref});
  snap = await run('browser_snapshot');
  const named = hiddenOf(snap);
  assert.deepEqual(named.map(field => field.name), ['이메일'], JSON.stringify(named));
  assert.equal(named[0].in, '참석 설정'); assert.equal(named[0].type, 'email');
  assert(!JSON.stringify(snap).includes('hidden-value@example.test'), 'no hidden value leaves the page');
  assert(!JSON.stringify(named).includes('인증번호'), 'a secret field is not named');
  pass('a field hidden until a choice is named with its dialog, without its value; secret and closed-dialog fields are not');

  const kind = elements(snap).find(el => el.name === '참석 유형');
  const selected = await run('select_option', {ref: kind.ref, values: ['온라인']}); assert.equal(selected.error, undefined, JSON.stringify(selected).slice(0, 300));
  snap = await run('browser_snapshot');
  assert(elements(snap).some(el => el.name === '이메일'), 'the revealed field is an observed control');
  assert.deepEqual(hiddenOf(snap), [], 'nothing is hidden any more');
  pass('after the choice the field is an observed control and no longer listed as hidden');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
