// Real Chrome: captures at a Chrome page zoom other than 100%. Reported from a
// company PC: "캡처 범위 확인" on every capture. Measured: Playwright's screenshot
// assumes no zoom, so at 125% the image was 80% of the page and a clip landed 20%
// off. Every capture must cover what the page measures, in CSS pixels, with
// secret fields masked, and a click at image coordinates must hit that point.
// Also at a 125% display scale, as Windows sets it on many company laptops
// (--force-device-scale-factor, not Playwright's emulated scale, which the
// extension's debugger capture does not see): the image came 1.25 times too large.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const page = `<!doctype html><html lang="ko"><title>메일 쓰기</title><body style="margin:0;font:14px sans-serif;background:#fff">
<div id="red" style="position:absolute;left:100px;top:120px;width:200px;height:100px;background:#e00"></div>
<button id="a" type="button" style="position:absolute;left:400px;top:120px;width:120px;height:40px">받는 사람 A</button>
<button id="b" type="button" style="position:absolute;left:560px;top:120px;width:120px;height:40px">받는 사람 B</button>
<input id="pw" type="password" aria-label="비밀번호" value="SECRET_VALUE" style="position:absolute;left:100px;top:260px;width:200px;height:40px;font-size:24px;color:#e00;background:#e00;border:0">
<div style="position:absolute;left:0;top:2400px;width:10px;height:10px"></div>
<script>window.clicks={a:0,b:0};for(const id of ['a','b'])document.getElementById(id).addEventListener('click',()=>clicks[id]++);</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
let context, profile, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  for (const scale of [1, 1.25]) {
  profile = await mkdtemp(resolve(tmpdir(), 'nubi-capture-zoom-')); const extension = resolve(profile, 'extension');
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, viewport: {width: 1000, height: 700},
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`, ...(scale === 1 ? [] : [`--force-device-scale-factor=${scale}`])]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  for (const zoom of [1, 1.25, 0.9]) {
    const url = `${origin}/zoom-${zoom}`, tab = await context.newPage(); await tab.goto(url);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
    await worker.evaluate(({tabId, zoom}) => chrome.tabs.setZoom(tabId, zoom), {tabId, zoom}); await tab.waitForTimeout(300);
    const id = `zoom-${scale}-${zoom}`, at = `display ${scale}, zoom ${zoom}`;
    // Runs a tool with vision; counts red pixels and the mask colour in the returned image.
    const run = (name, args = {}) => worker.evaluate(async ({id, tabId, name, args}) => {
      let image;
      const {result} = await contentTest.runBrowserAgent(id, {tabId}, name, args, {vision: true, onCapture: async (_, value) => {image = value; return {availableInChat: true};}});
      if (!image) return {result};
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(image.data), c => c.charCodeAt(0))], {type: image.mimeType}));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), draw = canvas.getContext('2d'); draw.drawImage(bitmap, 0, 0);
      const pixels = draw.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let red = 0, mask = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 200 && pixels[i + 1] < 60 && pixels[i + 2] < 60) red++;
        if (Math.abs(pixels[i] - 0xE5) < 6 && Math.abs(pixels[i + 1] - 0xE8) < 6 && Math.abs(pixels[i + 2] - 0xEB) < 6) mask++;
      }
      return {result, width: bitmap.width, height: bitmap.height, red, mask};
    }, {id, tabId, name, args});
    const inner = await tab.evaluate(() => ({width: innerWidth, height: innerHeight, document: document.documentElement.scrollHeight}));
    const close = (actual, expected, label) => assert(Math.abs(actual - expected) <= Math.max(3, expected * 0.02), `${label} at ${at}: ${actual} vs ${expected}`);

    const view = await run('capture_page', {full_page: false});
    assert.equal(view.result.error, undefined, `${at}: ${JSON.stringify(view.result).slice(0, 300)}`);
    // The debugger's infobar takes some height once attached: compare with what the page measures now.
    Object.assign(inner, await tab.evaluate(() => ({width: innerWidth, height: innerHeight})));
    assert.deepEqual([view.result.viewport.width, view.result.viewport.height], [inner.width, inner.height]);
    close(view.width, inner.width, 'viewport width'); close(view.height, inner.height, 'viewport height');
    close(view.red, 200 * 100, 'the red box in the viewport image');
    assert(view.mask >= 200 * 40 * 0.9, `${at}: the password field is masked (${view.mask} mask pixels)`);
    pass(`${at}: a viewport capture is the page's CSS size, shows the box at its size and masks the secret field`);

    const whole = await run('capture_page', {full_page: true});
    assert.equal(whole.result.error, undefined, `${at}: ${JSON.stringify(whole.result).slice(0, 300)}`);
    close(whole.height, inner.document, 'full page height'); close(whole.red, 200 * 100, 'the red box in the page image');
    pass(`${at}: a full-page capture covers the whole document at CSS size`);

    const region = await run('capture_page', {full_page: false, region: {x: 100, y: 120, width: 200, height: 100}});
    assert.equal(region.result.error, undefined, JSON.stringify(region.result).slice(0, 300));
    assert(region.red >= 200 * 100 * 0.97, `${at}: the region is the red box (${region.red} of ${region.width * region.height})`);
    pass(`${at}: a region capture lands on the requested rectangle`);

    const snapshot = await run('browser_snapshot');
    const b = (snapshot.result.observation || snapshot.result).frames.flatMap(f => f.elements || []).find(el => el.name === '받는 사람 B');
    const element = await run('capture_page', {ref: b.ref});
    assert.equal(element.result.error, undefined, JSON.stringify(element.result).slice(0, 300));
    assert.equal(element.result.capture_mode, 'element');
    pass(`${at}: an element capture works`);

    const shot = await run('capture_page', {full_page: false});
    const target = await tab.evaluate(() => {const r = document.getElementById('b').getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};});
    const clicked = await run('click_at', {screenshot_id: shot.result.screenshot_id, x: target.x, y: target.y});
    assert.equal(clicked.result.error, undefined, JSON.stringify(clicked.result).slice(0, 300));
    assert.deepEqual(await tab.evaluate(() => clicks), {a: 0, b: 1}, `${at}: the click at image coordinates hit B only`);
    const again = await run('browser_snapshot');
    const a = (again.result.observation || again.result).frames.flatMap(f => f.elements || []).find(el => el.name === '받는 사람 A');
    await run('click_element', {ref: a.ref});
    assert.deepEqual(await tab.evaluate(() => clicks), {a: 1, b: 1}, `${at}: a click on an observed element hits it`);
    pass(`${at}: clicks at image coordinates and on observed elements hit the right button`);
    await worker.evaluate(id => contentTest.stopBrowserAgent(id), id).catch(() => {}); await tab.close();
  }
  await context.close(); context = null; await rm(profile, {recursive: true, force: true}); profile = null;
  }
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); if (profile) await rm(profile, {recursive: true, force: true});
}
