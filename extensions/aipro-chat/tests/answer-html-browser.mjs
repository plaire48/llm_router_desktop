// Real Chrome, the chat page: an answer a model writes in HTML is shown with its
// format. It used to be skipped: a table written in HTML vanished from the answer.
// Only safe elements pass; a script, an event handler, a style or a javascript:
// link never reaches this page, which holds extension privileges.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const answer = ['세 기관을 비교했습니다.', '',
  '<table><thead><tr><th>기관</th><th>토요일</th></tr></thead><tbody><tr><td>서울도서관</td><td style="color:red" onclick="window.pwned=1">09:00-18:00</td></tr><tr><td colspan="2">국립중앙도서관은 <b>확인 필요</b></td></tr></tbody></table>',
  '', '첫 줄<br>둘째 줄', '', '<details><summary>근거</summary><p>공식 안내 <a href="https://example.test/guide">이용 안내</a>, <a href="javascript:window.pwned=2">위험 링크</a></p></details>',
  '', '<script>window.pwned=3</script><img src="https://example.test/x.png" alt="안내 이미지" onerror="window.pwned=4"><iframe src="https://example.test"></iframe>',
  '', '**마크다운 굵게**와 `코드`도 그대로입니다.'].join('\n');
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-answer-html-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push('http://*/*', 'https://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  await context.route('https://aipro.sdsdev.co.kr/api/models', r => r.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', display_name: 'GLM-5.2-512K'}]}}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', r => {
    if (r.request().postDataJSON().messages[0]?.content?.startsWith("You are Nubi's completion-intent reviewer.")) return r.fulfill({json: {choices: [{message: {content: JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''})}, finish_reason: 'stop'}]}});
    return r.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices: [{delta: {content: answer}, finish_reason: 'stop'}]})}\n\ndata: [DONE]\n\n`});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); await ui.setViewportSize({width: 420, height: 900});
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button', {name: 'AI Pro', exact: true}).waitFor();
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic-layout-token', receivedAt: 93}}));
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('도서관 비교해줘');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  const body = ui.locator('.message-assistant .message-body').last();
  await body.locator('table').waitFor();
  await ui.waitForTimeout(300);

  const table = await body.locator('.aipro-table table').evaluate(el => ({heads: [...el.querySelectorAll('th')].map(th => th.textContent), cells: [...el.querySelectorAll('td')].map(td => td.textContent),
    span: el.querySelector('td[colspan]')?.getAttribute('colspan'), bold: el.querySelector('td b, td strong')?.textContent}));
  assert.deepEqual(table, {heads: ['기관', '토요일'], cells: ['서울도서관', '09:00-18:00', '국립중앙도서관은 확인 필요'], span: '2', bold: '확인 필요'});
  pass('an HTML table is shown as a table, with its merged cell and bold text');

  assert.equal(await body.locator('br').count() >= 1, true);
  assert.equal(await body.locator('details summary').textContent(), '근거');
  assert.equal(await body.locator('a[href="https://example.test/guide"]').getAttribute('target'), '_blank');
  assert.equal(await body.locator('strong', {hasText: '마크다운 굵게'}).count(), 1); assert.equal(await body.locator('code', {hasText: '코드'}).count(), 1);
  pass('line breaks, a folded section, a safe link and markdown keep their format');

  const unsafe = await body.evaluate(el => ({scripts: el.querySelectorAll('script,iframe,object,embed,style').length, handlers: [...el.querySelectorAll('*')].filter(node => [...node.attributes].some(a => /^on/i.test(a.name))).length,
    styles: el.querySelectorAll('[style]').length, jsLinks: el.querySelectorAll('a[href^="javascript"]').length, images: el.querySelectorAll('img').length, text: el.textContent}));
  assert.deepEqual({...unsafe, text: undefined}, {scripts: 0, handlers: 0, styles: 0, jsLinks: 0, images: 0, text: undefined}, JSON.stringify(unsafe));
  assert.match(unsafe.text, /위험 링크/); assert.match(unsafe.text, /안내 이미지/);
  assert.equal(await ui.evaluate(() => window.pwned), undefined, 'nothing from the answer ran');
  pass('scripts, frames, event handlers, styles and javascript: links are removed; an image shows its alt text');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); await rm(profile, {recursive: true, force: true});
}
