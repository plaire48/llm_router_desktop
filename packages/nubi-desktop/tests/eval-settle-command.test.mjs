import test from 'node:test';
import assert from 'node:assert/strict';
import {settleCommand} from '../eval/driver.mjs';
test('command settling yields while an admitted run has not attached its promise',async()=>{
 const service={agent:{running:true,promise:undefined},store:{get:()=>({state:'completed',recoveryState:'review'})}};
 let advanced=false;setTimeout(()=>{advanced=true;service.agent.running=false;},5);
 await settleCommand(service,'process',()=>false);assert.equal(advanced,true);
});
