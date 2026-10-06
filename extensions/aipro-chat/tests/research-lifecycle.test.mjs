import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchBrowser, researchAddress} from '../research-browser.js';
import {createResearchWorkers} from '../research-workers.js';
import {runAgent} from '../agent-runtime.js';

function fixture() {
  const tabs = new Map([[1, {id: 1, url: 'https://personal.test', status: 'complete'}]]);
  let next = 1, removalFails = true, saved = [];
  const ruleChanges = [];
  const browser = createResearchBrowser({
    tabs: {
      create: async () => {const tab = {id: ++next, url: 'about:blank', status: 'complete'}; tabs.set(tab.id, tab); return tab;},
      get: async id => tabs.get(id), query: async () => [...tabs.values()],
      update: async (id, patch) => Object.assign(tabs.get(id), patch),
      remove: async id => {if (removalFails) throw Error('temporary removal failure'); tabs.delete(id);},
    },
    rules: {updateSessionRules: async change => ruleChanges.push(change), getSessionRules: async () => []},
    load: async () => structuredClone(saved), save: async value => {saved = structuredClone(value);},
    access: async () => {}, checkOwner: async () => {}, read: async () => ({ok: true}),
  });
  return {browser, tabs, ruleChanges, saved: () => saved, allowRemoval: () => {removalFails = false;}};
}
const open = browser => browser.execute('owner-a', {worker_id: 'research-a', operation: 'open', url: 'https://official.test/guide'});

test('encoded action paths are rejected before any owned tab navigation', () => {
  for (const path of ['/%6Cogout', '/%64elete', '/%61uth/login', '/guide%2Flogout']) {
    assert.throws(() => researchAddress('https://official.test' + path), /page_restricted/);
  }
  assert.equal(researchAddress('https://official.test/%EC%95%88%EB%82%B4#section'), 'https://official.test/%EC%95%88%EB%82%B4');
});

test('failed tab cleanup retains its navigation fence and record until confirmed removal', async () => {
  const f = fixture(); await open(f.browser);
  const changes = f.ruleChanges.length;
  await assert.rejects(f.browser.execute('owner-a', {worker_id: 'research-a', operation: 'close'}), /research_cleanup_pending/);
  assert.equal(f.ruleChanges.length, changes);
  assert.equal(f.saved().length, 1); assert(f.tabs.has(2));
  f.allowRemoval(); await f.browser.closeOwner('owner-a');
  assert.equal(f.saved().length, 0); assert(!f.tabs.has(2)); assert(f.tabs.has(1));
});

test('restart cleanup preserves unresolved tabs and fences, without restarting a researcher', async () => {
  const f = fixture(); await open(f.browser);
  const result = await f.browser.recover();
  assert.equal(result.pending, 1); assert.equal(f.saved().length, 1); assert(f.tabs.has(2));
  assert(!f.ruleChanges.slice(1).some(change => change.removeRuleIds?.includes(720000)));
  f.allowRemoval(); assert.equal((await f.browser.recover()).pending, 0);
  assert.deepEqual([...f.tabs.keys()], [1]);
});

test('supported findings remain partial when host cleanup is unresolved', async () => {
  const text = 'The library closes on Mondays.';
  const workers = createResearchWorkers({signal: new AbortController().signal, goal: 'Compare two libraries', run: runAgent,
    browser: async operation => {
      if (operation.operation === 'close') throw Error('research_cleanup_pending');
      return {ok: true, dataKind: 'page_content', url: operation.url, frame: 0, source_key: 'a'.repeat(64), content_hash: 'b'.repeat(64),
        characters: text.length, ranges: [{start: 0, end: text.length, markdown: text}], coverage: {partial: false}};
    },
    complete: async messages => {
      if (messages.some(message => message.role === 'tool')) return {content: 'Reported.'};
      const {source} = JSON.parse(messages[1].content);
      return {calls: [{id: crypto.randomUUID(), function: {name: 'submit_research', arguments: JSON.stringify({findings: [{name: 'schedule', value: 'Closed on Mondays', reference_id: source.reference_id, quote: text}], gaps: []})}}]};
    },
  });
  try {
    const result = await workers.execute({tasks: ['A', 'B'].map(subject => ({subject, question: 'Find closure days', fields: ['schedule'], start_url: `https://official.test/${subject}`, constraints: 'Preserve exceptions.'}))});
    assert(result.research.every(report => report.status === 'partial' && report.fields.length === 1 && report.gaps.includes('research_cleanup_pending')));
  } finally {workers.close();}
});
