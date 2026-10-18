import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {afterEditCheckAction} from '../runtime/development-workflow.mjs';
import {fixture} from './fixtures.mjs';
import {installApprovalPolicy} from '../runtime/approval-policy.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installApprovalPolicy(ProjectService);

test('an applied batch uses the existing verify command and binds all paths',()=>{
 const action=afterEditCheckAction({setting:{profile:'bash',script:'npm test'},applied:[{path:'a.txt',afterHash:'hash-a'},{path:'b.txt',afterHash:'hash-b'}],taskId:'t'});
 assert.equal(action.kind,'verify');assert.equal(action.script,'npm test');assert.deepEqual(action.after,['a.txt','b.txt']);
 assert.match(action.title,/편집 뒤 검사/);assert.doesNotMatch(action.effects,/파일을 바꾸지/);
 assert.equal(afterEditCheckAction({setting:null,applied:[{path:'a'}],taskId:'t'}),null);
 assert.equal(afterEditCheckAction({setting:{script:'npm test'},applied:[],taskId:'t'}),null);
});

async function setup(t){
 const f=await fixture(t),{service}=f,task=await service.createTask({request:'파일 변경 뒤 검사'});
 const profile=(await service.overview()).defaultShell;
 await service.invoke('setAfterEditCheck',{projectId:service.projectId,profile,script:'node --version'});
 return {...f,task,profile};
}
async function proposal(service,task,path,content){
 const source=await service.read({taskId:task.id,path});
 return service.propose({taskId:task.id,path,expectedHash:source.hash,content,reason:'회귀 수정'});
}
async function apply(service,root,p){await writeFile(path.join(root,p.path),p.content);return service.confirmProposal({proposalId:p.id});}

test('the final application queues one approval with current hashes; duplicate confirmation does not replay it',async t=>{
 const {service,root,task}=await setup(t);
 await writeFile(path.join(root,'other.txt'),'before');
 const a=await proposal(service,task,'app.txt','changed\n'),b=await proposal(service,task,'other.txt','changed too\n');
 await apply(service,root,a);assert.equal(service.store.list('setup-action:').length,0);
 await apply(service,root,b);
 let actions=service.store.list('setup-action:');assert.equal(actions.length,1);
 assert.equal(actions[0].state,'proposed');assert.equal(actions[0].kind,'verify');assert.equal(service.store.list('process:').length,0);
 assert.deepEqual(new Map(actions[0].references.map(r=>[r.path,r.hash])),new Map([[a.path,a.afterHash],[b.path,b.afterHash]]));
 await Promise.all([service.confirmProposal({proposalId:b.id}),service.confirmProposal({proposalId:a.id})]);
 assert.equal(service.store.list('setup-action:').length,1);
 await service.decideSetupAction({id:actions[0].id,fingerprint:actions[0].fingerprint,decision:'reject'});
 await service.confirmProposal({proposalId:b.id});assert.equal(service.store.list('setup-action:').length,1);
 assert.equal(service.store.list('setup-action:')[0].state,'rejected');
});

test('settings are project scoped, shell validated, persisted, and blank disables future checks',async t=>{
 const {service,task,root,profile}=await setup(t);
 assert.deepEqual((await service.overview()).afterEditCheck,{profile,script:'node --version'});
 await assert.rejects(()=>service.invoke('setAfterEditCheck',{projectId:'other',profile,script:'npm test'}),/project_changed/);
 await assert.rejects(()=>service.invoke('setAfterEditCheck',{projectId:service.projectId,profile:'missing',script:'npm test'}),/shell_unavailable/);
 await service.invoke('setAfterEditCheck',{projectId:service.projectId,script:''});
 assert.equal(service.store.get('setting:after-edit-check'),null);
 await apply(service,root,await proposal(service,task,'app.txt','changed\n'));
 assert.equal(service.store.list('setup-action:').length,0);
});

