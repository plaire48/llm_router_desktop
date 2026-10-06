import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtemp, mkdir, writeFile, rm, realpath, cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {inspectEvaluationBuild, prepareEvaluationBuild} from '../scripts/evaluation-build.mjs';

const profile = await realpath(await mkdtemp(resolve(tmpdir(), 'nubi-build-proof-')));
let extension = resolve(profile, 'extension-v1');
const required = ['background.js', 'task-plan.js'];
let child, browser;
// A signal-exited child has exitCode=null too. Never wait for an exit event
// that already happened, or let CDP disconnect hide the original test failure.
const within = async (promise, ms) => {
  let timer;
  try {return await Promise.race([promise.then(()=>true), new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}
  finally {clearTimeout(timer);}
};
const stop = async () => {
  const closing=browser?.close().catch(() => {}); browser=null;
  if(closing)await within(closing,5000);
  if(child && child.exitCode===null && child.signalCode===null) {
    const ended=once(child,'exit'); child.kill('SIGTERM');
    if(!await within(ended,5000)){child.kill('SIGKILL');if(!await within(ended,5000))throw Error('evaluation_chrome_cleanup_pending');}
  }
};
const start = async () => {
  const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port; await new Promise(done => server.close(done));
  child = spawn(process.env.CHROME_BINARY || chromium.executablePath(), [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--load-extension=${extension}`,
    `--disable-extensions-except=${extension}`, '--headless=new', '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  for (let i = 0; i < 80 && !browser; i++) {
    try {browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {timeout: 500});}
    catch {await new Promise(done => setTimeout(done, 100));}
  }
  assert(browser);
  const context = browser.contexts()[0];
  let worker;
  for (let i = 0; i < 100 && !worker; i++) {
    for (const candidate of context.serviceWorkers()) {
      if (candidate.url().endsWith('/background.js') &&
          await candidate.evaluate(() => chrome.runtime.getManifest().name).catch(() => '') === 'Nubi evaluation build regression') {
        worker = candidate; break;
      }
    }
    if (!worker) await new Promise(done => setTimeout(done, 100));
  }
  assert(worker); return {context, worker};
};
try {
  await mkdir(extension);
  await writeFile(resolve(extension, 'index.html'), '<!doctype html><title>Evaluation build regression</title>');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'Nubi evaluation build regression', version: '1.0.0', background: {service_worker: 'background.js', type: 'module'}}));
  await writeFile(resolve(extension, 'background.js'), "import {revision} from './task-plan.js'; globalThis.buildRevision = revision; chrome.runtime.onMessage.addListener((_message, _sender, respond) => respond({revision}));");
  await writeFile(resolve(extension, 'task-plan.js'), 'export const revision = 1;');
  console.log('START initial Chrome');
  let session = await start();
  const first = await inspectEvaluationBuild(browser, session.worker, extension, required);
  assert.equal(first.verified, true, JSON.stringify(first));console.log('PASS initial executed hashes');
  await stop();
  await writeFile(resolve(extension, 'task-plan.js'), 'export const revision = 2;');
  console.log('START upgraded Chrome');
  session = await start();
  const before = await inspectEvaluationBuild(browser, session.worker, extension, required);
  if (!before.verified) await assert.rejects(() => prepareEvaluationBuild(browser, session.context, session.worker, extension, required), /evaluation_build_mismatch/);
  await stop();
  const previous = extension; extension = resolve(profile, 'extension-v2');
  await cp(previous, extension, {recursive: true});
  session = await start();
  const prepared = await prepareEvaluationBuild(browser, session.context, session.worker, extension, required);
  assert.equal(prepared.verification.verified, true);
  assert.equal(await prepared.worker.evaluate(() => globalThis.buildRevision), 2);
  // A missing requested module must never silently certify the candidate.
  await writeFile(resolve(extension, 'missing.js'), 'export const missing = true;');
  assert.equal((await inspectEvaluationBuild(browser, prepared.worker, extension, ['missing.js'])).verified, false);
  const report = {passed: true, before, verification: prepared.verification, executedRevision: 2, missingModuleRejected: true};
  await mkdir('verification/browser-30', {recursive: true});
  await writeFile('verification/browser-30/evaluation-build-browser.json', JSON.stringify(report, null, 2));
  console.log('PASS evaluation build: executed module hashes, reused profile upgrade, isolated candidate path, missing-module rejection');
} finally {await stop(); await rm(profile, {recursive: true, force: true});}
