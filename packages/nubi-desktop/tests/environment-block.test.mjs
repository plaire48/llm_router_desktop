import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {DEVELOPMENT_GUIDANCE,environmentBlock} from '../runtime/development-workflow.mjs';
installAgent(ProjectService);
// Adopted from opencode's environment block and coding rules (2026-10-23): the model knows the OS, shell, date and git
// state before it chooses commands, and never reverts work it did not make.
test('every run states the platform, shell, local date and git branch',async t=>{
  const {service}=await fixture(t);let system='';
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){system=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');return {content:'확인했습니다.',calls:[]};}};
  const task=await service.createTask({request:'app.txt 확인'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const today=new Date();const date=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  assert.match(system,new RegExp('Environment: .*'+process.platform));assert.match(system,new RegExp(date));assert.match(system,/git repository: yes, branch [\w./-]+/);
});
test('the block reports a folder that is not a git repository',async()=>{
  const block=await environmentBlock({root:'/nonexistent-nubi-root'});assert.match(block,/git repository: no/);
});
test('development guidance keeps the codebase style and never discards work it did not make',()=>{
  assert.match(DEVELOPMENT_GUIDANCE,/consistent with the structure, naming and style of the surrounding code/);
  assert.match(DEVELOPMENT_GUIDANCE,/never revert, reset or discard changes you did not make/i);
});
