import test from 'node:test';
import assert from 'node:assert/strict';
import {contentPacket} from '../browser-content.js';
import {createEvidenceSearch, rankEvidence} from '../evidence-search.js';

const source = (text, extra = {}) => ({url:'https://example.test/policy', title:'Eligibility manual', frame:0,
  documentId:'doc-policy', sourceIdentity:['doc-policy','https://example.test/policy'], text, method:'test', coverage:{partial:false}, ...extra});

test('a heading lookup includes its adjacent qualification and exclusion instead of a heading-only result', async () => {
  const text = '# Eligibility\n\n' + 'Only resident applicants aged at least 18 qualify. Temporary visitors are excluded. '.repeat(150);
  const packet = await contentPacket(source(text), {query:'Eligibility'});
  assert.match(packet.ranges[0].markdown, /aged at least 18/);
  assert.match(packet.ranges[0].markdown, /Temporary visitors are excluded/);
  assert.equal(packet.ranges[0].markdown, text.slice(packet.ranges[0].start, packet.ranges[0].end));
  assert(packet.ranges[0].markdown.length <= 5000);
  assert.equal(packet.coverage.partial, true);
  assert(packet.next_offset === null, 'Lexical candidates do not imply exhaustive section coverage');
});

test('a repeated page title cannot manufacture matches in unrelated body chunks', async () => {
  const text = '# Details\n\n' + 'Only resident applicants qualify. '.repeat(400);
  const packet = await contentPacket(source(text), {query:'Eligibility'});
  assert.deepEqual(packet.ranges, []);
  assert.equal(packet.retrieval.total_matches, 0);
  assert.equal(packet.coverage.partial, true);
  assert.match(packet.retrieval.scope, /No word matched/);
});

test('an already useful short body match stays compact rather than adding unrelated context', async () => {
  const text = '# Rules\n\nMembership excludes temporary visitors.\n\n' + 'Other text. '.repeat(700);
  const packet = await contentPacket(source(text), {query:'Membership'});
  assert.match(packet.ranges[0].markdown, /excludes temporary visitors/);
  assert(!packet.ranges[0].markdown.includes('Other text.'));
  assert(packet.ranges[0].markdown.length < 1000);
});

test('expanded context keeps exact Unicode and PDF page ranges, without inventing a match in another section', async () => {
  const text = '# Eligibility\n\n' + 'x'.repeat(4984) + '🌡️' + 'More context. '.repeat(400);
  const input = source(text, {pdf:{page_count:2},pageRanges:[{page:1,start:0,end:3000,textAvailable:true},{page:2,start:3000,end:text.length,textAvailable:true}]});
  const packet = await contentPacket(input, {query:'Eligibility'});
  const row = packet.ranges[0];
  assert.equal(row.end, 4999);
  assert.equal(row.markdown, text.slice(row.start,row.end));
  assert.deepEqual(row.page_ranges.map(page => [page.page,page.start,page.end]), [[1,0,3000],[2,3000,4999]]);
  assert.deepEqual(packet.retrieval.matches[0].pages, [1,2]);
  const next = await contentPacket(input, {offset:row.end,content_hash:packet.content_hash});
  assert(next.ranges[0].markdown.startsWith('🌡️'));
});

test('reused lexical indices never bypass source hash checks or cross document/query identities', async () => {
  const input = source('# Rules\n\nMembership excludes temporary visitors.\n\n' + 'Other text. '.repeat(700));
  const first = await contentPacket(input,{query:'Membership'});
  assert.deepEqual((await contentPacket(input,{query:'Membership'})).ranges, first.ranges);
  assert.deepEqual((await contentPacket(input,{query:'uniquelyabsent'})).ranges, []);
  const updated = {...input,text:input.text.replace('excludes','includes')};
  assert.equal((await contentPacket(updated,{query:'Membership',content_hash:first.content_hash})).error, 'browser_content_changed');
  assert.match((await contentPacket(updated,{query:'Membership'})).ranges[0].markdown, /includes temporary visitors/);
  const otherDocument = {...input,sourceIdentity:['doc-new','https://example.test/policy?q=2']};
  assert.equal((await contentPacket(otherDocument,{query:'Membership',content_hash:first.content_hash})).error, 'browser_content_changed');
});

test('reusable MiniSearch preserves existing generic ranking while body-only lookup rejects metadata-only hits', () => {
  const rows = [{id:1,name:'Eligibility',text:'Opening hours'}, {id:2,name:'Other',text:'Eligibility excludes visitors'}];
  const search = createEvidenceSearch(rows);
  assert.deepEqual(search('Eligibility'),rankEvidence(rows,'Eligibility'));
  assert.deepEqual(createEvidenceSearch(rows,{fields:['text']})('Eligibility').map(hit=>hit.id),[2]);
  assert.deepEqual(createEvidenceSearch([])('Eligibility'),[]);
});
