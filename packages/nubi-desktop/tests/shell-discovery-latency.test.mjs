import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {powerShellExecutable,createShellProfileCache}=createRequire(import.meta.url)('../runtime/shell-discovery.cjs');
test('a verified standard PowerShell 7 install does not wait for a PATH subprocess',async()=>{
 let lookups=0;const executable=await powerShellExecutable({env:{ProgramFiles:'C:\\Program Files'},exists:async()=>{},lookup:async()=>{lookups++;throw Error('slow or blocked where.exe');}});
 assert.equal(executable,'C:\\Program Files\\PowerShell\\7\\pwsh.exe');assert.equal(lookups,0);
});
test('shell discovery coalesces concurrent reads, expires and never caches a failure',async()=>{
 let time=0,calls=0,fail=false,release;const gate=new Promise(resolve=>release=resolve);
 const discover=createShellProfileCache(async()=>{calls++;await gate;if(fail)throw Error('discovery_failed');return [{id:'bash',executable:'/verified/bash'}];},{now:()=>time,ttlMs:30});
 const a=discover('environment'),b=discover('environment');release();const [first,second]=await Promise.all([a,b]);assert.equal(calls,1);first[0].executable='mutated';assert.equal(second[0].executable,'/verified/bash');
 time=31;fail=true;await assert.rejects(discover('environment'),/discovery_failed/);fail=false;await discover('environment');assert.equal(calls,3);
 await discover('changed-environment');assert.equal(calls,4);
});
