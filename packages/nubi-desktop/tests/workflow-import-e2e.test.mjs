import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile,mkdir,symlink,readdir} from 'node:fs/promises';import path from 'node:path';
import {fixture} from './fixtures.mjs';import {convertE2eTask} from '../runtime/workflow-import-e2e.mjs';import {validateWorkflow} from '../runtime/workflow-schema.mjs';import {loadWorkflowPackage} from '../runtime/workflow-package.mjs';
const sample=JSON.parse(await readFile(new URL('./fixtures/e2e-task-sample.json',import.meta.url),'utf8'));
test('fifteen synthetic nodes preserve references and explicit joins in a validated draft',()=>{
 const {workflow,warnings}=convertE2eTask(sample);assert.equal(workflow.steps.length,15);assert.equal(validateWorkflow(workflow).ok,true);assert.equal(warnings.length,1);assert.equal(warnings[0].nodeId,'unknown_14');assert.equal(workflow.steps[14].kind,'human');
 assert.match(workflow.steps[12].goal,/\{\{ steps.decide-7.output.output \}\}/);assert.match(workflow.steps[12].goal,/\{\{ inputs.key \}\}/);assert.equal(workflow.inputs.key.required,true);
 assert.equal(workflow.steps[10].next,'decide-12');assert.equal(workflow.steps[11].next,'decide-12');assert.equal(workflow.steps[9].then,'confirm-10');assert.equal(workflow.steps[9].else,'confirm-11');
 assert.deepEqual(workflow.steps[7].done_when,{kind:'output_schema',evidence:{min:1}});assert.equal(workflow.steps[7].budget.calls,8);assert.deepEqual(workflow.steps[7].outputs.schema.properties.output.enum,['진행','보류']);assert.deepEqual(workflow.steps[8].done_when,{kind:'file_exists',path:'out/synthetic-note.md'});
 assert.deepEqual(sample.nodes[7].id,'decide_7');
});
test('normalization collisions preserve identity and bind references to the right original node',()=>{
 const input={task_name:'합성 충돌',nodes:[{id:'Decide_A',name:'첫 판단',outputs:[{id:'output'}]},{id:'decide-a',name:'다음 판단',inputs:[{field:'첫 결과',source:'$.nodes.Decide_A.output.output'}],outputs:[{id:'output'}]}]};
 const {workflow}=convertE2eTask(input);assert.deepEqual(workflow.steps.map(s=>s.id),['decide-a','decide-a-2']);assert.match(workflow.steps[1].goal,/steps.decide-a.output.output/);assert.equal(validateWorkflow(workflow).ok,true);
});
test('missing references, duplicate source ids and executable expressions never become a runnable draft',()=>{
 for(const source of ['$.nodes.missing.output.output','$.nodes.decide_7.output.constructor','$.nodes.decide_7.output.output()']){const input=structuredClone(sample);input.nodes[12].inputs[0].source=source;assert.throws(()=>convertE2eTask(input),/workflow_import_reference/);}
 const input=structuredClone(sample);input.nodes[1].id=input.nodes[0].id;assert.throws(()=>convertE2eTask(input),/workflow_import_invalid/);
});
test('unrepresentable early termination and ambiguous routing are refused instead of running later steps',()=>{
 const input=structuredClone(sample);input.nodes[0].next=null;assert.throws(()=>convertE2eTask(input),/workflow_import_unsupported/);
 const branch=structuredClone(sample);branch.nodes[9].cases[0].next='missing';assert.throws(()=>convertE2eTask(branch),/workflow_import_reference/);
});
test('missing file output paths become explicit manual work rather than false file evidence',()=>{
 const input=structuredClone(sample);delete input.nodes[8].path;const {workflow,warnings}=convertE2eTask(input);assert.equal(workflow.steps[8].kind,'human');assert.ok(warnings.some(w=>w.nodeId==='file_change_8'));assert.equal(validateWorkflow(workflow).ok,true);
});
test('import RPC persists a validated package without running or clobbering an earlier import',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'synthetic-task.json'),JSON.stringify(sample));const first=await f.service.invoke('importE2eTask',{path:'synthetic-task.json'});const pkg=await loadWorkflowPackage(f.root,first.slug);assert.equal(pkg.workflow.steps.length,15);
 const original=await readFile(path.join(f.root,'.nubi/workflows',first.slug,'workflow.yaml'));const second=await f.service.invoke('importE2eTask',{path:'synthetic-task.json'});assert.notEqual(second.slug,first.slug);assert.deepEqual(await readFile(path.join(f.root,'.nubi/workflows',first.slug,'workflow.yaml')),original);
 for(const prefix of ['workflow-run:','setup-action:','proposal:'])assert.equal(f.service.store.list(prefix).length,0);assert.equal(f.service.store.list('task:').length,0);
 await assert.rejects(f.service.invoke('importE2eTask',{path:'../outside.json'}),/path_scope/);
});
test('linked package parents cannot redirect an imported package',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.root,'synthetic-task.json'),JSON.stringify(sample));await mkdir(path.join(f.root,'linked'));await symlink(path.join(f.root,'linked'),path.join(f.root,'.nubi'),'dir');await assert.rejects(f.service.invoke('importE2eTask',{path:'synthetic-task.json'}),/path_scope/);assert.deepEqual(await readdir(path.join(f.root,'linked')),[]);
});
test('malformed collections and incompatible branch values fail with fixed import diagnostics',()=>{
 for(const change of [input=>{input.inputs_from={};},input=>{input.nodes[0].inputs={};},input=>{input.nodes[0].outputs=[null];},input=>{input.nodes[9].cases[0]=null;}]){const input=structuredClone(sample);change(input);assert.throws(()=>convertE2eTask(input),/^Error: workflow_import_invalid$/);}
 const typed=structuredClone(sample);typed.nodes[7].outputs[0].type='boolean';assert.throws(()=>convertE2eTask(typed),/workflow_import_unsupported/);
 const labels=structuredClone(sample);labels.nodes[9].cases[0].value='다른 분기';assert.throws(()=>convertE2eTask(labels),/workflow_import_unsupported/);
 for(const path of ['', '../outside.md','/outside.md','C:\\outside.md']){const input=structuredClone(sample);input.nodes[8].path=path;assert.throws(()=>convertE2eTask(input),/workflow_import_reference/);}
});
test('inline secrets are refused before any imported package is saved',async t=>{
 const f=await fixture(t),input=structuredClone(sample);input.nodes[0].prompt_file='api_key=sk-'+('q'.repeat(40));await writeFile(path.join(f.root,'synthetic-task.json'),JSON.stringify(input));
 await assert.rejects(f.service.invoke('importE2eTask',{path:'synthetic-task.json'}),/workflow_secret_plain/);await assert.rejects(readdir(path.join(f.root,'.nubi/workflows')),/ENOENT/);
});
test('reserved source node names normalize to safe template member names',()=>{
 const input={task_name:'합성 이름 확인',nodes:[{id:'constructor',name:'합성 판단',action_type:'decision',outputs:[{id:'output'}]},{id:'decide_next',name:'합성 후속',action_type:'decision',inputs:[{field:'앞선 결과',source:'$.nodes.constructor.output.output'}],outputs:[{id:'output'}]}]};const {workflow}=convertE2eTask(input);assert.equal(workflow.steps[0].id,'step-constructor');assert.match(workflow.steps[1].goal,/steps.step-constructor.output.output/);
});
