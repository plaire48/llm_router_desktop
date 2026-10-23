import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {inspectReleaseInputs,gitCandidate} from '../scripts/check-release-inputs.mjs';
import {readFile} from 'node:fs/promises';import {parse} from 'yaml';
const exec=promisify(execFile),desktop='packages/nubi-desktop';
function fixture(){
 const files=new Map(Object.entries({'.nvmrc':'24.22.1\n',[desktop+'/runtime/entry.mjs']:"import '../../nubi-document-agent/src/index.mjs';",[desktop+'/scripts/build.mjs']:"await build({entryPoints:['../nubi-browser-agent/src/index.ts'],outfile:'generated/browser.mjs'});",[desktop+'/package.json']:'{}','packages/nubi-document-agent/package.json':'{}','packages/nubi-document-agent/src/index.mjs':'export const answer=42;','packages/nubi-browser-agent/package.json':'{}','packages/nubi-browser-agent/src/index.ts':'export const x=1;','.github/workflows/nubi-desktop-gates.yml':'name: gates','.github/workflows/nubi-desktop-windows.yml':'name: windows','docs/HOTFIX-1.3.0.md':'# Changes','docs/INSTALL-AND-UPDATE-1.3.0.md':'# Install'}).map(([p,b])=>[p,Buffer.from(b)]));
 return {files,source:new Map(files),manifest:Buffer.from('["runtime/entry.mjs","../nubi-document-agent/src/index.mjs"]')};
}
function check(f,extra={}){return inspectReleaseInputs({paths:[...f.files.keys()],readCandidate:async p=>f.files.get(p),readSource:async p=>f.source.get(p),manifest:f.manifest,...extra});}
test('the CI Node pin must exist and match the audited source bytes',async()=>{
 const missing=fixture();missing.files.delete('.nvmrc');assert((await check(missing)).issues.some(r=>r.code==='release_required_missing'&&r.path==='.nvmrc'));
 const changed=fixture();changed.files.set('.nvmrc',Buffer.from('25.4.0\n'));assert((await check(changed)).issues.some(r=>r.code==='release_input_changed'&&r.path==='.nvmrc'));
});
test('audit discovers sibling packages from scripts and imports and hashes every compiled source',async()=>{
 const out=await check(fixture());assert.equal(out.ok,true);assert.deepEqual(out.siblings.map(r=>r.name),['nubi-browser-agent','nubi-document-agent']);assert.equal(out.compiledInputCount,2);assert.equal(out.inputs.length,4);assert(out.inputs.every(r=>r.sha256===r.sourceSha256&&r.sha256.length===64));
});
test('missing document-agent is blocked even outside the compiled manifest',async()=>{
 const f=fixture();f.manifest=Buffer.from('["runtime/entry.mjs"]');f.files.delete('packages/nubi-document-agent/package.json');const out=await check(f);assert.equal(out.ok,false);assert(out.issues.some(r=>r.code==='release_package_missing'&&r.path==='packages/nubi-document-agent/package.json'));
});
test('prebundled outputs cannot hide missing or changed build sources and their transitive imports',async()=>{
 for(const mode of ['missing-entry','missing-child','changed-child','missing-local-entry']){
  const f=fixture();f.files.set(desktop+'/scripts/build.mjs',Buffer.from("await build({entryPoints:['../nubi-document-agent/src/native-model.ts'],outfile:'generated/native.mjs'});"));f.files.set(desktop+'/generated/native.mjs',Buffer.from('export const bundled=true;'));f.source.set(desktop+'/generated/native.mjs',f.files.get(desktop+'/generated/native.mjs'));f.manifest=Buffer.from('["generated/native.mjs"]');
  if(mode!=='missing-entry'){f.files.set('packages/nubi-document-agent/src/native-model.ts',Buffer.from("export {x} from './child.js';"));f.source.set('packages/nubi-document-agent/src/native-model.ts',f.files.get('packages/nubi-document-agent/src/native-model.ts'));}
  if(mode==='changed-child'){f.files.set('packages/nubi-document-agent/src/child.ts',Buffer.from('export const x=1;'));f.source.set('packages/nubi-document-agent/src/child.ts',Buffer.from('export const x=2;'));}
  if(mode==='missing-local-entry')f.files.set(desktop+'/scripts/build.mjs',Buffer.from("await build({entryPoints:['runtime/private-source.ts'],outfile:'generated/native.mjs'});"));
  const out=await check(f);assert.equal(out.ok,false,mode);assert(out.issues.some(r=>mode==='changed-child'?r.code==='release_input_changed':r.code==='release_reference_missing'),mode);
 }
});
test('source closure resolves extensionless JSX modules',async()=>{
 const f=fixture();f.files.set(desktop+'/scripts/build.mjs',Buffer.from("await build({entryPoints:['ui/fixture.jsx']});"));f.files.set(desktop+'/ui/fixture.jsx',Buffer.from("import Icon from './Icon';"));f.files.set(desktop+'/ui/Icon.jsx',Buffer.from('export default ()=>null;'));for(const [p,b] of f.files)f.source.set(p,b);assert.equal((await check(f)).ok,true);
});
test('missing compiled source and changed working source cannot pass',async()=>{
 const f=fixture();f.files.delete('packages/nubi-document-agent/src/index.mjs');f.source.set(desktop+'/runtime/entry.mjs',Buffer.from('changed'));const out=await check(f);assert.equal(out.ok,false);assert(out.issues.some(r=>r.code==='release_input_missing'));assert(out.issues.some(r=>r.code==='release_input_changed'));
});
test('both workflows and both release documents are required',async()=>{
 const f=fixture();for(const p of ['.github/workflows/nubi-desktop-gates.yml','.github/workflows/nubi-desktop-windows.yml','docs/HOTFIX-1.3.0.md','docs/INSTALL-AND-UPDATE-1.3.0.md'])f.files.delete(p);const out=await check(f);assert.equal(out.issues.filter(r=>r.code==='release_required_missing').length,4);
});
test('missing empty and escaping manifests fail closed',async()=>{
 for(const manifest of [null,Buffer.from('[]'),Buffer.from('["../../../../secret"]'),Buffer.from('["/etc/passwd"]')]){const out=await check(fixture(),{manifest});assert.equal(out.ok,false);assert(out.issues.some(r=>['release_manifest_invalid','release_path_scope'].includes(r.code)));}
});
test('comments do not invent dependencies and package file references are checked',async()=>{
 const f=fixture();f.files.set(desktop+'/scripts/build.mjs',Buffer.from("// '../invented-package/input.ts'\nawait build({entryPoints:['../nubi-browser-agent/src/index.ts'],outfile:'generated/browser.mjs'});"));f.files.set(desktop+'/package.json',Buffer.from('{"dependencies":{"required":"file:../fixture-adapter"}}'));const out=await check(f);assert(!out.siblings.some(r=>r.name==='invented-package'));assert(out.issues.some(r=>r.path==='packages/fixture-adapter/package.json'));
});
test('symlinks cannot stand in for compiled source',async()=>{
 const out=await check(fixture(),{modes:{[desktop+'/runtime/entry.mjs']:'120000'}});assert.equal(out.ok,false);assert(out.issues.some(r=>r.code==='release_entry_mode'));
});
test('file-relative and node_modules-relative assets are not sibling packages',async()=>{
 const f=fixture();f.files.set(desktop+'/scripts/assets.cjs',Buffer.from("const a=path.join(__dirname,'../runtime/entry.mjs');const b=createRequire(import.meta.url)('../electron-app/reader.cjs');const c=path.resolve(path.dirname(entry),'../prebuilds');"));assert.equal((await check(f)).ok,true);
});
test('Git adapter reads immutable trees after checkout bytes change',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-release-inputs-'));removeLater(root);await mkdir(path.join(root,'a'));await writeFile(path.join(root,'a','source.mjs'),'before');await exec('git',['init','-q'],{cwd:root});await exec('git',['add','.'],{cwd:root});const {stdout}=await exec('git',['write-tree'],{cwd:root});await writeFile(path.join(root,'a','source.mjs'),'after');const candidate=await gitCandidate({repo:root,ref:stdout.trim()});assert.deepEqual(candidate.paths,['a/source.mjs']);assert.equal((await candidate.readCandidate('a/source.mjs')).toString(),'before');
});
test('Windows release packaging checks immutable inputs after compile and before packaging',async()=>{
 const doc=parse(await readFile(new URL('../../../.github/workflows/nubi-desktop-windows.yml',import.meta.url),'utf8'));
 const steps=doc.jobs.windows.steps,compile=steps.findIndex(s=>s.run==='npm run compile'),audit=steps.findIndex(s=>s.run?.includes('node scripts/check-release-inputs.mjs'));
 assert(audit>compile,'source-inputs exists before immutable input audit');assert(steps[audit].run.includes('--ref $env:GITHUB_SHA'));assert(audit<steps.findIndex(s=>s.run?.includes('npm run package:windows')));
});