test('a cancelled last proposal still checks the applied subset and excludes cancelled paths',async t=>{
 const {service,root,task}=await setup(t);await writeFile(path.join(root,'other.txt'),'before');
 const a=await proposal(service,task,'app.txt','changed\n'),b=await proposal(service,task,'other.txt','unused\n');
 await apply(service,root,a);await service.cancelProposal({proposalId:b.id});
 assert.deepEqual(service.store.list('setup-action:')[0]?.references,[{path:a.path,hash:a.afterHash}]);
});

test('post-application preparation errors preserve the applied receipt and can be retried without rewriting',async t=>{
 const {service,root,task}=await setup(t);await writeFile(path.join(root,'other.txt'),'before');
 const a=await proposal(service,task,'app.txt','changed\n'),b=await proposal(service,task,'other.txt','second\n');
 await apply(service,root,a);await writeFile(path.join(root,'app.txt'),'concurrent user edit\n');await apply(service,root,b);
 assert.equal(service.store.get('proposal:'+b.id).state,'applied');assert.equal(service.store.list('setup-action:').length,0);
 assert.equal(service.task(task.id).afterEditCheckError,'source_stale');
 await writeFile(path.join(root,'app.txt'),a.content);
 await service.invoke('retryAfterEditCheck',{taskId:task.id});
 assert.equal(service.store.list('setup-action:').length,1);assert.equal(service.task(task.id).afterEditCheckError,undefined);
});

test('all paths in a large manual batch remain bound and a changed last path blocks execution',async t=>{
 const {service,root,task}=await setup(t),proposals=[];
 for(let i=0;i<12;i++){const name=`file-${i}.txt`;await writeFile(path.join(root,name),'before\n');proposals.push(await proposal(service,task,name,'after\n'));}
 for(const p of proposals)await writeFile(path.join(root,p.path),p.content);
 await Promise.all(proposals.map(p=>service.confirmProposal({proposalId:p.id})));
 const actions=service.store.list('setup-action:');assert.equal(actions.length,1);assert.equal(actions[0].references.length,12);
 await writeFile(path.join(root,proposals.at(-1).path),'changed outside approval\n');
 await assert.rejects(()=>service.decideSetupAction({id:actions[0].id,fingerprint:actions[0].fingerprint,decision:'approve'}),/setup_changed/);
 assert.equal(service.store.list('process:').length,0);
});

test('enabling does not run old edits and new-file application uses the same queue',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'새 파일도 검사'});
 await apply(service,root,await proposal(service,task,'app.txt','old applied change\n'));
 const profile=(await service.overview()).defaultShell;
 await service.setAfterEditCheck({projectId:service.projectId,profile,script:'node --version'});
 const observed=await service.inspectPath({taskId:task.id,path:'new.txt'});
 const p=await service.proposeNewFile({taskId:task.id,path:'new.txt',content:'new content\n',reason:'새 파일',observed});
 await service.applyNewFile({proposalId:p.id});
 const actions=service.store.list('setup-action:');assert.equal(actions.length,1);assert.deepEqual(actions[0].references,[{path:'new.txt',hash:p.afterHash}]);
 await service.applyNewFile({proposalId:p.id});assert.equal(service.store.list('setup-action:').length,1);
});

test('commands mode uses the original manifest allowlist and shell changes require a new decision',async t=>{
 const {service,root,task,profile}=await setup(t);
 await writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --version'}}));
 await service.setAfterEditCheck({projectId:service.projectId,profile,script:'npm test'});
 await apply(service,root,await proposal(service,task,'app.txt','changed\n'));
 service.store.set('task:'+task.id,{...service.task(task.id),state:'review'});
 await service.setApprovalMode({mode:'ask'});assert.equal((await service.autoApprovals({taskId:task.id})).command,null);
 await service.setApprovalMode({mode:'commands'});assert.equal((await service.autoApprovals({taskId:task.id})).command?.script,'npm test');
 const other=(await service.overview()).profiles.find(p=>p.id!==profile);
 if(other){await service.setShellPreference({profile:other.id});const action=service.store.list('setup-action:')[0];await assert.rejects(()=>service.decideSetupAction({id:action.id,fingerprint:action.fingerprint,decision:'approve'}),/shell_not_selected/);}
 assert.equal(service.store.list('process:').length,0);
});

