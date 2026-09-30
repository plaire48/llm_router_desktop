// Real Chrome: a company-style form (a groupware draft) built without labels or
// dialog roles. Measured with this page: fields were named by their id
// ("subject") instead of their header cell, a class-drawn check box by its id, and
// a layer popup without role="dialog" left its "확인" looking the same as the
// page's "확인" behind the overlay. A date picker's click was reported as having
// no effect. Each is now observed as a person reads the page.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const gif = 'data:image/gif;base64,R0lGODlhEAAQAIAAAAAAAP///yH5BAAAAAAALAAAAAAQABAAAAIOhI+py+0Po5y02ouzPgUAOw==';
const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>기안 작성</title><style>
body{font:13px sans-serif;margin:16px}
.tbl_form th{text-align:left;padding:4px 8px;background:#f3f3f3}
.chk{display:inline-block;width:14px;height:14px;border:1px solid #333;cursor:pointer;vertical-align:middle}
.chk.on{background:#06c}
.custom-check input{position:absolute;opacity:0;width:1px;height:1px}
.custom-check label{cursor:pointer}
.custom-check label::before{content:'';display:inline-block;width:14px;height:14px;border:1px solid #333;margin-right:4px;vertical-align:middle}
.sel{position:relative;display:inline-block;width:120px;border:1px solid #999}
.sel_list{position:absolute;left:0;top:100%;background:#fff;border:1px solid #999;margin:0;padding:0;list-style:none;width:100%;z-index:5}
.btn_type1,.btn_type2,.btn_s{display:inline-block;padding:4px 10px;border:1px solid #666;cursor:pointer;text-decoration:none;color:#000}
.btn_icon{width:24px;height:24px;padding:0}
.ico_help,.ico_refresh{display:inline-block;width:14px;height:14px;background:#555}
.blind{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.dim{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100}
.layer_pop{position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:101;background:#fff;padding:12px;width:380px;border:1px solid #333}
.btn_close{position:absolute;right:8px;top:8px;width:16px;height:16px;background:#333}
</style></head><body>
<h2>기안 작성</h2>
<table class="tbl_form"><tbody>
<tr><th scope="row">제목</th><td><input type="text" id="subject" class="inp"></td></tr>
<tr><th>기안 부서</th><td><input type="text" id="dept" placeholder="부서명 입력"></td></tr>
<tr><th>시행 일자</th><td><input type="text" id="date" readonly class="datepicker"> <img src="${gif}" alt="달력" id="cal" style="cursor:pointer"></td></tr>
<tr><th>긴급</th><td><span class="chk" id="urgent"></span> <span>긴급 문서</span></td></tr>
<tr><th>보안 등급</th><td class="custom-check"><input type="checkbox" id="secure"><label for="secure">대외비</label></td></tr>
<tr><th>보존 기간</th><td><div class="sel" id="keep"><a href="#none" class="sel_txt">선택</a><ul class="sel_list" style="display:none"><li><a href="#none">1년</a></li><li><a href="#none">3년</a></li><li><a href="#none">5년</a></li></ul></div></td></tr>
<tr><th>수신 여부</th><td><label><input type="radio" name="rcv" value="y">수신</label> <label><input type="radio" name="rcv" value="n" checked>미수신</label></td></tr>
</tbody></table>
<div class="btn_area">
<span class="btn_type1" id="approver">결재선 지정</span>
<a href="javascript:;" class="btn_type2" onclick="log.push('임시저장')">임시저장</a>
<a href="#none" class="btn_type2" id="submitDoc"><span>상신</span></a>
<img src="${gif}" alt="인쇄" id="print" style="cursor:pointer">
<button type="button" class="btn_icon" id="helpBtn"><i class="ico_help"></i></button>
<button type="button" class="btn_icon" title="새로고침"><i class="ico_refresh"></i></button>
</div>
<table class="tbl_list"><thead><tr><th><input type="checkbox" id="all" title="전체 선택"></th><th>문서명</th><th>기안자</th><th>관리</th></tr></thead><tbody>
<tr><td><input type="checkbox" name="doc"></td><td><a href="#doc1">2026 예산안</a></td><td>김철수</td><td><span class="btn_s" data-act="del" data-doc="2026 예산안">삭제</span></td></tr>
<tr><td><input type="checkbox" name="doc"></td><td><a href="#doc2">출장 보고서</a></td><td>이영희</td><td><span class="btn_s" data-act="del" data-doc="출장 보고서">삭제</span></td></tr>
</tbody></table>
<button type="button" id="pageOk">확인</button>
<div style="height:1400px"></div><button type="button" id="bottomSave">맨 아래 저장</button>
<div class="dim" id="dim" style="display:none"></div>
<div class="layer_pop" id="layer" style="display:none">
 <div class="pop_head"><strong>결재선 지정</strong><a href="#none" class="btn_close" id="layerClose"><span class="blind">닫기</span></a></div>
 <div class="pop_cont"><input type="text" placeholder="이름 검색" id="q"> <span class="btn_s" id="search">검색</span>
  <ul class="org"><li><input type="checkbox" id="p1"><label for="p1">김철수 팀장</label></li><li><input type="checkbox" id="p2"><label for="p2">이영희 부장</label></li></ul></div>
 <div class="pop_foot"><span class="btn_type1" id="layerOk">확인</span> <span class="btn_type2" id="layerCancel">취소</span></div>
</div>
<dialog id="confirm"><p>상신하시겠습니까?</p><button type="button" id="yes">예</button> <button type="button" id="no">아니오</button></dialog>
<script>
window.log = [];
const $ = id => document.getElementById(id);
$('urgent').addEventListener('click', () => {$('urgent').classList.toggle('on'); log.push('긴급 ' + $('urgent').classList.contains('on'));});
$('cal').addEventListener('click', () => {$('date').value = '2026-10-05'; log.push('달력');});
$('approver').addEventListener('click', () => {$('dim').style.display = 'block'; $('layer').style.display = 'block'; log.push('결재선 열기');});
const close = why => {$('dim').style.display = 'none'; $('layer').style.display = 'none'; log.push(why);};
$('layerOk').addEventListener('click', () => close('결재선 확인 ' + ['p1','p2'].filter(id => $(id).checked).join(',')));
$('layerCancel').addEventListener('click', () => close('결재선 취소'));
$('layerClose').addEventListener('click', e => {e.preventDefault(); close('결재선 닫기');});
$('search').addEventListener('click', () => log.push('검색 ' + $('q').value));
$('pageOk').addEventListener('click', () => log.push('페이지 확인'));
$('submitDoc').addEventListener('click', e => {e.preventDefault(); $('confirm').showModal(); log.push('상신 열기');});
$('yes').addEventListener('click', () => {$('confirm').close(); log.push('상신 예');});
$('no').addEventListener('click', () => {$('confirm').close(); log.push('상신 아니오');});
$('print').addEventListener('click', () => log.push('인쇄'));
$('helpBtn').addEventListener('click', () => log.push('도움말'));
document.querySelector('[title="새로고침"]').addEventListener('click', () => log.push('새로고침'));
const sel = $('keep'), list = sel.querySelector('.sel_list');
sel.querySelector('.sel_txt').addEventListener('click', e => {e.preventDefault(); list.style.display = list.style.display === 'none' ? 'block' : 'none'; log.push('보존 목록');});
for (const a of list.querySelectorAll('a')) a.addEventListener('click', e => {e.preventDefault(); sel.querySelector('.sel_txt').textContent = a.textContent; list.style.display = 'none'; log.push('보존 ' + a.textContent);});
for (const s of document.querySelectorAll('[data-act="del"]')) s.addEventListener('click', () => log.push('삭제 ' + s.dataset.doc));
$('all').addEventListener('change', () => {for (const c of document.querySelectorAll('[name="doc"]')) c.checked = $('all').checked; log.push('전체 ' + $('all').checked);});
</script></body></html>`;

const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-company-widgets-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, viewport: {width: 1100, height: 800},
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const url = `${origin}/draft`, tab = await context.newPage(); await tab.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  const run = (name, args = {}) => worker.evaluate(({tabId, name, args}) => contentTest.runBrowserAgent('widgets', {tabId}, name, args).then(v => v.result), {tabId, name, args});
  const log = () => tab.evaluate(() => window.log.splice(0));
  const elements = snap => (snap.observation || snap).frames.flatMap(f => f.elements || []);
  let snap = await run('browser_snapshot');
  const named = name => elements(snap).find(el => el.name === name);
  const byId = id => elements(snap).find(el => el.id === id);

  assert.equal(byId('subject').name, '제목'); assert.equal(byId('dept').name, '기안 부서');
  assert.equal(byId('date').name, '시행 일자'); assert.equal(byId('date').readonly, true);
  assert.equal(byId('urgent').name, '긴급 문서');
  assert.equal(named('대외비').role, 'checkbox'); assert.equal(named('대외비').checked, false);
  assert.equal(named('선택').destination, undefined, 'a "#none" link opens nothing, so it has no destination');
  assert.equal(byId('bottomSave').inViewport, false); assert.equal(byId('bottomSave').coveredBy, undefined);
  pass('fields are named by their header cell, a class-drawn box by its words, and a "#none" link has no destination');

  let r = await run('fill_form', {fields: [{field_id: byId('subject').ref, value: '10월 교육 예산'}]});
  assert.equal(r.verified, true, JSON.stringify(r).slice(0, 300)); assert.equal(await tab.inputValue('#subject'), '10월 교육 예산');
  snap = await run('browser_snapshot');
  r = await run('fill_form', {fields: [{field_id: named('대외비').ref, value: 'true'}]});
  assert.equal(await tab.isChecked('#secure'), true, JSON.stringify(r).slice(0, 300));
  snap = await run('browser_snapshot');
  r = await run('click_element', {ref: byId('urgent').ref});
  assert.deepEqual(await log(), ['긴급 true'], JSON.stringify(r).slice(0, 300));
  snap = await run('browser_snapshot');
  assert.equal(byId('urgent').stateHint, 'on');
  pass('a field named by its header is filled, a hidden checkbox is checked through its label, a class-drawn box toggles and shows its state');

  r = await run('click_element', {ref: named('달력').ref});
  assert.deepEqual(await log(), ['달력']);
  assert.equal(r.effect?.none, undefined, JSON.stringify(r.effect));
  assert.deepEqual(r.effect.fieldsChanged.first.map(field => field.name), ['시행 일자']);
  pass('a date picker click reports its field changed, without the value');

  snap = await run('browser_snapshot');
  r = await run('click_element', {ref: named('결재선 지정').ref});
  assert.deepEqual(await log(), ['결재선 열기']);
  assert.deepEqual(r.effect.dialogsOpened, ['dialog "결재선 지정"'], JSON.stringify(r.effect));
  snap = await run('browser_snapshot');
  const [pageOk, layerOk] = ['pageOk', 'layerOk'].map(byId);
  assert.deepEqual(layerOk.context, [{role: 'dialog', name: '결재선 지정'}]);
  assert.equal(pageOk.coveredBy, 'dialog "결재선 지정"');
  assert.equal(named('김철수 팀장').context.at(-1).name, '결재선 지정');
  assert.equal(byId('bottomSave').coveredBy, 'dialog "결재선 지정"', 'the overlay covers the window, so a control scrolled out of it too');
  pass('a layer popup without a dialog role is observed as a dialog, and the page controls behind its overlay as covered, in view or not');

  r = await run('click_element', {ref: pageOk.ref});
  assert.equal(r.error, 'script_obscured'); assert.deepEqual(await log(), []);
  snap = await run('browser_snapshot');
  r = await run('fill_form', {fields: [{field_id: named('김철수 팀장').ref, value: 'true'}]});
  assert.equal(r.verified, true, JSON.stringify(r).slice(0, 300));
  snap = await run('browser_snapshot');
  r = await run('click_element', {ref: byId('layerOk').ref});
  assert.deepEqual(await log(), ['결재선 확인 p1']);
  assert.deepEqual(r.effect.dialogsClosed, ['dialog "결재선 지정"'], JSON.stringify(r.effect));
  pass('the covered page button is not pressed; the layer check box and its 확인 are');

  await tab.evaluate(() => document.getElementById('confirm').showModal());
  snap = await run('browser_snapshot');
  assert.deepEqual(named('예').context, [{role: 'dialog', name: '상신하시겠습니까?'}]);
  assert.equal(byId('pageOk').coveredBy, 'dialog "상신하시겠습니까?"');
  assert.equal(byId('bottomSave').coveredBy, 'dialog "상신하시겠습니까?"', 'a modal dialog makes the rest of the document inert');
  r = await run('click_element', {ref: named('예').ref});
  assert.deepEqual(await log(), ['상신 예']);
  assert.deepEqual(r.effect.dialogsClosed, ['dialog "상신하시겠습니까?"'], JSON.stringify(r.effect));
  pass('a native modal dialog is named by its words, and the page behind it is covered');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
