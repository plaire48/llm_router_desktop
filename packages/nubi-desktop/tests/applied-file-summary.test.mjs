import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {hash} from '../runtime/files.mjs';
async function receipt(service,root,taskId,id,before,after,{state='applied',rel='app.txt',expectedHash=hash(before)}={}){
 const folder=path.join(service.store.directory,'proposals');await mkdir(folder,{recursive:true});const snapshot=path.join(folder,id+'.txt');await writeFile(snapshot,before);await writeFile(path.join(root,rel),after);
 const row={id,taskId,path:rel,state,before:snapshot,expectedHash,afterHash:hash(after),createdAt:`2026-10-15T12:00:0${id}.000Z`};service.store.set('proposal:'+id,row);return row;
}
test('applied file comparison matches the cumulative receipt summary, not only the last edit',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'Update file'});
 await receipt(service,root,task.id,'1','first\nsecond\n','first\nnew\n');await receipt(service,root,task.id,'2','first\nnew\n','first\nnew\nlast\n');
 const packet=await service.appliedFileSummary({taskId:task.id});assert.deepEqual(packet.totals,{added:2,removed:1});assert.equal(packet.files[0].partial,false);
 const diff=await service.appliedFileSummary({taskId:task.id,path:'app.txt',expectedHash:packet.files[0].hash});assert.equal(diff.before,'first\nsecond\n');assert.equal(diff.after,'first\nnew\nlast\n');
 await writeFile(path.join(root,'app.txt'),'user edited\n');await assert.rejects(service.appliedFileSummary({taskId:task.id,path:'app.txt',expectedHash:diff.hash}),/source_stale/);
 assert.equal((await service.appliedFileSummary({taskId:task.id})).totals,null);
});
test('unapproved, foreign-task and arbitrary paths cannot be displayed as applied changes',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'one'}),other=await service.createTask({request:'two'});
 await receipt(service,root,task.id,'1','old','new',{state:'proposed'});assert.equal((await service.appliedFileSummary({taskId:task.id})).total,0);
 await receipt(service,root,task.id,'2','old','new');
 for(const args of [{taskId:other.id,path:'app.txt'},{taskId:task.id,path:'../secret'},{taskId:task.id,path:'app.txt',expectedHash:undefined}])await assert.rejects(service.appliedFileSummary({expectedHash:hash('new'),...args}),/applied_file_missing/);
});
test('new files compare against empty content and damaged snapshots are refused',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'new'});
 const row=await receipt(service,root,task.id,'1','','hello\n',{rel:'new.txt',expectedHash:'absent'}),args={taskId:task.id,path:'new.txt',expectedHash:row.afterHash};
 assert.equal((await service.appliedFileSummary(args)).before,'');await writeFile(row.before,'tampered');await assert.rejects(service.appliedFileSummary(args),/source_stale/);
 const outside=path.join(root,'outside.txt');await writeFile(outside,'');service.store.set('proposal:1',{...row,before:outside});await assert.rejects(service.appliedFileSummary(args),/path_scope/);
});
test('broken receipt chains expose only the recent sequence and never a misleading total',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'change'});
 await receipt(service,root,task.id,'1','one\n','two\n');const row=await receipt(service,root,task.id,'2','external\n','three\n');
 const packet=await service.appliedFileSummary({taskId:task.id});assert.equal(packet.totals,null);assert.equal(packet.files[0].partial,true);
 const diff=await service.appliedFileSummary({taskId:task.id,path:row.path,expectedHash:row.afterHash});assert.equal(diff.before,'external\n');assert.equal(diff.partial,true);
});

test('a host storage path with a platform directory alias still verifies the original change',async t=>{
 const {symlink}=await import('node:fs/promises');
 const {service,root,directory}=await fixture(t),task=await service.createTask({request:'당시 변경 확인'});
 const actual=service.store.directory,alias=path.join(directory,'storage-alias');await symlink(actual,alias,'dir');service.store.directory=alias;
 const before=await service.read({taskId:task.id,path:'app.txt'});
 const p=await service.propose({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:'changed\n',reason:'변경 확인'});
 await writeFile(path.join(root,'app.txt'),p.content);await service.confirmProposal({proposalId:p.id});
 const summary=await service.appliedFileSummary({taskId:task.id});
 assert.equal(summary.files[0].state,'verified');assert.equal(summary.files[0].stats.state,'counted');
 const comparison=await service.appliedFileSummary({taskId:task.id,path:'app.txt',expectedHash:p.afterHash});assert.equal(comparison.before,before.content);assert.equal(comparison.after,p.content);
 const {unlink}=await import('node:fs/promises');const outside=path.join(root,'snapshot.txt');await writeFile(outside,before.content);await unlink(p.before);await symlink(outside,p.before);
 await assert.rejects(service.appliedFileSummary({taskId:task.id,path:'app.txt',expectedHash:p.afterHash}),/path_scope/);
});
