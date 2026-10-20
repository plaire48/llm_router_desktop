import test from 'node:test';import assert from 'node:assert/strict';
const mod=await import('../runtime/wiki-chunks.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
test('Wiki chunks carry file and heading ancestry while exact excerpts retain original line provenance',()=>{
 assert.equal(typeof mod.wikiChunks,'function');const raw='---\ntitle: Contract\n---\n# Handbook\n\n## Aster\n\n### Recovery\n\nWait 17 seconds.\n';const doc={path:'openwiki/handbook.md',hash:'hash-one',title:'Contract',raw,fields:{}};const rows=mod.wikiChunks(doc),row=rows.find(r=>r.text.includes('Wait 17'));
 assert.match(row.header,/openwiki\/handbook\.md > Handbook > Aster > Recovery/);assert.equal(row.start,8);assert.equal(row.end,10);assert.equal(row.text,raw.split('\n').slice(row.start-1,row.end).join('\n'));assert.equal(row.sourceHash,'hash-one');assert(!rows.some(r=>r.text.includes('title: Contract')));
});
test('fenced headings stay data and oversized sections split without dropping bytes or inventing summaries',()=>{
 assert.equal(typeof mod.wikiChunks,'function');const raw='# Source\n\n```md\n## Not a section\n```\n\n'+'x'.repeat(5100);const rows=mod.wikiChunks({path:'openwiki/source.md',hash:'h',title:'Source',raw,fields:{}},{maxCharacters:2000});
 assert(rows.every(r=>r.text.length<=2000));assert(rows.every(r=>!r.header.includes('Not a section')));assert.equal(rows.map(r=>r.text).join('\n').replaceAll('\n','').match(/x/g).length,5100);assert(rows.every(r=>!r.header.includes(': undefined')));assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
});
test('only an observed summary field appears in the contextual header',()=>{
 assert.equal(typeof mod.wikiChunks,'function');const [row]=mod.wikiChunks({path:'openwiki/a.md',hash:'h',title:'A',raw:'# A\n\nObserved bytes.',fields:{summary:'Recorded summary'}});assert.match(row.header,/: Recorded summary$/);assert.equal(row.text,'# A\n\nObserved bytes.');
});

test('heading ancestry selects the right same-symbol implementation and returns its actual source span',async t=>{
 const {fixture}=await import('./fixtures.mjs'),{writeFile}=await import('node:fs/promises'),path=await import('node:path'),{searchFixture}=await import('../eval/wiki-search/fixtures.mjs');const {root,service}=await fixture(t),data=searchFixture(),c=data.cases.find(c=>c.id==='C031');
 for(const [rel,text]of Object.entries(data.files).filter(([rel])=>rel.startsWith('openwiki/30-code-')))await writeFile(path.join(root,rel),text);
 const ref=c.evidenceGroups[0].alternatives[0],result=await service.wikiQuery({query:c.query}),hit=result.results.find(r=>r.path===ref.page&&r.excerpt.includes(ref.quote));assert(hit,'the result contains the implementation under the requested heading rather than a similarly named module');assert(hit.provenance.start<=ref.start&&hit.provenance.end>=ref.end);assert.match(hit.context,/라온31/);
});
