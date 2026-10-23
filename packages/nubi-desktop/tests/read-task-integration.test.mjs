import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runCodeAnalysis} from '../runtime/code-quality.mjs';
import {codeMap} from '../runtime/code-map.mjs';
import {readTasks} from '../runtime/read-task-pool.mjs';
test.after(()=>readTasks.close());
test('real syntax checks use one reusable isolated parser and preserve diagnostics',async()=>{
 const first=await runCodeAnalysis({mode:'quality',path:'x.ts',before:'const x=1;',after:'const x = ;'});assert(first.after.errorCount>0);
 const pid=readTasks.snapshot().interactive.pid;assert(pid>0&&pid!==process.pid,'code checks must leave the coordinator');
 assert.equal((await runCodeAnalysis({mode:'quality',path:'x.ts',before:'const x=1;',after:'const x=2;'})).after.errorCount,0);assert.equal(readTasks.snapshot().interactive.pid,pid);
});
test('real repository maps use their own process without executing repository code',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'read-task-integration-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'entry.ts'),`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(path.join(root,'MUST_NOT_EXIST'))},'unsafe'); export const source = 7;\n`);
 const result=await codeMap(root,['entry.ts']);assert.equal(result.files['entry.ts'].definitions[0].name,'source');assert.equal(result.summary.files,1);assert(readTasks.snapshot().repository.pid>0);assert.notEqual(readTasks.snapshot().repository.pid,readTasks.snapshot().interactive.pid);
 await assert.rejects(readFile(path.join(root,'MUST_NOT_EXIST')),error=>error.code==='ENOENT');await assert.rejects(codeMap(root,['../private.ts']),/path_scope/);
});
test('importing host read APIs does not eagerly load TypeScript into the service',async()=>{
 const source="import {createRequire} from 'node:module';const require=createRequire(import.meta.url);await import('./runtime/code-map.mjs');await import('./runtime/code-quality.mjs');console.log(!!require.cache[require.resolve('typescript')]);";
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{cwd:new URL('..',import.meta.url),env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});assert.equal(stdout.trim(),'false');
});
test('navigation projection preserves ranking while preventing large AST-derived results crossing IPC',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'read-task-projection-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'large.ts'),Array.from({length:1000},(_,i)=>`export function f${i}(){return ${i};}`).join('\n'));
 const projected=await codeMap(root,['large.ts'],{projection:'navigation'});
 assert.equal(projected.files['large.ts'].definitions.length,8,'only the symbols the host displays should cross IPC');
 assert.equal(projected.ranking[0].definitions,1000);assert.equal(projected.summary.files,1);assert.equal(projected.graph,undefined);
 const full=await codeMap(root,['large.ts']);assert.equal(full.files['large.ts'].definitions.length,1000,'full direct map contract remains available');assert.deepEqual(projected.ranking,full.ranking);
});
test('repository graph analysis does not occupy the interactive parser lane',async()=>{
 const before=readTasks.snapshot(),result=await runCodeAnalysis({mode:'repository',files:[{path:'graph.ts',content:'export const node = 1;'}]});assert.equal(result.error,undefined);
 assert.equal(readTasks.snapshot().interactive.completed,before.interactive.completed,'bulk repository analysis must not hold up short syntax and outline requests');assert(readTasks.snapshot().repository.completed>before.repository.completed);
});
test('repository-map cancellation retains the caller reason used by pause and recovery',async()=>{
 const controller=new AbortController();controller.abort(Error('provider_changed'));
 await assert.rejects(codeMap('/unused',[],{signal:controller.signal}),error=>error.message==='provider_changed');
});
