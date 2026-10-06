import test from 'node:test';
import assert from 'node:assert/strict';
import {checkReportedFacts, delegationResult, readPages, REPORT_FACTS_TOOL} from '../delegation-facts.js';
import {checkTaskResult} from '../../../packages/nubi-a2a/tasks.mjs';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const notice = {id: 1, tool: 'read_page', result: {url: 'https://www.mois.go.kr/notice/1#top', title: '공지', frames: [{frame: 0, text: '2026년 하반기   안내\n게시일 2026-09-30', tables: [[['담당', '행정과']]]}]}};
const content = {id: 2, tool: 'read_page', result: {ok: true, dataKind: 'page_content', url: 'https://example.com/guide/', ranges: [{start: 0, end: 20, markdown: '**신청 기간**은 10월 15일까지'}]}};
const fact = (quote, source_url = 'https://www.mois.go.kr/notice/1') => ({name: '제목', value: '2026년 하반기 안내', source_url, quote});

test('a quote counts only on a page the run read at that address', () => {
  assert.deepEqual(readPages([notice, content]).map(page => page.url), ['https://www.mois.go.kr/notice/1', 'https://example.com/guide']);
  const {facts} = checkReportedFacts({facts: [fact('2026년 하반기 안내'), fact('행정과'), {name: '기간', value: '10월 15일', source_url: 'https://example.com/guide', quote: '신청 기간은 10월 15일까지'},
    fact('2026년 하반기 안내', 'https://other.example/notice'), fact('없는 문장')]}, [notice, content]);
  assert.deepEqual(facts.map(item => item.checked), [true, true, true, false, false]);
  assert.equal(facts[0].title, '공지');
});
test('malformed reports are refused before anything is stored', () => {
  for (const args of [{}, {facts: []}, {facts: [fact('x')]}, {facts: [{...fact('안내'), source_url: 'file:///etc/passwd'}]}, {facts: [{...fact('안내'), name: ''}]}])
    assert.equal(checkReportedFacts(args, [notice]).error, 'tool_arguments_invalid');
  assert.equal(REPORT_FACTS_TOOL.function.parameters.properties.facts.maxItems, 50);
});
test('a finished run becomes a valid nubi-task-v1 result', () => {
  const {facts} = checkReportedFacts({facts: [fact('2026년 하반기 안내'), {name: '기간', value: '10월 15일', source_url: 'https://example.com/guide', quote: '10월 15일까지'}]}, [notice, content]);
  const result = delegationResult({content: '최신 공지는 하반기 안내입니다.', facts, verified: true, runId: 'run-1', at: '2026-10-01T01:00:00.000Z'});
  assert.equal(result.verification, 'host_checked');
  assert.deepEqual(result.evidence.map(item => item.id), ['page-1', 'page-2']);
  assert.deepEqual(checkTaskResult(result).facts.map(item => item.evidenceId), ['page-1', 'page-2']);
  assert.equal(delegationResult({content: 'x', facts, verified: false, runId: 'run-1'}).verification, 'not_run', 'The run\'s own checks must pass');
  assert.equal(delegationResult({content: 'x', facts: [{...facts[0], checked: false}], verified: true, runId: 'run-1'}).verification, 'not_run', 'Every quote must be found');
  assert.equal(delegationResult({content: '', facts: [], verified: true, runId: 'run-1'}).verification, 'not_run');
  assert.doesNotThrow(() => checkTaskResult(delegationResult({content: '', facts: [], verified: true, runId: 'run-1'})));
});
test('the runtime hands report_facts to a host check only when the host gives one', async () => {
  const tools = [...browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan'), REPORT_FACTS_TOOL];
  const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
  const page = {url: 'https://www.mois.go.kr/notice/1', title: '공지', frames: [{frame: 0, text: '2026년 하반기 안내'}]};
  const report = {facts: [fact('2026년 하반기 안내')]};
  for (const hosted of [true, false]) {
    let round = 0, seen = null; const executed = [];
    await runAgent({messages: [{role: 'user', content: '공지 제목 확인'}], tools, harness: true, signal: new AbortController().signal,
      complete: async () => ++round === 1 ? call('read_page') : round === 2 ? call('report_facts', report) : {content: '제목은 2026년 하반기 안내입니다.', finishReason: 'stop'},
      execute: async name => {executed.push(name); return name === 'read_page' ? page : {ok: true};},
      reviewGoal: async () => ({status: 'complete'}),
      ...(hosted ? {onFacts: async (args, evidence) => {seen = checkReportedFacts(args, evidence); return {ok: true};}} : {})});
    if (hosted) {assert.deepEqual(seen.facts.map(item => item.checked), [true], 'The host check sees the page this run read'); assert(!executed.includes('report_facts'));}
    else assert(executed.includes('report_facts'), 'Without a host check the call goes to the host executor like any tool');
  }
});
