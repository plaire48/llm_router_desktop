import { readFile, mkdir, writeFile, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve, win32 } from 'node:path';
import { release } from 'node:os';
import { openNative } from './native.mjs';
import { paneRect, selectProof, sameRect, errorPx, Measurement, summarize } from './core.mjs';
import { createProof } from './proof.mjs';

const [command, ...args] = process.argv.slice(2);
if (!['list', 'geometry', 'follow'].includes(command)) {
  console.log('Windows x64 experiment only\nnode run.mjs list <exact-exe-path>\nnode run.mjs geometry local-config.json\nnode run.mjs follow local-config.json koffi|nwm\nCtrl+C: stop and restore browser bounds');
} else {
  let native;
  try {
    if (command === 'follow' && !['koffi', 'nwm'].includes(args[1])) throw Error('backend_required');
    native = openNative();
    if (command === 'list') {
      if (!args[0]) throw Error('exact_executable_required');
      const matches = native.list().filter(w => w.path.toLowerCase() === args[0].toLowerCase());
      console.log(JSON.stringify(matches.map(({ id, processId, bounds }) => ({ id, processId, bounds })), null, 2));
    } else if (command === 'geometry') {
      const config = JSON.parse(await readFile(args[0], 'utf8'));
      const host = native.bind(config.host.id, config.host.processId, config.host.path);
      const client = native.client(host), dpi = native.state(host).dpi;
      console.log(JSON.stringify({ client, dpi, pane: paneRect(client, config.paneInsetsDIP, dpi) }, null, 2));
    } else await follow(native, args[0], args[1]);
  } catch (e) {
    console.error(e.message); process.exitCode = 1;
  } finally { native?.close(); }
}

