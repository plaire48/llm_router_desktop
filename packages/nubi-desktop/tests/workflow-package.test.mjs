import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadWorkflowPackage,listWorkflowPackages} from '../runtime/workflow-package.mjs';
const yaml='name: 합성 시범\nversion: 1\ntrigger: {kind: manual}\npermissions: {tools: [documents], externalWrite: never}\nsteps:\n  - {id: read, kind: tool, adapter: documents.read, args: {path: docs/example.md}}\n';
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'nubi-workflow-'));t.after(()=>rm(root,{recursive:true,force:true}));const dir=path.join(root,'.nubi/workflows/sample');await mkdir(path.join(dir,'fixtures'),{recursive:true});await writeFile(path.join(dir,'workflow.yaml'),yaml);await writeFile(path.join(dir,'README.md'),'합성 자료');await writeFile(path.join(dir,'fixtures/basic.json'),'{"ticket":"CR-12"}');return {root,dir};}
test('packages load YAML, README and fixtures and hash all package inputs',async t=>{
  const {root,dir}=await fixture(t);const first=await loadWorkflowPackage(root,'sample');
  assert.equal(first.slug,'sample');assert.equal(first.workflow.name,'합성 시범');assert.equal(first.readme,'합성 자료');assert.deepEqual(first.fixtures,{'basic.json':{ticket:'CR-12'}});
  const list=await listWorkflowPackages(root);assert.equal(list.length,1);assert.equal(list[0].valid,true);assert.equal(list[0].hash,first.hash);
  await writeFile(path.join(dir,'README.md'),'수정된 안내');assert.notEqual((await loadWorkflowPackage(root,'sample')).hash,first.hash);
  const second=await loadWorkflowPackage(root,'sample');await writeFile(path.join(dir,'fixtures/basic.json'),'{"ticket":"CR-13"}');assert.notEqual((await loadWorkflowPackage(root,'sample')).hash,second.hash);
  await writeFile(path.join(dir,'workflow.yaml'),yaml.replace('version: 1','version: 2'));assert.equal((await listWorkflowPackages(root))[0].version,2);
});
test('bad YAML and invalid definitions are listed as invalid without throwing parser text',async t=>{
  const {root,dir}=await fixture(t);await writeFile(path.join(dir,'workflow.yaml'),'name: [broken');
  const [row]=await listWorkflowPackages(root);assert.equal(row.valid,false);assert.equal(row.errors[0].code,'workflow_schema');assert.equal(JSON.stringify(row.errors).includes('broken'),false);
  await writeFile(path.join(dir,'workflow.yaml'),yaml.replace('documents.read','unknown.read'));
  assert.equal((await listWorkflowPackages(root))[0].errors[0].code,'workflow_adapter_unknown');
});
test('slug traversal and symlinks cannot escape the project or package',async t=>{
  const {root,dir}=await fixture(t);for(const slug of ['../sample','/tmp','sample/../../x','..','sample\\x'])await assert.rejects(loadWorkflowPackage(root,slug),/path_scope/);
  const outside=await mkdtemp(path.join(tmpdir(),'nubi-workflow-out-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(path.join(outside,'outside.json'),'{}');await symlink(path.join(outside,'outside.json'),path.join(dir,'fixtures/escape.json'));
  await assert.rejects(loadWorkflowPackage(root,'sample'),/path_scope/);
  await rm(path.join(dir,'fixtures/escape.json'));await symlink(outside,path.join(root,'.nubi/workflows/escape'));
  await assert.rejects(loadWorkflowPackage(root,'escape'),/path_scope/);
});
test('missing workflow directory is an empty list',async t=>{const {root}=await fixture(t);await rm(path.join(root,'.nubi/workflows'),{recursive:true});assert.deepEqual(await listWorkflowPackages(root),[]);});
test('the package loader returns validated resolved tools and rejects authored derived permissions',async t=>{
 const {root,dir}=await fixture(t);const workflow={name:'작성',version:1,permissions:{tools:['documents'],externalWrite:'never'},steps:[{id:'write',kind:'agent',goal:'초안',tools:['propose_new_file'],done_when:{kind:'file_exists',path:'memo.md'}}]};
 await writeFile(path.join(dir,'workflow.yaml'),JSON.stringify(workflow));const pkg=await loadWorkflowPackage(root,'sample');
 assert.ok(pkg.workflow.steps[0].resolvedTools.includes('inspect_path'));
 workflow.steps[0].resolvedTools=['propose_setup_action'];await writeFile(path.join(dir,'workflow.yaml'),JSON.stringify(workflow));
 await assert.rejects(loadWorkflowPackage(root,'sample'),/workflow_schema/);
});
