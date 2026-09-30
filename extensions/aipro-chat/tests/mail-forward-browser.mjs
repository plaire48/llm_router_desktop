// Real Chrome: a forward already holds the signature and the quoted original
// below "----- Original Message -----". Reported from a company mail: the agent
// replaced the whole body and lost them. A write that would erase text a
// multi-line field already holds is refused; the text goes above or below it,
// and replacing it needs the user's answer.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const body = '<div><br></div><div>--</div><div>홍길동 | 개발팀 | 010-1234-5678</div><div>----- Original Message -----</div><div>From: 인사팀</div><div>교육 일정은 10월 15일, 장소는 본관 대강당입니다.</div>';
const page = `<!doctype html><html lang="ko"><title>메일 쓰기</title><body style="font:14px sans-serif">
<label>제목 <input id="subject" value="FW: 10월 교육 일정 안내"></label>
<div id="body" role="textbox" aria-multiline="true" aria-label="본문" contenteditable="true" style="border:1px solid #999;min-height:160px;padding:6px">${body}</div>
<label>메모 <textarea id="memo">기존 메모 첫 줄
기존 메모 둘째 줄</textarea></label>
<div id="draft" role="textbox" aria-multiline="true" aria-label="새 초안" contenteditable="true" style="border:1px solid #999;min-height:60px"></div>
<iframe id="editor" title="편집기" srcdoc='<body id="frame-body" role="textbox" aria-label="편집기 본문" contenteditable="true">${body}</body>' style="width:600px;height:200px"></iframe>
<iframe id="design" title="디자인 편집기" srcdoc='<body aria-label="디자인 본문">${body}<script>document.designMode="on"</script></body>' style="width:600px;height:200px"></iframe>
</body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-mail-forward-')), extension = resolve(profile, 'extension');
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
  const url = `${origin}/compose`, tab = await context.newPage(); await tab.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  const run = (name, args = {}, options = {}) => worker.evaluate(({tabId, name, args, options}) => contentTest.runBrowserAgent('forward', {tabId}, name, args, options).then(v => v.result), {tabId, name, args, options});
  const refs = async () => {
    const snap = await run('browser_snapshot'), all = (snap.observation || snap).frames.flatMap(f => f.elements || []);
    const by = name => all.find(el => el.name === name)?.ref;
    return {subject: by('제목'), body: by('본문'), memo: by('메모'), draft: by('새 초안')};
  };
  const text = id => tab.evaluate(id => {const el = document.getElementById(id); return el.isContentEditable ? el.innerText : el.value;}, id);
  const original = await text('body');

  let r = await refs(), result = await run('fill_form', {fields: [{field_id: r.body, value: '안녕하세요. 아래 메일 전달드립니다.'}]});
  assert.equal(result.error, 'fill_would_erase', JSON.stringify(result).slice(0, 300));
  assert.equal(result.applied ?? 0, 0); assert.equal(result.actionIssued, false);
  assert.equal(result.erasing[0].field_id, r.body); assert(result.erasing[0].existingCharacters > 40);
  assert.match(result.instruction, /position "start"/); assert.match(result.instruction, /기존 내용 지우고 새로 쓰기/);
  assert.equal(await text('body'), original, 'the body is unchanged');
  pass('a fill that would erase the quoted original and the signature is refused and writes nothing');

  r = await refs();
  result = await run('verify_page', {checks: [{kind: 'field_unchanged', ref: r.body, expected: 'true'}]});
  assert.equal(result.verified, true, JSON.stringify(result.checks));
  pass('the refused field keeps its first mark, so its preservation can be verified');

  r = await refs();
  result = await run('fill_form', {fields: [{field_id: r.body, value: '안녕하세요. 아래 메일 전달드립니다.\n', position: 'start'}, {field_id: r.subject, value: 'FW: 10월 교육 일정 안내 (참고)'}]});
  assert.equal(result.error, undefined, JSON.stringify(result).slice(0, 300)); assert.equal(result.verified, true);
  const after = await text('body');
  assert(after.startsWith('안녕하세요. 아래 메일 전달드립니다.'), after);
  for (const line of ['홍길동 | 개발팀 | 010-1234-5678', '----- Original Message -----', 'From: 인사팀', '교육 일정은 10월 15일, 장소는 본관 대강당입니다.']) assert(after.includes(line), `${line} kept: ${after}`);
  assert(after.indexOf('안녕하세요') < after.indexOf('홍길동'), 'the message is above the signature');
  assert.equal(await text('subject'), 'FW: 10월 교육 일정 안내 (참고)', 'a single-line field is replaced as before');
  pass('position start writes the message above the signature and keeps the original; a subject is replaced as before');

  r = await refs();
  result = await run('fill_form', {fields: [{field_id: r.memo, value: '추가 메모', position: 'end'}]});
  assert.equal(result.verified, true, JSON.stringify(result).slice(0, 300));
  assert.equal(await text('memo'), '기존 메모 첫 줄\n기존 메모 둘째 줄추가 메모');
  pass('position end adds text after what a text area holds');

  r = await refs();
  result = await run('fill_form', {fields: [{field_id: r.memo, value: '새 메모만', replace_existing: true}]});
  assert.equal(result.error, 'fill_would_erase'); assert.equal(result.erasing[0].replaceNeedsAnswer, true);
  assert.equal(await text('memo'), '기존 메모 첫 줄\n기존 메모 둘째 줄추가 메모');
  r = await refs();
  result = await run('fill_form', {fields: [{field_id: r.memo, value: '새 메모만', replace_existing: true}]}, {answered: true});
  assert.equal(result.verified, true, JSON.stringify(result).slice(0, 300)); assert.equal(await text('memo'), '새 메모만');
  pass('replace_existing erases only after the user answered a question');

  r = await refs();
  result = await run('run_playwright', {code: `await browser.ref(${JSON.stringify(r.body)}).fill('덮어쓰기');`});
  assert.equal(result.error, 'fill_would_erase', JSON.stringify(result).slice(0, 300));
  assert((await text('body')).includes('----- Original Message -----'));
  pass('a script fill that would erase the body is refused too');

  r = await refs();
  result = await run('fill_form', {fields: [{field_id: r.draft, value: '첫 초안입니다.'}]});
  assert.equal(result.verified, true, JSON.stringify(result).slice(0, 300));
  r = await refs();
  result = await run('fill_form', {fields: [{field_id: r.draft, value: '고친 초안입니다.'}]});
  assert.equal(result.verified, true, JSON.stringify(result).slice(0, 300)); assert.equal(await text('draft'), '고친 초안입니다.');
  pass('text this run wrote itself can be replaced');

  // A rich editor in an iframe, as company mail editors often are.
  const frameText = () => tab.frameLocator('#editor').locator('body').evaluate(el => el.innerText);
  const frameRef = async () => (await run('browser_snapshot')).frames.flatMap(f => f.elements || []).find(el => el.name === '편집기 본문')?.ref;
  result = await run('fill_form', {fields: [{field_id: await frameRef(), value: '전달합니다.'}]});
  assert.equal(result.error, 'fill_would_erase', JSON.stringify(result).slice(0, 300));
  result = await run('fill_form', {fields: [{field_id: await frameRef(), value: '전달합니다.\n', position: 'start'}]});
  assert.equal(result.verified, true, JSON.stringify(result).slice(0, 300));
  const framed = await frameText();
  assert(framed.startsWith('전달합니다.') && framed.includes('----- Original Message -----') && framed.includes('홍길동 | 개발팀'), framed);
  pass('in an iframe editor the erase is refused and the message goes above the original');

  const designRef = async () => (await run('browser_snapshot')).frames.flatMap(f => f.elements || []).find(el => el.name === '디자인 본문')?.ref;
  assert(await designRef(), 'a designMode editor body is observed as a field');
  result = await run('fill_form', {fields: [{field_id: await designRef(), value: '회신합니다.\n', position: 'start'}]});
  assert.equal(result.verified, true, JSON.stringify(result).slice(0, 300));
  const designed = await tab.frameLocator('#design').locator('body').evaluate(el => el.innerText);
  assert(designed.startsWith('회신합니다.') && designed.includes('----- Original Message -----'), designed);
  pass('a designMode editor body is observed and written above the original too');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
