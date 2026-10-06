import test from 'node:test';
import assert from 'node:assert/strict';
import {contentPacket} from '../browser-content.js';
import {groundSourceQuotes} from '../analysis-source-quotes.js';

const source = text => ({text, title: 'Operations', url: 'https://example.test/operations', frame: 0,
  documentId: 'doc-1', sourceIdentity: ['doc-1', 'https://example.test/operations'], coverage: {partial: false}});

test('long document outline locates nested exceptions without claiming their body was read', async () => {
  const text = '# Operations\n\n## Alpha\n\n' + 'Ordinary rule.\n'.repeat(500) +
    '\n### Exception\n\nUrgent work takes 3 days.\n\n## Beta\n\n' + 'Another rule.\n'.repeat(500);
  const packet = await contentPacket(source(text));
  assert.equal(packet.outline.content_hash, packet.content_hash);
  const alpha = packet.outline.sections.find(row => row.heading === '## Alpha');
  const exception = packet.outline.sections.find(row => row.heading === '### Exception');
  assert.equal(alpha.end, text.indexOf('## Beta'));
  assert.equal(exception.start, text.indexOf('### Exception'));
  assert.equal(exception.end, alpha.end);
  assert.equal(packet.ranges[0].end, 5000);
  assert(!packet.ranges[0].markdown.includes('Urgent'));
  assert.equal(packet.coverage.partial, true);
  const tail = await contentPacket(source(text), {offset: exception.start, content_hash: packet.content_hash});
  assert.match(tail.ranges[0].markdown, /Urgent work takes 3 days/);
  assert.equal(tail.outline, undefined, 'Continuation does not repeat the navigation index');
});

test('outline handles setext headings and ignores headings inside fenced code', async () => {
  const text = 'Overview\n========\n\n```md\n## Fake heading\n```\n\nReal section\n------------\n\n' + 'Body '.repeat(1500);
  const packet = await contentPacket(source(text));
  assert.equal(packet.outline.total_sections, 2);
  assert(!packet.outline.sections.some(row => row.heading.includes('Fake')));
  assert.equal(packet.outline.sections[1].start, text.indexOf('Real section'));
});

test('bounded outline reports omissions and computes ends using all later headings', async () => {
  const text = Array.from({length: 45}, (_, i) => `## Part ${i}\n\n${'Body '.repeat(60)}\n`).join('');
  const packet = await contentPacket(source(text));
  assert.equal(packet.outline.sections.length, 32);
  assert.equal(packet.outline.total_sections, 45);
  assert.equal(packet.outline.omitted_sections, 13);
  assert.equal(packet.outline.sections.at(-1).end, text.indexOf('## Part 32\n'));
  assert.match(packet.outline.scope, /not.*read/i);
});

test('short, heading-free and query reads do not add an unnecessary outline', async () => {
  assert.equal((await contentPacket(source('# Short\n\nBody'))).outline, undefined);
  assert.equal((await contentPacket(source('Plain body '.repeat(800)))).outline, undefined);
  assert.equal((await contentPacket(source('# Long\n\n' + 'Body '.repeat(1500)), {query: 'Body'})).outline, undefined);
});

test('an outline never bypasses content replacement or original UTF-16 coordinates', async () => {
  const text = '# 🌱 Report\n\n' + '🌱'.repeat(4000) + '\n## Next\n\nException.';
  const first = await contentPacket(source(text)), section = first.outline.sections[0];
  assert.equal(first.outline.sections[1].start, text.indexOf('## Next'));
  assert(!(/[\uDC00-\uDFFF]/.test(text[section.tail_offset]) && /[\uD800-\uDBFF]/.test(text[section.tail_offset - 1])));
  assert.equal((await contentPacket(source(text + '\nChanged'), {offset: section.tail_offset, content_hash: first.content_hash})).error, 'browser_content_changed');
});

test('reading an outline cannot ground a quote from an unreturned section', async () => {
  const text = '# Intro\n\n' + 'Background '.repeat(800) + '\n## Restricted exception\n\nOnly existing members qualify.';
  const packet = await contentPacket(source(text));
  assert(packet.outline.sections.some(row => row.heading.includes('Restricted exception')));
  const wrapped = JSON.stringify({input: {}, result: packet});
  const sources = new Map([['ev_1', {id: 'ev_1', text: wrapped, tool: 'read_page', kind: 'page', status: 'observed'}]]);
  const reads = new Map([['ev_1', [{start: 0, end: wrapped.length}]]]);
  assert.throws(() => groundSourceQuotes({findings: [{text: 'Exception observed', evidence_ids: ['ev_1'],
    quotes: [{evidence_id: 'ev_1', quote: 'Restricted exception'}]}]}, sources, reads), /analysis_quote_unverified/);
});
