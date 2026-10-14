import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ghesFetch} from '../ui/ai-workspace/hostFetch.js';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {createWorkspaceFetch}=createRequire(import.meta.url)('../electron-app/workspace-fetch.cjs');
const url='https://code.sdsdev.co.kr/api/v3/repos/Manufacturing-IT/ai_workspace/issues/1';
const account=()=>({generation:1,state:'connected',accessController:new AbortController(),status:async()=>({connected:true}),credential:async()=>({generation:1,token:'fixture-token'})});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('Workspace reconstructs empty success and cache responses without inventing a body',async t=>{
 const before=globalThis.window;t.after(()=>{globalThis.window=before;});
 for(const status of [204,205,304]){
  globalThis.window={nubi:{request:async()=>({status,body:'',headers:{}})}};
  const response=await ghesFetch(url);assert.equal(response.status,status);assert.equal(response.body,null);assert.equal(await response.text(),'');
 }
});

test('Talk like removal uses the real renderer bridge and reads back the removal',async t=>{
 const before=globalThis.window;t.after(()=>{globalThis.window=before;});
 const result=await build({entryPoints:['ui/ai-workspace/talkClient.js'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-workspace-client-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=path.join(directory,'talk.mjs');await writeFile(file,result.outputFiles[0].text);const {createTalkClient}=await import(pathToFileURL(file));
 let liked=true;const calls=[];
 globalThis.window={nubi:{request:async(method,args)=>{
  calls.push(args);assert.equal(method,'ghesFetch');assert.equal(args.headers.authorization,undefined);
  if(args.method==='DELETE'){liked=false;return {status:204,body:'',headers:{}};}
  const value=args.url.includes('/reactions?')?(liked?[{id:12,user:{id:7}}]:[]):{number:1,title:'[AI Workspace][Talk] Test',body:'<!-- e2e-talk:v1:11111111-1111-4111-8111-111111111111 -->\nTest\n<!-- /e2e-talk -->',user:{id:7,login:'nubi'},state:'open'};
  return {status:200,body:Buffer.from(JSON.stringify(value)).toString('base64'),headers:{'content-type':'application/json'}};
 }}};
 const client=createTalkClient({session:{host:'code.sdsdev.co.kr',token:'nubi-host-session',user:{id:7,login:'nubi'}}});
 assert.deepEqual(await client.like(1,false),{count:0,mine:null});assert.equal(calls.filter(c=>c.method==='DELETE').length,1);
});

test('Workspace host keeps native credentials, fixed scope and requested redirect policy',async()=>{
 const a=account(),calls=[],request=createWorkspaceFetch(a,{fetcher:async(target,options)=>{calls.push({target,options});return new Response(null,{status:204});}});
 const response=await request({url,method:'DELETE',headers:{Authorization:'renderer-token',Cookie:'discard'},redirect:'error'});
 assert.equal(response.status,204);assert.equal(response.body,'');assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-token');assert.equal(calls[0].options.headers.Cookie,undefined);assert.equal(calls[0].options.redirect,'error');
 await assert.rejects(request({url:'https://example.invalid/api/v3/user'}),/ghes_url_invalid/);
 await assert.rejects(request({url:'https://code.sdsdev.co.kr/api/v3/repos/other/private'}),/ghes_route_denied/);
});

test('a late Workspace response cannot cross logout or an account change',async()=>{
 const a=account(),response=deferred(),started=deferred();let signal;
 const request=createWorkspaceFetch(a,{fetcher:async(_target,options)=>{signal=options.signal;started.resolve();return response.promise;}});
 const pending=request({url});await started.promise;a.generation++;a.state='guest';a.accessController.abort();
 response.resolve(new Response('{"private":"old account"}'));
 await assert.rejects(pending,/ghes_session_changed/);assert.equal(signal.aborted,true);
});

test('an account change while the Workspace response body streams is rejected too',async()=>{
 const a=account(),started=deferred();let controller;
 const request=createWorkspaceFetch(a,{fetcher:async()=>new Response(new ReadableStream({start(c){controller=c;started.resolve();}}))});
 const pending=request({url});await started.promise;await new Promise(r=>setImmediate(r));a.generation++;
 controller.enqueue(new TextEncoder().encode('old response'));controller.close();await assert.rejects(pending,/ghes_session_changed/);
});


test('file app routing replaces the workspace hash instead of appending a second hash',()=>{
 const {workspaceAppUrl}=createRequire(import.meta.url)('../electron-app/workspace-community.cjs');
 const id='11111111-1111-4111-8111-111111111111';
 assert.equal(workspaceAppUrl('http://127.0.0.1:9000/w/fixture/index.html#workspace',id),'http://127.0.0.1:9000/w/fixture/index.html#workspace/site='+id);
 assert.throws(()=>workspaceAppUrl('http://127.0.0.1:9000','../bad'),/community_input/);
});


test('the 50 MiB file-app contract fits both transfer layers without enlarging ordinary API limits',async()=>{
 const {WORKSPACE_BLOB_LIMIT,workspaceTransferLimit}=createRequire(import.meta.url)('../electron-app/workspace-transfer.cjs');
 const root='https://code.sdsdev.co.kr/api/v3/repos/Manufacturing-IT/ai_workspace';
 // Include 2,000 path records and JSON wrappers in the worst-case nested base64 bound.
 const siteJson=Math.ceil(50*1024*1024/3)*4+2000*600;
 assert.ok(Math.ceil(siteJson/3)*4+1024<WORKSPACE_BLOB_LIMIT);
 assert.equal(workspaceTransferLimit(new URL(root+'/issues').pathname,24*1024*1024),24*1024*1024);
 let size=0;const request=createWorkspaceFetch(account(),{fetcher:async(_url,options)=>{size=Buffer.byteLength(options.body||'');return new Response('{"sha":"'+ 'a'.repeat(40)+'"}');}});
 const body=JSON.stringify({encoding:'utf-8',content:JSON.stringify({files:[{path:'index.html',content:Buffer.alloc(19*1024*1024,32).toString('base64')}]})});
 assert.equal((await request({url:root+'/git/blobs',method:'POST',body})).status,200);assert.ok(size>24*1024*1024);
 await assert.rejects(request({url:root+'/issues',method:'POST',body}),/ghes_body_limit/);
 assert.equal((await request({url:'https://code.sdsdev.co.kr/api/v3/user/7'})).status,200);
});
