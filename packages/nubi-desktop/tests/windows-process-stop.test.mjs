import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {stopWindowsProcess} from '../runtime/windows-process-stop.mjs';
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function until(check){const end=Date.now()+2000;while(!check()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert(check(),'stop callback did not settle');}
function child(){return Object.assign(new EventEmitter(),{pid:123,exitCode:null});}
test('Windows cancellation retries only the still-owned process tree without a shell',async()=>{
 const process=child(),calls=[];let active=true;
 stopWindowsProcess(process,{isActive:()=>active,retryMs:1,systemRoot:'C:\\Windows',execute:(file,args,options,done)=>{
  calls.push({file,args,options});if(calls.length===1){done(Error('startup race'));return;}
  active=false;process.exitCode=1;process.emit('close');done();
 }});await until(()=>!active);assert.equal(calls.length,2);assert.equal(calls[0].file,'C:\\Windows\\System32\\taskkill.exe');assert.deepEqual(calls[0].args,['/PID','123','/T','/F']);assert.equal(calls[0].options.shell,false);
});
test('Windows stop does not retry an exited PID or declare an unconfirmed stop successful',async()=>{
 const process=child();let calls=0,uncertain=0;
 stopWindowsProcess(process,{isActive:()=>true,retryMs:1,onUnconfirmed:()=>uncertain++,execute:(_file,_args,_options,done)=>{calls++;process.exitCode=0;done();}});
 await until(()=>uncertain===1);assert.equal(calls,1);assert.equal(uncertain,1);
 const running=child();calls=0;uncertain=0;
 stopWindowsProcess(running,{isActive:()=>true,retryMs:1,onUnconfirmed:()=>uncertain++,execute:(_file,_args,_options,done)=>{calls++;done(Error('denied'));}});
 await until(()=>uncertain===1);assert.equal(calls,3);assert.equal(uncertain,1);assert.equal(running.exitCode,null);
});
test('a close event cancels a scheduled Windows stop retry',async()=>{
 const process=child();let calls=0;
 stopWindowsProcess(process,{isActive:()=>true,retryMs:10,execute:(_file,_args,_options,done)=>{calls++;done();}});process.emit('close');await pause();assert.equal(calls,1);assert.equal(process.listenerCount('close'),0);
});
