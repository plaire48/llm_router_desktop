import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
const root=new URL('../../../.github/workflows/',import.meta.url);
test('main fast gates are read-only, bounded to20min and preserve failure images for7days',async()=>{
 const file=new URL('nubi-desktop-gates.yml',root);assert.ok(await readFile(file).catch(()=>null),'main fast workflow must exist');const doc=parse(await readFile(file,'utf8'));
 assert.ok(doc.on.push.branches.includes('main'));assert.ok('pull_request' in doc.on);assert.equal(doc.permissions.contents,'read');assert.equal(doc.concurrency['cancel-in-progress'],true);
 const job=doc.jobs['gates-fast'];assert.equal(job['runs-on'],'ubuntu-latest');
 // Three parallel parts of the same chain (release plan R1, 2026-10-20): the partition comes from package.json via run-gate-part.mjs.
 assert.deepEqual(job.strategy.matrix.part,['unit-a','unit-b','ui']);assert.equal(job.strategy['fail-fast'],false);
 const gate=job.steps.find(s=>s.run?.includes('node scripts/run-gate-part.mjs ${{ matrix.part }}'));assert.ok(gate,'all parts run the partitioned fast chain');assert.ok((gate['timeout-minutes']||job['timeout-minutes'])<=20);
 assert.ok(!job.steps.some(s=>s.run?.includes('npm run test:gates:fast')),'the single-job chain is not run a second time');
 const artifact=job.steps.find(s=>s.uses?.startsWith('actions/upload-artifact@'));assert.equal(artifact.if,'failure()');assert.equal(artifact.with['retention-days'],7);assert.match(artifact.with.path,/verification/);
});
test('Windows packaging stays parallel and all release API calls wait for both successful jobs',async()=>{
 const doc=parse(await readFile(new URL('nubi-desktop-windows.yml',root),'utf8'));const jobs=doc.jobs;assert.ok(jobs['gates-full'],'full gate job must exist');assert.equal(jobs['gates-full']['runs-on'],'windows-latest');assert.equal(jobs.windows.needs,'windows-shell-probe');
 assert.ok(jobs['gates-full'].steps.some(s=>s.run?.includes('test:gates:fast')));const electron=jobs['gates-full'].steps.find(s=>s.run?.includes('test:gates:electron'));assert.match(electron.if,/!cancelled\(\)/);
 const release=Object.entries(jobs).filter(([,j])=>j.steps.some(s=>/gh release (?:create|upload|edit)/.test(s.run||'')));assert.equal(release.length,1,'no pre-gate candidate or failed-check release');assert.deepEqual(new Set(release[0][1].needs),new Set(['windows','gates-full']));assert.equal(release[0][1].permissions.contents,'write');assert.match(release[0][1].steps.map(s=>s.run||'').join('\n'),/Private build repository required/);
});
test('safety delta has a fixed base and enough checkout history and full safety blocks Windows release gates',async()=>{
 const fast=parse(await readFile(new URL('nubi-desktop-gates.yml',root),'utf8')).jobs['gates-fast'];assert.ok(fast.steps.find(s=>s.uses?.startsWith('actions/checkout@')).with['fetch-depth']>=2);assert.match(fast.env.NUBI_SAFETY_BASE,/github\.event\.before/);assert.match(fast.env.NUBI_SAFETY_REF,/github\.sha/);
 const doc=parse(await readFile(new URL('nubi-desktop-windows.yml',root),'utf8')),job=doc.jobs['gates-full'];const at=job.steps.findIndex(s=>s.run?.includes('check-safety-regression.mjs --tree'));assert(at>=0);assert(at<job.steps.findIndex(s=>s.run?.includes('test:gates:fast')));assert(job.steps[at].run.includes('$env:GITHUB_SHA'));assert.equal(job.steps[at]['continue-on-error'],true,'source audit must remain visible without replacing the payload gate');
 const payload=job.steps.find(s=>s.run?.includes('package-windows.mjs --payload-only'));assert.ok(payload,'build and inspect the complete unpacked release payload');assert.notEqual(payload['continue-on-error'],true);
 const packaging=parse(await readFile(new URL('nubi-desktop-windows.yml',root),'utf8')).jobs.windows;assert.ok(packaging.steps.some(s=>s.run?.includes('package-windows'))||packaging.steps.some(s=>s.run?.includes('package:windows')));

});