test('F5 retry reports the preparation failure and path without undoing confirmed writes',async t=>{
 const {service,root,task}=await setup(t);await writeFile(path.join(root,'other.txt'),'before');
 const a=await proposal(service,task,'app.txt','after'),b=await proposal(service,task,'other.txt','after other');await apply(service,root,a);await writeFile(path.join(root,'app.txt'),'external change');await apply(service,root,b);
 await assert.rejects(service.invoke('retryAfterEditCheck',{taskId:task.id}),e=>e.message==='source_stale'&&e.details.path==='app.txt');
 assert.equal(service.task(task.id).afterEditCheckPath,'app.txt');assert(service.store.events().some(e=>e.kind==='after_edit_check_failed'&&e.value.path==='app.txt'));assert.equal(service.store.get('proposal:'+b.id).state,'applied');
});

for(const changed of ['package.json','package-lock.json','check.mjs'])test(`F13 changed ${changed} requires a command card even in commands mode`,async t=>{
 const {service,root,task,profile}=await setup(t);
 await writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node ./check.mjs'}}));
 if(changed!=='package.json')await writeFile(path.join(root,changed),changed.endsWith('.json')?'{}':'// before');
 await service.setAfterEditCheck({projectId:service.projectId,profile,script:'npm test'});
 const content=changed==='package.json'?JSON.stringify({scripts:{test:'node ./changed-check.mjs'}}):changed.endsWith('.json')?'{"lockfileVersion":3}':'// after';
 await apply(service,root,await proposal(service,task,changed,content));
 service.store.set('task:'+task.id,{...service.task(task.id),state:'review'});
 await service.setApprovalMode({mode:'commands'});
 assert.equal((await service.autoApprovals({taskId:task.id})).command,null);
 const action=service.store.list('setup-action:')[0];
 assert.equal(action.manifestChanged,true);assert.equal(action.state,'proposed');
 assert.equal(service.store.list('process:').length,0);
 await service.allowCommand({id:action.id});
 assert.equal((await service.autoApprovals({taskId:task.id})).command?.reason,'allowed');
});

test('F13 a later batch cannot bypass a pending approval by reusing an older check',async t=>{
 const {service,root,task,profile}=await setup(t);
 await writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --version'}}));
 await service.setAfterEditCheck({projectId:service.projectId,profile,script:'npm test'});
 await apply(service,root,await proposal(service,task,'app.txt','first change'));
 await apply(service,root,await proposal(service,task,'package.json',JSON.stringify({scripts:{test:'node -p 123'}})));
 await apply(service,root,await proposal(service,task,'app.txt','later change'));
 service.store.set('task:'+task.id,{...service.task(task.id),state:'review'});await service.setApprovalMode({mode:'commands'});
 assert.equal((await service.autoApprovals({taskId:task.id})).command,null);
 assert(service.store.list('setup-action:').every(action=>action.manifestChanged===true));
 assert.equal(service.store.list('process:').length,0);
});

test('F13 an in-flight approval lookup rechecks a card tainted by a concurrent batch',async t=>{
 const {service,root,task,profile}=await setup(t);
 await writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --version'}}));
 await service.setAfterEditCheck({projectId:service.projectId,profile,script:'npm test'});
 await apply(service,root,await proposal(service,task,'app.txt','first'));
 service.store.set('task:'+task.id,{...service.task(task.id),state:'review'});await service.setApprovalMode({mode:'commands'});
 const target=service.target.bind(service);let release,entered,first=true;
 const waiting=new Promise(resolve=>{entered=resolve;});
 service.target=async id=>{if(!first)return target(id);first=false;entered();return new Promise(resolve=>{release=()=>resolve(root);});};
 const pending=service.autoApprovals({taskId:task.id});await waiting;
 try{await apply(service,root,await proposal(service,task,'package.json',JSON.stringify({scripts:{test:'node -p 123'}})));}finally{release();service.target=target;}
 assert.equal((await pending).command,null);
});
