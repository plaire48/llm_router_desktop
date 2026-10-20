import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {desktopUsage} from '../runtime/usage.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);
test('usage reset API clears the local ledger without changing conversation records or account quota',async t=>{
 const {service}=await fixture(t);const task=await service.createTask({request:'Preserve this conversation'});const before=structuredClone(service.task(task.id));
 const quota={accountUsage:{data:{windows:[{remaining:75}]}}};service.providers={usageStatus:()=>quota,dispose(){}};
 const ledger=desktopUsage(service),id=ledger.start({provider:'chatgpt'});ledger.finish(id,{prompt_tokens:10,completion_tokens:2,total_tokens:12});
 const result=await service.invoke('usage',{action:'reset'});assert.equal(result.usage.total.chatgpt.total,0);
 assert.deepEqual(service.task(task.id),before);assert.deepEqual((await service.usage()).accountUsage,quota.accountUsage);
});
