import test from 'node:test';
import {applyGitBashEnvironment} from '../runtime/git-bash-profile.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {terminalOutputBatch} from '../electron-app/terminal-output.mjs';

function worker(platform='win32'){
 const handlers={},messages=[],callbacks={};let pauses=0,resumes=0;
 const terminal={onData(fn){callbacks.data=fn;},onExit(fn){callbacks.exit=fn;},pause(){pauses++;},resume(){resumes++;}};
 const require=name=>name==='node:os'?{release:()=> '10.0.26100'}:name.endsWith('git-bash-profile.mjs')?{applyGitBashEnvironment}:{spawn:()=>terminal};require.resolve=name=>name;
 vm.runInNewContext(readFileSync(new URL('../electron-app/terminal-worker.cjs',import.meta.url),'utf8'),{
  require,module:{exports:{}},process:{platform,env:{},connected:true,send:message=>messages.push(message),on:(name,fn)=>handlers[name]=fn}
 });
 const request=(action,args={})=>{handlers.message({requestId:messages.length+1,action,args:{id:'t',projectId:'p',...args}});return messages.at(-1);};
 return {request,callbacks,get pauses(){return pauses;},get resumes(){return resumes;}};
}

test('large parsed batches release backpressure completely and subsequent output continues',()=>{
 const host=worker();host.request('open');
 const chunk='한글 출력\x1b[32m완료\x1b[0m\r\n'.repeat(18000);
 host.callbacks.data(chunk);assert.equal(host.pauses,1);const before=host.resumes;
 assert.equal(host.request('ack',{length:chunk.length}).result.accepted,true);
 assert.equal(host.resumes,before+1,'a batch larger than 64 KiB must resume the shell');
 host.callbacks.data('다음 출력');assert.equal(host.pauses,1,'no phantom pending bytes remain');
 assert.match(host.request('ack',{length:Infinity}).error,/terminal_input_invalid/);
 assert.match(host.request('ack',{length:-1}).error,/terminal_input_invalid/);
});

test('native Windows build informs xterm resize heuristics without inventing a PowerShell version',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(worker().request('open').result.windowsPty)),{backend:'conpty',buildNumber:26100});
 assert.equal(worker('darwin').request('open').result.windowsPty,undefined);
});

test('split ANSI, Korean and surrogate pairs stay in order before the exit marker',()=>{
 const frames=new Map(),writes=[];let id=0;
 const batch=terminalOutputBatch(data=>writes.push(data),{schedule:fn=>{frames.set(++id,fn);return id;},cancel:id=>frames.delete(id)});
 batch.push('\x1b[3');batch.push('2m한글\ud83d');batch.push('\ude00\x1b[0m\r\n');
 assert.equal(frames.size,1);batch.flush();writes.push('[셸 종료 0]');
 assert.deepEqual(writes,['\x1b[32m한글😀\x1b[0m\r\n','[셸 종료 0]']);assert.equal(frames.size,0);
 batch.push('다음 출력');const fn=[...frames.values()][0];fn();assert.equal(writes.at(-1),'다음 출력');
 batch.push('폐기');batch.dispose();assert.equal(frames.size,0);
});
