import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {createComparisonAnalysis} from '../comparison-analysis.js';
import {runAgent} from '../agent-runtime.js';
import {reviewEvidence, goalReviewMessages} from '../goal-review.js';

const rule = '기본 규칙은 분기 첫 월요일에 휴실합니다.';
const exception = '2026년 3월에는 휴실하지 않습니다.';
const requestTail = '\n2026년 3월의 휴실 예외를 반드시 확인하고 회원 전용 서비스는 비교에서 제외해 줘.';
const comparisonRequest = '기관 이용 규칙과 예외를 비교해 줘.\n'.padEnd(2000 - requestTail.length, 'x') + requestTail;
const server = createServer((_, response) => {response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<title>기관 이용 안내</title><main><h1>이용 안내</h1><p>${rule}</p>${Array.from({length: 1200}, (_, i) => `<p>일반 안내 ${i}: 방문 전에 이용 조건과 안내 사항을 확인하세요.</p>`).join('')}<p id="exception">${exception}</p></main>`);});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-comparison-range-')), extension = resolve(profile, 'extension');
let context, coordinator;
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(`${origin}/*`); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.rangeProbe={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const page = await context.newPage(); await page.goto(origin);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await rangeProbe.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const read = args => worker.evaluate(async ({tabId, args}) => (await rangeProbe.runBrowserAgent('ranges', {tabId}, 'read_page', {mode: 'content', ...args})).result, {tabId, args});
  const controller = new AbortController(), receipts = [], launches = [], versions = [];
  coordinator = createAnalysisCoordinator({signal: controller.signal, modelId: 'fixture', run: runAgent, tools: [],
    execute: async () => assert.fail('No browser access in child'), onDelivery: value => receipts.push(value),
    complete: async messages => {
      const brief = JSON.parse(messages[1].content);
      assert.equal(brief.task, comparisonRequest, 'Every child input must retain the trailing exclusion and exception');
      // The coordinator already returns focused, host-recorded source reads in
      // the brief. The fixture must use them, not reread the same source until
      // its allocation is exhausted when testing a longer original request.
      const reads = [...(brief.evidence_reads || []), ...messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))];
      const unread = brief.evidence.filter(({evidence_id}) => !reads.some(packet => packet.evidence_id === evidence_id && !packet.error));
      if (unread.length) return {calls: unread.map(({evidence_id}) => ({id: crypto.randomUUID(), function: {
        name: 'read_analysis_evidence', arguments: JSON.stringify({evidence_id})}}))};
      const findings = reads.flatMap(packet => {
        return [rule, exception].filter(quote => packet.text.includes(quote))
          .map(quote => ({text: quote, evidence_ids: [packet.evidence_id], quotes: [{evidence_id: packet.evidence_id, quote}]}));
      });
      return {content: JSON.stringify({status: 'complete', summary: '읽은 규칙과 예외', findings, uncertainties: [], next_step: ''})};
    }});
  const scheduler = createComparisonAnalysis({analyses: coordinator, allowed: () => !controller.signal.aborted,
    goal: comparisonRequest, onStep: () => {}, onLaunch: id => launches.push(id)});
  async function observe(packet) {
    assert(packet.ok, JSON.stringify(packet)); versions.push(packet.content_hash);
    const id = coordinator.observe('read_page', {mode: 'content'}, packet);
    scheduler.observe(packet.source_key, packet.url, id, {eager: true, reference: packet});
    await scheduler.flush(); return id;
  }
  const first = await read({}); assert(first.characters > 30000); assert(!first.ranges[0].markdown.includes(exception));
  await observe(first); const initial = (await coordinator.collect()).results[0];
  assert.equal(initial.report?.status, 'complete', JSON.stringify(initial)); assert(initial.report.findings.every(item => item.text !== exception));
  const tail = await read({offset: first.characters - 2000, content_hash: first.content_hash});
  assert(tail.ranges[0].markdown.includes(exception)); await observe(tail);
  const revised = (await coordinator.collect()).results[0];
  assert.equal(revised.report.status, 'complete'); assert.equal(revised.assignment.evidence_ids.length, 2);
  const proof = revised.report.findings.find(item => item.text === exception).quotes[0];
  assert.equal(proof.content_hash, first.content_hash); assert(proof.start > 30000);
  await observe(await read({offset: first.characters - 2000, content_hash: first.content_hash}));
  assert.equal(launches.length, 2, 'Identical reread must not launch another child');
  const review = goalReviewMessages({goal: '기관 규칙과 예외 비교', answer: `${rule} 단, ${exception}`, history: [], inputBudget: 24000,
    evidence: receipts.map((result, index) => reviewEvidence(index + 1, 'analysis_receipt', {}, result))});
  assert.equal(review.evidence.at(-1).result.source_reads.sources.length, 2);
  assert(review.evidence.at(-1).result.source_reads.sources.some(row => row.page_content.returned_ranges.some(range => range.start > 30000)));
  const compacted = goalReviewMessages({goal: '기관 규칙과 예외 비교', answer: `${rule} 단, ${exception}`, history: [], inputBudget: 60000,
    evidence: [...review.evidence,
      ...Array.from({length: 30}, (_, index) => reviewEvidence(index + 3, 'verify_page', {},
        {ok: true, verified: true, text: 'Intermediate observation '.repeat(160)})),
      reviewEvidence(33, 'browser_snapshot', {}, {ok: true, frames: [{frame: 0, text: 'Current page'}]})]});
  assert(JSON.parse(compacted.messages[1].content).omitted);
  assert.deepEqual(compacted.evidence.filter(item => item.tool === 'analysis_receipt'), review.evidence,
    'Later observations must not evict actual child reads from final review');
  // Same URL with new content creates a separate source version, not merged coverage.
  await page.locator('#exception').evaluate(element => {element.textContent = '2026년 3월 휴실 일정은 별도 공지합니다.';});
  const changed = await read({}); assert.notEqual(changed.content_hash, first.content_hash);
  await observe(changed); const changedReport = (await coordinator.collect()).results[0];
  assert.equal(changedReport.assignment.evidence_ids.length, 1);
  assert(changedReport.report.findings.every(item => item.text !== exception));
  // Delivered evidence can leave the bounded coordinator cache. A late
  // exception must not be analyzed as if the earlier rule were still present.
  for (let i = 0; i < 60; i++) coordinator.observe('read_page', {}, {text: `Unrelated observation ${i}`});
  await observe(await read({offset: changed.characters - 2000, content_hash: changed.content_hash}));
  assert.equal(launches.length, 3, 'Lost reconciliation evidence must launch no child');
  const missing = scheduler.status().find(source => source.content_hash === changed.content_hash);
  assert.equal(missing.status, 'needs_leader_review');
  assert.equal(missing.unavailable_snapshots, 1);
  assert.equal(missing.pending_snapshots, 1);
  // A separate valid source version still starts despite the unavailable rows.
  await page.locator('#exception').evaluate(element => {element.textContent = '2026년 4월 규칙은 별도 공지합니다.';});
  await observe(await read({}));
  const survivor = (await coordinator.collect()).results[0];
  assert.equal(survivor.assignment.evidence_ids.length, 1);
  assert.equal(launches.length, 4);
  controller.abort(); await scheduler.flush(); assert.equal(launches.length, 4);
  const output = process.env.NUBI_VERIFICATION_DIR || 'verification/comparison-continuation';
  await mkdir(output, {recursive: true});
  await writeFile(resolve(output, 'result.json'), JSON.stringify({actualBrowser: true, actualModel: false,
    requestCharacters: comparisonRequest.length,
    checks: ['full request reaches every child without losing tail conditions', 'late exception enters follow-up', 'exact returned quotes only', 'duplicate reread launches zero', 'changed hash stays isolated', 'source ranges survive review', 'source ranges survive context pruning', 'evicted rule blocks incomplete reconciliation', 'valid source proceeds after peer eviction', 'cancelled scheduler stays stopped'],
    launches: launches.length, versions, originalCharacters: first.characters, exceptionOffset: proof.start}, null, 2));
  console.log('PASS actual Chrome source continuation, verified quotes, duplicate suppression, version isolation and review ranges');
  await worker.evaluate(() => rangeProbe.stopBrowserAgent('ranges'));
} finally {coordinator?.dispose(); await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, {recursive: true, force: true});}
