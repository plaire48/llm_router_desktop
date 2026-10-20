import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
const root=new URL('../../../.github/workflows/',import.meta.url);
test('main fast gates are read-only, bounded to20min and preserve failure images for7days',async()=>{
 const file=new URL('nubi-desktop-gates.yml',root);assert.ok(await readFile(file).catch(()=>null),'main fast workflow must exist');const doc=parse(await readFile(file,'utf8'));
 assert.ok(doc.on.push.branches.includes('main'));assert.ok('pull_request' in doc.on);assert.equal(doc.permissions.contents,'read');assert.equal(doc.concurrency['cancel-in-progress'],true);
 const job=doc.jobs['gates-fast'];assert.equal(job['runs-on'],'ubuntu-latest');const gate=job.steps.find(s=>s.run?.includes('npm run test:gates:fast'));assert.ok(gate);assert.ok((gate['timeout-minutes']||job['timeout-minutes'])<=20);
 const artifact=job.steps.find(s=>s.uses?.startsWith('actions/upload-artifact@'));assert.equal(artifact.if,'failure()');assert.equal(artifact.with['retention-days'],7);assert.match(artifact.with.path,/verification/);
});
test('Windows packaging stays parallel and all release API calls wait for both successful jobs',async()=>{
 const doc=parse(await readFile(new URL('nubi-desktop-windows.yml',root),'utf8'));const jobs=doc.jobs;assert.ok(jobs['gates-full'],'full gate job must exist');assert.equal(jobs['gates-full']['runs-on'],'windows-latest');assert.equal(jobs.windows.needs,'windows-shell-probe');
 assert.ok(jobs['gates-full'].steps.some(s=>s.run?.includes('test:gates:fast')));const electron=jobs['gates-full'].steps.find(s=>s.run?.includes('test:gates:electron'));assert.match(electron.if,/!cancelled\(\)/);
 const release=Object.entries(jobs).filter(([,j])=>j.steps.some(s=>/gh release (?:create|upload|edit)/.test(s.run||'')));assert.equal(release.length,1,'no pre-gate candidate or failed-check release');assert.deepEqual(new Set(release[0][1].needs),new Set(['windows','gates-full']));assert.equal(release[0][1].permissions.contents,'write');assert.match(release[0][1].steps.map(s=>s.run||'').join('\n'),/Private build repository required/);
});