async function follow(native, configPath, backend) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!config.host || !Number.isSafeInteger(config.host.id) || config.host.id <= 0 ||
      !Number.isSafeInteger(config.host.processId) || config.host.processId <= 0 ||
      !win32.isAbsolute(config.host.path || '') || !win32.isAbsolute(config.browserExecutable || '')) {
    throw Error('explicit_host_and_browser_required');
  }
  const host = native.bind(config.host.id, config.host.processId, config.host.path);
  const hostState = native.state(host);
  if (hostState.minimized || !hostState.visible) throw Error('host_not_visible');
  paneRect(native.client(host), config.paneInsetsDIP, hostState.dpi);
  const output = resolve('results', `${new Date().toISOString().replaceAll(':', '-')}-${backend}`);
  await mkdir(output, { recursive: true });
  const log = await open(resolve(output, 'samples.jsonl'), 'wx');
  let stopped = false, browser, original, previous, meter, restored = false, stackRestored = false, failure;
  const samples = [], stop = () => { stopped = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const nonce = randomUUID();
    console.log('누비 브라우저 연결 팝업(connect.html)의 검사 콘솔에서 아래 코드를 실행하세요. 서비스 워커/웹페이지 콘솔은 아닙니다. 90초 안에 소유 창을 확인합니다.');
    console.log(`await (${createProof.toString()})(chrome, location.href, '${nonce}')`);
    const deadline = performance.now() + 90000;
    while (!browser && !stopped && performance.now() < deadline) {
      // Titles exist only in this local matching operation; never persisted.
      browser = selectProof(native.list(true), nonce, config.browserExecutable);
      if (!browser) await sleep(100);
    }
    if (stopped) throw Error('cancelled');
    if (!browser) throw Error('proof_timeout');
    browser = native.bind(browser.id, browser.processId, browser.path);
    if (browser.id === host.id) throw Error('same_window_rejected');
    if (native.state(browser).maximized || native.state(browser).minimized) throw Error('browser_restore_to_normal_first');
    original = native.rect(browser); previous = native.previous(browser);
    // A local recovery record, never an upload artifact. No page URL, title,
    // profile, pairing code, proof nonce, cookies or content is saved.
    await writeFile(resolve(output, 'recovery.local.json'),
      JSON.stringify({ browser, original, previous, note: 'Manual recovery reference only; do not reuse stale HWNDs.' }, null, 2));
    console.log('소유 창 확인. 증명 탭 자동 종료를 기다립니다. 다른 도킹 기능을 동시에 실행하지 마세요.');
    for (let i = 0; i < 120 && !stopped; i++) await sleep(100);
    if (stopped) throw Error('cancelled');
    meter = new Measurement(native.client(host));
    let lastStack, lastLog = 0;
    const endAt = performance.now() + 20 * 60 * 1000;
    console.log('시작: 누비 창 이동 50회, 크기 변경 50회. 각 동작 뒤 0.5초 이상 멈추세요. Ctrl+C로 종료합니다.');
    while (!stopped && meter.events.length < 100 && performance.now() < endAt) {
      const tick = performance.now();
      native.check(browser);
      const state = native.state(host), browserState = native.state(browser);
      if (browserState.minimized || browserState.maximized) throw Error('browser_window_state_changed');
      const active = state.visible && !state.minimized &&
        [host.id, browser.id].includes(state.foreground);
      const stackKey = `${active}:${state.foreground}:${state.minimized}`;
      if (lastStack !== stackKey) { native.stack(browser, host, active); lastStack = stackKey; }
      if (!state.visible || state.minimized) {
        const sample = { at: tick - started, paused: true, reason: 'host_hidden_or_minimized' };
        samples.push(sample); await log.write(JSON.stringify(sample) + '\n'); await sleep(32); continue;
      }
      const client = native.client(host);
      const expected = paneRect(client, config.paneInsetsDIP, state.dpi);
      const before = native.rect(browser);
      let callMs = 0;
      if (!sameRect(before, expected)) {
        const beginCall = performance.now(); native.move(browser, expected, backend);
        callMs = performance.now() - beginCall;
      }
      const actual = native.rect(browser), afterHost = native.client(host);
      const raced = !sameRect(client, afterHost);
      const sample = { at: tick - started, host: client, expected, actual, before,
        dpi: state.dpi, callMs, pollMs: performance.now() - tick,
        hostChangedDuringCall: raced, errorPx: errorPx(expected, actual) };
      samples.push(sample); await log.write(JSON.stringify(sample) + '\n');
      // Moving host samples are retained in raw output and error totals.
      // They cannot form a settled event, but never disappear from the denominator.
      if (!raced) meter.observe(sample);
      if (meter.events.length !== lastLog) {
        lastLog = meter.events.length;
        const e = meter.events.at(-1);
        console.log(`${lastLog}/100 ${e.kind} 어긋남 ${e.errorPx}px`);
      }
      await sleep(Math.max(1, 32 - (performance.now() - tick)));
    }
    if (stopped) failure = 'cancelled';
    else if (meter.events.length < 100) failure = 'time_limit';
  } catch (e) { failure = e.message; }
  finally {
    if (browser && original) {
      try {
        native.move(browser, original, 'koffi');
        restored = sameRect(native.rect(browser), original);
        stackRestored = native.restoreStack(browser, previous);
      } catch (e) { failure = failure || e.message; }
    }
    await log.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    const summary = summarize(meter?.events || [], samples, restored && stackRestored);
    if (failure) summary.verdict = restored && stackRestored && ['cancelled', 'time_limit'].includes(failure)
      ? 'incomplete' : 'fail';
    const report = { schema: 1, startedAt, finishedAt: new Date().toISOString(), backend,
      os: `Windows ${release()}`, arch: process.arch, node: process.version,
      dependencies: { 'node-window-manager': '2.2.4', koffi: '3.3.3' },
      browserExecutable: win32.basename(config.browserExecutable),
      hostExecutable: win32.basename(config.host.path), paneInsetsDIP: config.paneInsetsDIP,
      coordinateContract: 'physical GetWindowRect including invisible borders; insets relative to host client',
      mode: 'manual_50_moves_50_resizes', pollTargetMs: 32, settleMs: 180,
      sampleCount: samples.length, hostChangedDuringCall: samples.filter(s => s.hostChangedDuringCall).length,
      ...summary, boundsRestored: restored, stackRestored, failure: failure || null, events: meter?.events || [] };
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, verdict: report.verdict, moves: report.moves, resizes: report.resizes,
      settledMisalignments: report.settledMisalignments, sampleMisalignments: report.sampleMisalignments,
      boundsRestored: restored, stackRestored, failure: report.failure }, null, 2));
    if (report.verdict !== 'pass') process.exitCode = 1;
  }
}
