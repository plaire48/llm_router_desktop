import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startRelayServer} from '../eval/sim/model-session.mjs';
import {connectRelayProviders} from '../eval/sim/relay-providers.mjs';

const SECRET='sk-session-secret-value';
async function relay(complete,t){
  const directory=await mkdtemp(join(tmpdir(),'nubi-relay-')),socketPath=join(directory,'model.sock'),seen=[];
  const providers={
    // The real provider status has more fields; only a fixed subset may cross.
    status:()=>({provider:'chatgpt',model:'gpt-fixture',connected:true,vision:true,verified:true,pending:null,loginError:null,models:[{id:'gpt-fixture',label:'Fixture',contextLength:1000}],providers:[{id:'chatgpt',connected:true}],credential:{token:SECRET}}),
    complete:async(messages,tools,signal)=>{seen.push({messages,tools,signal});return complete(messages,tools,signal);}
  };
  const server=await startRelayServer({providers,socketPath});
  t.after(async()=>{await server.close();await rm(directory,{recursive:true,force:true});});
  return{socketPath,directory,seen,server};
}
const signal=()=>new AbortController().signal;

test('status and completions cross the socket unchanged',async t=>{
  const {socketPath,seen}=await relay(async messages=>({content:'답변 '+messages[0].content,calls:[{id:'c1',type:'function',function:{name:'read_selection',arguments:'{}'}}],finishReason:'tool_calls',usage:{input:3,output:1}}),t);
  const providers=await connectRelayProviders({socketPath});t.after(()=>providers.dispose());
  assert.deepEqual(providers.status(),{provider:'chatgpt',model:'gpt-fixture',connected:true,vision:true,models:[{id:'gpt-fixture',label:'Fixture'}]});
  const tools=[{type:'function',function:{name:'read_selection',parameters:{type:'object',properties:{}}}}];
  const result=await providers.complete([{role:'user',content:'안녕'}],tools,signal());
  assert.deepEqual(result,{content:'답변 안녕',calls:[{id:'c1',type:'function',function:{name:'read_selection',arguments:'{}'}}],finishReason:'tool_calls',usage:{input:3,output:1}});
  assert.deepEqual([seen[0].messages,seen[0].tools],[[{role:'user',content:'안녕'}],tools]);
});
test('concurrent requests each receive their own reply',async t=>{
  const {socketPath}=await relay(async messages=>{await new Promise(resolve=>setTimeout(resolve,messages[0].content==='slow'?40:1));return{content:messages[0].content,calls:[],finishReason:'stop'};},t);
  const providers=await connectRelayProviders({socketPath});t.after(()=>providers.dispose());
  const [slow,fast]=await Promise.all([providers.complete([{role:'user',content:'slow'}],[],signal()),providers.complete([{role:'user',content:'fast'}],[],signal())]);
  assert.deepEqual([slow.content,fast.content],['slow','fast']);
});
test('a large request and reply survive line framing',async t=>{
  const {socketPath}=await relay(async messages=>({content:messages[0].content.toUpperCase(),calls:[],finishReason:'stop'}),t);
  const providers=await connectRelayProviders({socketPath});t.after(()=>providers.dispose());
  const body='가a\n"\\'.repeat(60000);
  assert.equal((await providers.complete([{role:'user',content:body}],[],signal())).content,body.toUpperCase());
});
test('provider errors keep their code, status and retry delay and nothing else',async t=>{
  const {socketPath}=await relay(async()=>{throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:2000,body:'raw server text '+SECRET});},t);
  const providers=await connectRelayProviders({socketPath});t.after(()=>providers.dispose());
  await assert.rejects(providers.complete([{role:'user',content:'x'}],[],signal()),error=>error.message==='rate_limited'&&error.status===429&&error.retryAfterMs===2000&&error.body===undefined);
});
test('cancelling a request aborts the provider call and rejects as cancelled',async t=>{
  let aborted;
  const {socketPath}=await relay((messages,tools,remote)=>new Promise((resolve,reject)=>{aborted=new Promise(done=>remote.addEventListener('abort',()=>{done(true);reject(new Error('cancelled'));}));}),t);
  const providers=await connectRelayProviders({socketPath});t.after(()=>providers.dispose());
  const controller=new AbortController(),pending=providers.complete([{role:'user',content:'x'}],[],controller.signal);
  setTimeout(()=>controller.abort(),10);
  await assert.rejects(pending,/^Error: cancelled$/);assert.equal(await aborted,true);
  await assert.rejects(providers.complete([{role:'user',content:'x'}],[],controller.signal),/^Error: cancelled$/);
});
test('a lost connection fails open requests with a stopping error',async t=>{
  const {socketPath,server}=await relay(()=>new Promise(()=>{}),t);
  const providers=await connectRelayProviders({socketPath});
  const failed=assert.rejects(providers.complete([{role:'user',content:'x'}],[],signal()),/worker_disconnected/);
  await new Promise(resolve=>setTimeout(resolve,10));await server.close();
  await failed;
  await assert.rejects(providers.complete([{role:'user',content:'y'}],[],signal()),/worker_disconnected/);
});
test('malformed requests are refused without reaching the provider',async t=>{
  const {socketPath,seen}=await relay(async()=>({content:'ok',calls:[],finishReason:'stop'}),t);
  const replies=await new Promise((resolve,reject)=>{
    const socket=createConnection(socketPath),lines=[];let buffer='';
    socket.on('error',reject);
    socket.on('data',chunk=>{buffer+=chunk;const parts=buffer.split('\n');buffer=parts.pop();lines.push(...parts.map(line=>JSON.parse(line)));if(lines.length===3){socket.end();resolve(lines);}});
    socket.write('not json\n'+JSON.stringify({id:'a',method:'complete',messages:'text',tools:[]})+'\n'+JSON.stringify({id:'b',method:'login'})+'\n');
  });
  assert.deepEqual(replies.map(reply=>[reply.ok,reply.error.code]),[[false,'invalid_request'],[false,'invalid_request'],[false,'unknown_method']]);assert.equal(seen.length,0);
});
test('no credential value crosses the socket and the socket is private to the user',async t=>{
  const {socketPath,directory}=await relay(async()=>({content:'ok',calls:[],finishReason:'stop',credential:{token:SECRET}}),t);
  const bytes=await new Promise((resolve,reject)=>{
    const socket=createConnection(socketPath);let received='',lines=0;
    socket.on('error',reject);
    socket.on('data',chunk=>{received+=chunk;lines=received.split('\n').length-1;if(lines===2){socket.end();resolve(received);}});
    socket.write(JSON.stringify({id:'s',method:'status'})+'\n'+JSON.stringify({id:'c',method:'complete',messages:[{role:'user',content:'x'}],tools:[]})+'\n');
  });
  assert.doesNotMatch(bytes,new RegExp(SECRET));assert.doesNotMatch(bytes,/credential|token/i);
  assert.equal((await stat(directory)).mode&0o077,0);assert.equal((await stat(socketPath)).mode&0o077,0);
});
