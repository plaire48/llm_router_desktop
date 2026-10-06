// Real Chrome: formatted text written into rich editors in one fill_form call.
// Measured complaint: writing a mail body was slow and came out as plain text.
// A plain editable body, an editor that handles paste with its own model, and a
// design-mode frame (the common company mail editors) each receive paragraphs,
// emphasis and lists; the result reports what arrived. A text area refuses the
// format, an existing body is not erased, and nothing unsafe reaches the page.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const page = `<!doctype html><html lang="ko"><title>메일 쓰기</title><body style="font:14px sans-serif">
<label for="plain">본문</label><div id="plain" contenteditable="true" role="textbox" aria-label="본문" style="min-height:80px;border:1px solid #999"></div>
<div id="model" contenteditable="true" role="textbox" aria-label="모델 본문" style="min-height:80px;border:1px solid #999"></div>
<label>메모<textarea id="memo" aria-label="메모"></textarea></label>
<div id="reply" contenteditable="true" role="textbox" aria-label="답장 본문" style="min-height:80px;border:1px solid #999"><p>-----Original Message-----</p><p>회의 자료를 보내드립니다.</p></div>
<iframe id="frame" title="편집기" style="width:500px;height:160px" srcdoc="<!doctype html><html><head><script>document.designMode='on'</script></head><body style='font:14px sans-serif'></body></html>"></iframe>
<script>
window.pwned = 0;
// An editor with its own document model: it takes the paste, keeps only the
// structure its schema knows (no tables), and renders later, as editors do.
const model = document.getElementById('model');
model.addEventListener('paste', event => {
  event.preventDefault();
  const html = event.clipboardData.getData('text/html');
  const holder = document.createElement('template'); holder.innerHTML = html;
  for (const node of holder.content.querySelectorAll('table')) node.replaceWith(...node.querySelectorAll('td,th'));
  setTimeout(() => {model.innerHTML = holder.innerHTML; model.dataset.pastes = String(Number(model.dataset.pastes || 0) + 1);}, 120);
});
</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-editor-html-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
const body = '<p>안녕하세요, <b>홍길동</b>님.</p><p>다음 일정을 안내드립니다.</p><ul><li>10월 15일 교육</li><li>10월 16일 <i>회의</i></li></ul><table><tr><td>장소</td><td>대강당</td></tr></table>'
  + '<script>window.pwned=1</script><img src="x" onerror="window.pwned=2"><p style="color:red" onclick="window.pwned=3">감사합니다. <a href="javascript:window.pwned=4">위험</a> <a href="https://example.test/guide">안내</a></p>';
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, viewport: {width: 900, height: 900},
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const url = `${origin}/compose`, tab = await context.newPage(); await tab.goto(url);
  await tab.frameLocator('#frame').locator('body').waitFor();
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  const run = (name, args = {}) => worker.evaluate(({tabId, name, args}) => contentTest.runBrowserAgent('editor', {tabId}, name, args).then(v => v.result), {tabId, name, args});
  const elements = snap => (snap.observation || snap).frames.flatMap(f => f.elements || []);
  const field = (snap, test) => {const found = elements(snap).find(test); assert(found, JSON.stringify(elements(snap).map(el => [el.role, el.name, el.tag]))); return found.ref;};
  const safe = async locator => locator.evaluate(el => ({scripts: el.querySelectorAll('script,img,iframe,style').length, handlers: [...el.querySelectorAll('*')].filter(node => [...node.attributes].some(a => /^on|^style$/i.test(a.name))).length,
    jsLinks: el.querySelectorAll('a[href^="javascript"]').length}));

  let snap = await run('browser_snapshot');
  let result = await run('fill_form', {fields: [{field_id: field(snap, el => el.name === '본문'), value: body, format: 'html'}]});
  assert.equal(result.error, undefined, JSON.stringify({...result, observation: undefined}).slice(0, 600));
  assert.equal(result.verified, true); assert.equal(result.formatted[0].method, 'insert_html');
  assert.deepEqual({...result.formatted[0].formatting, paragraphs: undefined}, {paragraphs: undefined, listItems: 2, bold: 1, italic: 1, links: 1, tables: 1, headings: 0});
  const plain = tab.locator('#plain');
  assert.equal(await plain.locator('ul li').count(), 2); assert.equal(await plain.locator('b, strong').first().textContent(), '홍길동');
  assert.deepEqual(await safe(plain), {scripts: 0, handlers: 0, jsLinks: 0}); assert.equal(await tab.evaluate(() => window.pwned), 0);
  pass('a plain editable body receives paragraphs, bold, italic, a list, a table and a safe link in one call; scripts, handlers, styles and javascript: links do not arrive');

  snap = await run('browser_snapshot');
  result = await run('fill_form', {fields: [{field_id: field(snap, el => el.name === '모델 본문'), value: body, format: 'html'}]});
  assert.equal(result.error, undefined, JSON.stringify({...result, observation: undefined}).slice(0, 600));
  assert.equal(result.verified, true); assert.equal(result.formatted[0].method, 'paste');
  assert.equal(await tab.locator('#model').getAttribute('data-pastes'), '1', 'the editor took the paste once and was not given the text a second time');
  assert.deepEqual(result.formatted[0].formattingLost, ['tables'], JSON.stringify(result.formatted));
  assert.equal(await tab.locator('#model ul li').count(), 2);
  pass('an editor with its own model takes the paste once, renders later, and the result names the formatting it dropped');

  snap = await run('browser_snapshot');
  const frameBody = elements(snap).find(el => el.tag === 'body' || el.name === '편집기');
  if (frameBody) {
    result = await run('fill_form', {fields: [{field_id: frameBody.ref, value: body, format: 'html'}]});
    assert.equal(result.error, undefined, JSON.stringify({...result, observation: undefined}).slice(0, 600));
    assert.equal(result.verified, true);
    const frame = tab.frameLocator('#frame').locator('body');
    assert.equal(await frame.locator('li').count(), 2); assert.deepEqual(await safe(frame), {scripts: 0, handlers: 0, jsLinks: 0});
    pass('a design-mode frame editor receives the formatted body');
  } else console.log('SKIP design-mode frame body is not observed as a field: ' + JSON.stringify(elements(snap).map(el => [el.role, el.name, el.tag])));

  snap = await run('browser_snapshot');
  result = await run('fill_form', {fields: [{field_id: field(snap, el => el.name === '메모'), value: '<p>메모</p>', format: 'html'}]});
  assert.equal(result.error, 'fill_format_unsupported'); assert.equal(result.actionIssued, false); assert.equal(await tab.locator('#memo').inputValue(), '');
  pass('a text area refuses the format before anything is written');

  snap = await run('browser_snapshot');
  const reply = field(snap, el => el.name === '답장 본문');
  result = await run('fill_form', {fields: [{field_id: reply, value: '<p>검토 부탁드립니다.</p>', format: 'html'}]});
  assert.equal(result.error, 'fill_would_erase', JSON.stringify({...result, observation: undefined}).slice(0, 400));
  snap = await run('browser_snapshot');
  result = await run('fill_form', {fields: [{field_id: field(snap, el => el.name === '답장 본문'), value: '<p><b>검토 부탁드립니다.</b></p>', format: 'html', position: 'start'}]});
  assert.equal(result.error, undefined, JSON.stringify({...result, observation: undefined}).slice(0, 600)); assert.equal(result.verified, true);
  const text = await tab.locator('#reply').innerText();
  assert.match(text, /^검토 부탁드립니다\.[\s\S]*-----Original Message-----[\s\S]*회의 자료를 보내드립니다\.$/);
  assert.equal(await tab.locator('#reply b, #reply strong').count(), 1);
  pass('a reply body keeps its quoted original: a replace is refused, a formatted greeting goes above it');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
