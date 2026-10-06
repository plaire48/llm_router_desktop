// Real Chrome: a page that stops answering does not hold an observation forever.
// Measured (H-04, Sol): after a PDF link and a timed out go_back, one
// browser_snapshot waited five minutes until the task limit. The page here runs
// a busy loop after loading, so no script in it ever returns.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(req.url.startsWith('/busy') ? '<!doctype html><title>응답 없음</title><p>곧 멈춥니다</p><script>setTimeout(() => {for (;;) {}}, 1500)</script>' : '<!doctype html><title>정상</title><button>확인</button>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-observe-deadline-')), extension = resolve(profile, 'extension');
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
  const tab = await context.newPage(); await tab.goto(origin + '/fine');
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, origin + '/fine');
  const run = (name, args = {}) => worker.evaluate(({tabId, name, args}) => contentTest.runBrowserAgent('deadline', {tabId}, name, args).then(v => v.result), {tabId, name, args});
  // Attach and observe while the page still answers, then let it stop answering.
  let result = await run('browser_snapshot'); assert.equal(result.error, undefined, JSON.stringify(result).slice(0, 300));
  await run('navigate_page', {url: origin + '/busy'}).catch(() => null);
  await new Promise(resolve => setTimeout(resolve, 2500));
  const started = Date.now();
  result = await run('browser_snapshot');
  const seconds = (Date.now() - started) / 1000;
  assert(seconds < 60, `the observation returned after ${seconds}s`);
  const main = result.frames?.find(frame => frame.frame === 0);
  assert(result.error === 'observe_timeout' || main?.unavailable === true, JSON.stringify(result).slice(0, 400));
  if (result.error) assert.match(result.instruction, /did not answer/);
  pass(`an observation of a page that stopped answering returns in ${Math.round(seconds)}s instead of waiting for the task limit`);
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