test('v2 resolves evaluation imports at the importing file without inventing sibling packages',async()=>{
 const f=fixture();f.files.set(desktop+'/eval/hard-10/run.mjs',Buffer.from("import {candidate} from '../candidate.mjs'; const files=['../candidate.mjs','./fixtures.mjs'];"));f.files.set(desktop+'/eval/candidate.mjs',Buffer.from('export const candidate=1;'));f.files.set(desktop+'/eval/hard-10/fixtures.mjs',Buffer.from('export const fixture=true;'));for(const [p,b] of f.files)f.source.set(p,b);
 const result=await check(f);assert.equal(result.ok,true,JSON.stringify(result.issues));assert(!result.siblings.some(r=>/candidate|hard-10/.test(r.name)));
});
test('v2 requires prebundle inputs, not generated outputs absent from source candidates',async()=>{
 const f=fixture();f.files.set(desktop+'/scripts/build.mjs',Buffer.from("await build({entryPoints:['../nubi-document-agent/src/index.mjs'],outfile:'generated/native.mjs'});"));f.manifest=Buffer.from('["runtime/entry.mjs","generated/native.mjs"]');for(const [p,b] of f.files)f.source.set(p,b);
 let result=await check(f);assert.equal(result.ok,true,JSON.stringify(result.issues));assert(!result.inputs.some(r=>r.path.includes('/generated/')));
 f.files.delete('packages/nubi-document-agent/src/index.mjs');result=await check(f);assert.equal(result.ok,false);assert(result.issues.some(r=>r.path==='packages/nubi-document-agent/src/index.mjs'));
});
test('v2 refuses a generated input with no observed producer',async()=>{
 const f=fixture();f.manifest=Buffer.from('["generated/unknown.mjs"]');const result=await check(f);assert.equal(result.ok,false);assert(result.issues.some(r=>r.code==='release_producer_missing'));
});
test('v2 verifies installed assets through the owning package declaration and lockfile',async()=>{
 const f=fixture();const pkg=desktop+'/package.json',lock=desktop+'/package-lock.json';f.files.set(desktop+'/runtime/entry.mjs',Buffer.from("import '../../nubi-document-agent/src/index.mjs'; const worker=new URL('../node_modules/fixture-dependency/worker.mjs',import.meta.url);"));f.files.set(pkg,Buffer.from('{"dependencies":{"fixture-dependency":"1.0.0"}}'));f.files.set(lock,Buffer.from('{"lockfileVersion":3,"packages":{"":{"dependencies":{"fixture-dependency":"1.0.0"}},"node_modules/fixture-dependency":{"version":"1.0.0","integrity":"sha512-fixture"}}}'));for(const [p,b] of f.files)f.source.set(p,b);
 assert.equal((await check(f)).ok,true);
 for(const bad of ['lock','declaration']){const g={...f,files:new Map(f.files)};if(bad==='lock')g.files.delete(lock);else g.files.set(pkg,Buffer.from('{}'));const result=await check(g);assert.equal(result.ok,false,bad);assert(result.issues.some(r=>r.code==='release_dependency_unlocked'||r.code==='release_dependency_undeclared'),JSON.stringify(result.issues));}
});
test('v2 rejects verification entries in the compiled source manifest',async()=>{
 const f=fixture();f.files.set(desktop+'/verification/synthetic.json',Buffer.from('{}'));f.source.set(desktop+'/verification/synthetic.json',Buffer.from('{}'));f.manifest=Buffer.from('["verification/synthetic.json"]');const result=await check(f);assert.equal(result.ok,false);assert(result.issues.some(r=>r.code==='release_verification_input'));
});
test('v2 resolves helper outfile defaults without requiring the generated worker in Git',async()=>{
 const f=fixture();f.files.set(desktop+'/scripts/build.mjs',Buffer.from("export async function buildWorker(outfile='generated/worker.mjs'){await build({entryPoints:['runtime/entry.mjs'],outfile});}"));f.manifest=Buffer.from('["generated/worker.mjs"]');for(const [p,b] of f.files)f.source.set(p,b);const result=await check(f);assert.equal(result.ok,true,JSON.stringify(result.issues));assert(result.buildOutputs.some(r=>r.path===desktop+'/generated/worker.mjs'));
});
test('v2 does not treat output directories and copy destinations as source input files',async()=>{
 const f=fixture();f.files.set(desktop+'/scripts/capture.mjs',Buffer.from("const dir=path.resolve('../../artifacts/synthetic-result');await copyFile('../nubi-document-agent/src/index.mjs','../../artifacts/synthetic-result/rendered.png');"));for(const [p,b] of f.files)f.source.set(p,b);const result=await check(f);assert.equal(result.ok,true,JSON.stringify(result.issues));
});
test('v2 binds a generated output to the unchanged build script, not just its entry file',async()=>{
 const f=fixture();const build=desktop+'/scripts/build.mjs';f.files.set(build,Buffer.from("await build({entryPoints:['runtime/entry.mjs'],outfile:'generated/worker.mjs'});"));f.manifest=Buffer.from('["generated/worker.mjs"]');f.source.set(build,Buffer.from("await build({entryPoints:['runtime/entry.mjs'],outfile:'generated/other.mjs'});"));const result=await check(f);assert.equal(result.ok,false);assert(result.issues.some(r=>r.code==='release_input_changed'&&r.path===build));
});
test('the command line audits the release documents of the package version',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const run=await exec(process.execPath,[new URL('../scripts/check-release-inputs.mjs',import.meta.url).pathname,'--ref','HEAD'],{maxBuffer:64*1024*1024}).catch(error=>error);
 assert.equal(JSON.parse(run.stdout).version,pkg.version);
});
