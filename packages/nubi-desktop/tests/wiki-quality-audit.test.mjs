import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWikiPage,summarizeWikiQuality} from '../runtime/wiki-quality.mjs';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {coverageMap} from '../runtime/wiki-coverage.mjs';
import {hash} from '../runtime/files.mjs';
import {RepositoryEvidenceResolver} from '../generated/openwiki.mjs';
import {prepareNativeWikiCopy} from '../runtime/wiki-update.mjs';

test('Desktop preparation does not invent CI that is never published, while preserving actual workflow sources',async t=>{
 const {root}=await fixture(t),file=path.join(root,'.github/workflows/openwiki-update.yml');
 await prepareNativeWikiCopy(root,'init');await assert.rejects(access(file),{code:'ENOENT'});
 await mkdir(path.dirname(file),{recursive:true});const original='name: Existing project workflow\non: workflow_dispatch\n';await writeFile(file,original);
 await prepareNativeWikiCopy(root,'init');assert.equal(await readFile(file,'utf8'),original);
});

test('Markdown audit ignores fenced examples and external links, and resolves nested wiki and source links',()=>{
 const page='openwiki/guide/retry.md',paths=new Set([page,'openwiki/home.md','README.md']);
 const text='---\ntitle: Retry\n---\n# Retry\n\n## Group\n### Usage\n[Home](../home.md) [Source](../../README.md) [Web](https://example.invalid/none.md)\n\n```md\n## Example\n[example](missing.md)\n```\n\n## Empty\n\n## Detail\n[Broken](../missing.md)\n';
 const row=inspectWikiPage(page,text,{paths});
 assert.equal(row.emptySections,1);assert.equal(row.brokenLinks,1);assert.equal(row.links,3);
 assert(row.issues.some(i=>i.kind==='broken_link'&&i.target==='openwiki/missing.md'));
 assert(!row.issues.some(i=>i.target?.includes('example')));
});
test('bounded structural reports retain total counts and never call them factual correctness',()=>{
 const rows=Array.from({length:80},(_,i)=>inspectWikiPage('openwiki/'+i+'.md','# Empty\n',{paths:new Set()}));
 const report=summarizeWikiQuality(rows,{limit:12});
 assert.equal(report.pages,80);assert.equal(report.emptySections,80);assert.equal(report.rows.length,12);assert.equal(report.omitted,68);
 assert.equal(report.factualCorrectness,'not_evaluated');assert.equal(report.modelCalls,0);
});
test('a parent heading with nested content is not an empty section and reference links are checked',()=>{
 const row=inspectWikiPage('openwiki/home.md','# Home\n## Group\n### Child\nUseful instructions.\n\n[missing][ref]\n\n[ref]: absent.md\n',{paths:new Set(['openwiki/home.md'])});
 assert.equal(row.emptySections,0);assert.equal(row.brokenLinks,1);
});

test('a live coverage audit coalesces shared evidence, detects source drift on re-entry and tolerates malformed Claims',async t=>{
 const {root}=await fixture(t),resource='repo://app.txt',version=(await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource)).evidence.version;
 await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});
 for(let i=0;i<8;i++){
  const text='# Policy '+i+'\n\nThe current source defines the rule.\n\n[Missing](missing.md)\n\n## Empty\n';
  await writeFile(path.join(root,`openwiki/policy-${i}.md`),text);
  await writeFile(path.join(root,`openwiki/.claims/policy-${i}.json`),JSON.stringify({schemaVersion:1,pageVersion:hash(text),claims:[{id:'rule',statement:'The source defines the rule.',evidence:[{resource,version}]}]}));
 }
 let calls=0;const original=RepositoryEvidenceResolver.prototype.resolve;
 RepositoryEvidenceResolver.prototype.resolve=async function(...args){calls++;return original.apply(this,args);};t.after(()=>{RepositoryEvidenceResolver.prototype.resolve=original;});
 let result=await coverageMap(root,{important:['app.txt']});assert.equal(calls,1);assert.equal(result.quality.brokenLinks,8);assert.equal(result.quality.emptySections,8);assert.equal(result.quality.sourceReviewPages,0);
 assert.equal(result.quality.factualCorrectness,'not_evaluated');assert(!JSON.stringify(result.quality).includes('first\nsecond'));
 await writeFile(path.join(root,'app.txt'),'changed source\n');result=await coverageMap(root,{important:['app.txt']});assert.equal(calls,2);assert.equal(result.quality.staleClaims,8);assert.equal(result.quality.sourceReviewPages,8);assert.equal(result.ratio,0);
 await writeFile(path.join(root,'openwiki/.claims/policy-0.json'),'{');result=await coverageMap(root,{important:['app.txt']});assert.equal(result.quality.unavailableClaims,1);assert.equal(result.quality.sourceReviewPages,8);
});
