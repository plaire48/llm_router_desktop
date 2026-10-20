import test from 'node:test';
import assert from 'node:assert/strict';
import { paneRect, selectProof, assertBinding, nwmBounds, Measurement, summarize } from './core.mjs';
import { createProof } from './proof.mjs';

const nonce = '9bb1c02d-601c-4e79-8709-1a1bff3b6990';
const rect = { x: 10, y: 20, width: 800, height: 600 };
const candidate = { id: 55, processId: 42, path: 'C:\\Browser\\browser.exe',
  title: `Nubi window ${nonce} - Browser`, visible: true };

test('pane uses client screen origin and scales all four insets', () => {
  assert.deepEqual(paneRect(rect, [20, 30, 40, 50], 144),
    { x: 85, y: 50, width: 680, height: 510 });
});
test('negative screen origins remain valid and collapsed panes fail closed', () => {
  assert.equal(paneRect({ ...rect, x: -1200 }, [0, 0, 0, 0], 96).x, -1200);
  assert.throws(() => paneRect(rect, [400, 0, 400, 0], 96), /pane_too_small/);
  assert.throws(() => paneRect(rect, [NaN, 0, 0, 0], 96), /invalid_geometry/);
});
test('proof requires fresh nonce title and exact executable, never first candidate', () => {
  assert.equal(selectProof([candidate], nonce, 'c:\\browser\\browser.exe').id, 55);
  assert.equal(selectProof([{ ...candidate, path: 'C:\\other.exe' }], nonce, candidate.path), null);
  assert.equal(selectProof([{ ...candidate, title: 'unrelated' }], nonce, candidate.path), null);
  assert.throws(() => selectProof([candidate, { ...candidate, id: 56 }], nonce, candidate.path), /proof_ambiguous/);
  assert.throws(() => selectProof([candidate], '.*', candidate.path), /invalid_nonce/);
});
test('window identity change stops before native movement', () => {
  assertBinding(candidate, candidate);
  for (const changed of [{ id: 56 }, { processId: 43 }, { path: 'C:\\other.exe' }]) {
    assert.throws(() => assertBinding({ ...candidate, ...changed }, candidate), /binding_changed/);
  }
  assert.throws(() => assertBinding(null, candidate), /binding_changed/);
});
test('node-window-manager physical bounds are converted using its current monitor scale', () => {
  const result = nwmBounds({ x: -1333, y: 17, width: 999, height: 777 }, 1.5);
  for (const key of Object.keys(result)) {
    assert.equal(Math.floor(result[key] * 1.5), { x: -1333, y: 17, width: 999, height: 777 }[key]);
  }
  assert.throws(() => nwmBounds(rect, 0), /invalid_scale/);
});
test('initial placement and repeated polling never inflate the 100 user events', () => {
  const m = new Measurement(rect);
  for (let at = 0; at < 1000; at += 32) m.observe({ at, host: rect, expected: rect, actual: rect });
  assert.equal(m.events.length, 0);
});
test('a drag counts once after settling and records measured error without tolerance', () => {
  const m = new Measurement(rect);
  for (let i = 1; i <= 10; i++) {
    const moved = { ...rect, x: 10 + i };
    m.observe({ at: i * 32, host: moved, expected: moved, actual: moved });
  }
  const moved = { ...rect, x: 20 };
  m.observe({ at: 600, host: moved, expected: moved, actual: { ...moved, x: 21 } });
  assert.equal(m.events.length, 1);
  assert.equal(m.events[0].kind, 'move');
  assert.equal(m.events[0].errorPx, 1);
});
test('resizes are distinct from moves and count only stable observations', () => {
  const m = new Measurement(rect);
  const resized = { ...rect, width: 810 };
  m.observe({ at: 1, host: resized, expected: resized, actual: resized });
  m.observe({ at: 250, host: resized, expected: resized, actual: resized });
  assert.equal(m.events[0].kind, 'resize');
});
test('insufficient runs and failed restores cannot pass', () => {
  assert.equal(summarize([], [], true).verdict, 'incomplete');
  const events = Array.from({ length: 100 }, (_, i) => ({ kind: i < 50 ? 'move' : 'resize', errorPx: 0 }));
  const samples = Array.from({ length: 100 }, () => ({ errorPx: 0, callMs: 1 }));
  assert.equal(summarize(events, samples, true).verdict, 'pass');
  assert.equal(summarize(events, [], true).verdict, 'incomplete');
  assert.equal(summarize(events, [], false).verdict, 'fail');
  assert.equal(summarize(events.map(e => ({ ...e, kind: 'move' })), [], true).verdict, 'incomplete');
});
test('transient measured errors remain visible even when settled geometry recovers', () => {
  const events = Array.from({ length: 100 }, (_, i) => ({ kind: i < 50 ? 'move' : 'resize', errorPx: 0 }));
  const result = summarize(events, [{ errorPx: 2, callMs: 4 }, { errorPx: 0, callMs: 1 }], true);
  assert.equal(result.verdict, 'fail');
  assert.equal(result.sampleMisalignments, 1);
  assert.equal(result.maxErrorPx, 2);
});

test('proof creates only the existing extension page in its connected window', async () => {
  let created;
  const prefix = 'chrome-extension://' + 'a'.repeat(32) + '/';
  const chrome = { runtime: {
    getURL: file => prefix + file,
    sendMessage: async () => ({ connected: true, sourceTab: 8 })
  }, tabs: {
    get: async () => ({ id: 8, windowId: 99, incognito: false }),
    query: async args => { assert.deepEqual(args, { active: true, windowId: 99 }); return [{ id: 9, index: 2 }]; },
    create: async args => { created = args; return { id: 10 }; }
  } };
  assert.deepEqual(await createProof(chrome, prefix + 'connect.html', nonce), { proofStarted: true, windowId: 99 });
  assert.equal(created.url, prefix + 'window-proof.html#' + nonce);
  assert.equal(created.openerTabId, 9);
  await assert.rejects(createProof(chrome, 'https://example.invalid', nonce), /connector_popup_required/);
  chrome.runtime.sendMessage = async () => ({ connected: false });
  await assert.rejects(createProof(chrome, prefix + 'connect.html', nonce), /connector_not_connected/);
});
test('connection change cleans only the temporary proof tab', async () => {
  let calls = 0, removed;
  const prefix = 'chrome-extension://' + 'a'.repeat(32) + '/';
  const url = prefix + 'window-proof.html#' + nonce;
  const chrome = { runtime: { getURL: p => prefix + p,
    sendMessage: async () => ({ connected: true, sourceTab: ++calls === 1 ? 8 : 20 }) },
  tabs: {
    get: async id => id === 8 ? { id: 8, windowId: 99 } : { id, windowId: 99, url },
    query: async () => [{ id: 9, index: 1 }],
    create: async () => ({ id: 10 }),
    remove: async id => { removed = id; }
  } };
  await assert.rejects(createProof(chrome, prefix + 'connect.html', nonce), /connector_changed/);
  assert.equal(removed, 10);
});
