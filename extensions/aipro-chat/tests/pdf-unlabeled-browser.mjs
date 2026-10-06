// Real Chrome: a PDF served without a Content-Type (as a public library's guide
// is) is read like any other PDF. Measured (H-04): Chrome sniffed and showed the
// document, but the extension refused it as pdf_mime_invalid. The file's own
// header decides; an HTML page behind a .pdf address is still refused.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pdfFile} from './fixtures/documents.mjs';

const pdf = pdfFile().buffer;
const server = createServer((req, res) => {
  if (req.url === '/unlabeled.pdf') {res.writeHead(200, {'content-length': pdf.length, 'cache-control': 'no-store'}); return res.end(pdf);}
  if (req.url === '/labeled.pdf') {res.writeHead(200, {'content-type': 'application/pdf', 'content-length': pdf.length}); return res.end(pdf);}
  res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end('<!doctype html><title>안내</title><p>PDF 안내 페이지</p>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-pdf-unlabeled-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.pdfTest={runBrowserAgent,stopBrowserAgent,ready:()=>serial(()=>{})};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); await worker.evaluate(() => pdfTest.ready());
  const read = async path => {
    const page = await context.newPage(); await page.goto(origin + path, {waitUntil: 'load'}).catch(() => {});
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, origin + path);
    assert(tabId, `tab for ${path}`);
    const result = (await worker.evaluate(({tabId, path}) => pdfTest.runBrowserAgent('pdf-' + path, {tabId}, 'read_page', {mode: 'content'}), {tabId, path})).result;
    await page.close(); return result;
  };
  const labeled = await read('/labeled.pdf');
  assert.equal(labeled.ok, true, JSON.stringify(labeled).slice(0, 300)); assert.equal(labeled.method, 'pdfjs_text');
  const unlabeled = await read('/unlabeled.pdf');
  assert.equal(unlabeled.ok, true, JSON.stringify(unlabeled).slice(0, 300)); assert.equal(unlabeled.method, 'pdfjs_text');
  assert.equal(unlabeled.characters, labeled.characters, 'the same text as the labeled copy');
  pass('a PDF served without a Content-Type is read as text, like one labeled application/pdf');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
