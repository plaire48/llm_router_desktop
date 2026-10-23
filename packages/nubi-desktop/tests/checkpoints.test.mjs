import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';import {existsSync} from 'node:fs';import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {checkpoint} from '../runtime/checkpoints.mjs';
installAgent(ProjectService);

test('a checkpoint records the project files without touching its repository, once per distinct state',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'수정'});
 const first=await checkpoint(service,task.id,'before_edit',{proposalId:'p1'});
 assert.match(first.tree,/^[0-9a-f]{40,64}$/);assert.equal(first.reason,'before_edit');assert.equal(first.proposalId,'p1');
 assert.equal((await checkpoint(service,task.id,'before_command')).id,first.id,'an unchanged project reuses the checkpoint');
 await writeFile(path.join(root,'app.txt'),'changed\n');
 const second=await checkpoint(service,task.id,'before_command');
 assert.notEqual(second.id,first.id);
 assert.deepEqual((await service.checkpoints({taskId:task.id})).items.map(row=>row.id),[second.id,first.id]);
 assert.ok(!existsSync(path.join(root,'.git','refs','heads','nubi')),'the project repository gets no new refs');
});

test('revert restores every file changed since the checkpoint, and undo puts the newer files back',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'수정'});
 const point=await checkpoint(service,task.id,'before_edit');
 await writeFile(path.join(root,'app.txt'),'edited by nubi\n');
 await writeFile(path.join(root,'new.txt'),'created\n');
 await rm(path.join(root,'openwiki','home.md'));
 const reverted=await service.revertCheckpoint({taskId:task.id,checkpointId:point.id});
 assert.deepEqual(reverted.files,['app.txt','new.txt','openwiki/home.md']);
 assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n');
 assert.equal(existsSync(path.join(root,'new.txt')),false);
 assert.match(await readFile(path.join(root,'openwiki','home.md'),'utf8'),/Project knowledge/);
 assert.equal(service.task(task.id).revert.checkpointId,point.id);
 assert.deepEqual((await service.checkpoints({taskId:task.id})).revert.files,['app.txt','new.txt','openwiki/home.md']);
 const undone=await service.undoRevert({taskId:task.id});
 assert.deepEqual(undone.files,['app.txt','new.txt','openwiki/home.md']);
 assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),'edited by nubi\n');
 assert.equal(await readFile(path.join(root,'new.txt'),'utf8'),'created\n');
 assert.equal(existsSync(path.join(root,'openwiki','home.md')),false);
 assert.equal(service.task(task.id).revert,undefined);
 await assert.rejects(service.undoRevert({taskId:task.id}),/revert_missing/);
});

test('revert refuses another task checkpoint and a running agent',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'a'}),other=await service.createTask({request:'b'});
 const point=await checkpoint(service,task.id,'before_edit');
 await assert.rejects(service.revertCheckpoint({taskId:other.id,checkpointId:point.id}),/checkpoint_missing/);
 service.agent={running:true};
 await assert.rejects(service.revertCheckpoint({taskId:task.id,checkpointId:point.id}),/agent_busy/);
});

test('preparing an edit and applying a new file each leave a checkpoint of the files before the change',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'수정'});
 const before=await service.read({taskId:task.id,path:'app.txt'});
 const p=await service.propose({taskId:task.id,path:'app.txt',expectedHash:before.hash,content:'changed\n',reason:'수정'});
 await service.prepareProposal({proposalId:p.id});
 const [edit]=(await service.checkpoints({taskId:task.id})).items;
 assert.equal(edit.reason,'before_edit');assert.equal(edit.proposalId,p.id);
 await writeFile(path.join(root,'app.txt'),p.content);await service.confirmProposal({proposalId:p.id});
 const observed=await service.inspectPath({taskId:task.id,path:'new.txt'});
 const created=await service.proposeNewFile({taskId:task.id,path:'new.txt',content:'new\n',reason:'새 파일',observed});
 await service.applyNewFile({proposalId:created.id});
 const [file]=(await service.checkpoints({taskId:task.id})).items;
 assert.equal(file.reason,'before_new_file');assert.equal(file.proposalId,created.id);
 await service.revertCheckpoint({taskId:task.id,checkpointId:edit.id});
 assert.equal(await readFile(path.join(root,'app.txt'),'utf8'),before.content);assert.equal(existsSync(path.join(root,'new.txt')),false);
});
