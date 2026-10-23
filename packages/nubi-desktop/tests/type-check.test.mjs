import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {removeLater} from './helpers-cleanup.mjs';
import {checkTypes} from '../runtime/code-quality.mjs';

async function project(files){
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-types-'));removeLater(root);
 for(const [file,content] of Object.entries(files)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),content);}
 return root;
}

test('an edit that adds a type error reports only the new error, in the opencode diagnostics form',async()=>{
 const before='export const a: number = 1;\nexport const b = [1, 2].includes(1);\n';
 const root=await project({'src/main.ts':before});
 const result=await checkTypes(root,'src/main.ts',before,'export const a: number = "x";\nexport const b = [1, 2].includes(1);\n');
 assert.equal(result.state,'checked');assert.match(result.engine,/^typescript@/);
 assert.deepEqual(result.introduced.map(d=>[d.line,d.code]),[[1,'TS2322']]);
 assert.equal(result.notice,`Type errors detected in this file, please fix:\n<diagnostics file="src/main.ts">\nERROR [1:14] ${result.introduced[0].message}\n</diagnostics>`);
});

test('a call that no longer matches an imported function is found through the imported file',async()=>{
 const before="import {add} from './math';\nexport const sum = add(1, 2);\n";
 const root=await project({'src/math.ts':'export function add(a: number, b: number) { return a + b; }\n','src/main.ts':before});
 const result=await checkTypes(root,'src/main.ts',before,"import {add} from './math';\nexport const sum = add(1);\n");
 assert.deepEqual(result.introduced.map(d=>d.code),['TS2554']);
});

test('errors the file already had are counted, not reported again, even when lines move',async()=>{
 const before='const broken: number = "x";\nexport {};\n';
 const root=await project({'a.ts':before});
 const result=await checkTypes(root,'a.ts',before,'// moved\nconst broken: number = "x";\nexport {};\n');
 assert.deepEqual(result.introduced,[]);assert.equal(result.existingCount,1);assert.equal(result.notice,undefined);
});

test('plain JavaScript is checked only when it opts in with // @ts-check',async()=>{
 const root=await project({'a.js':'const n = 1;\n'});
 assert.equal((await checkTypes(root,'a.js','const n = 1;\n','const n = 1;\nn.foo();\n')).state,'skipped');
 const checked=await checkTypes(root,'a.js','// @ts-check\nconst n = 1;\n','// @ts-check\nconst n = 1;\nn.foo();\n');
 assert.equal(checked.state,'checked');assert.deepEqual(checked.introduced.map(d=>d.code),['TS2339']);
});

test('other languages are not type checked',async()=>{
 const root=await project({'a.json':'{}'});
 assert.equal((await checkTypes(root,'a.json','{}','{"a":1}')).state,'skipped');
});

test('a proposal and a new file carry the type errors they would introduce, without being refused',async t=>{
 const {fixture}=await import('./fixtures.mjs');const {ProjectService}=await import('../runtime/project-service.mjs');const {installAgent}=await import('../runtime/agent.mjs');installAgent(ProjectService);
 const {service,root}=await fixture(t),task=await service.createTask({request:'수정'});
 await writeFile(path.join(root,'calc.ts'),'export function add(a: number, b: number) { return a + b; }\n');
 const before=await service.read({taskId:task.id,path:'calc.ts'});
 const p=await service.propose({taskId:task.id,path:'calc.ts',expectedHash:before.hash,content:'export function add(a: number, b: number): string { return a + b; }\n',reason:'수정'});
 assert.equal(p.state,'proposed');assert.deepEqual(p.typeCheck.introduced.map(d=>d.code),['TS2322']);assert.match(p.typeCheck.notice,/^Type errors detected in this file, please fix:/);
 const observed=await service.inspectPath({taskId:task.id,path:'use.ts'});
 const created=await service.proposeNewFile({taskId:task.id,path:'use.ts',content:"import {add} from './calc';\nexport const n = add('1', 2);\n",reason:'새 파일',observed});
 assert.deepEqual(created.typeCheck.introduced.map(d=>d.code),['TS2345']);
});
