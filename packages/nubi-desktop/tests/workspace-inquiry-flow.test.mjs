import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {createWorkspaceFetch}=createRequire(import.meta.url)('../electron-app/workspace-fetch.cjs');
const repo='/api/v3/repos/Manufacturing-IT/ai_workspace';

test('inquiries use the host session for master, list, creation and uncertain-result readback',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'nubi-inquiry-'));
 const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
 t.after(async()=>{globalThis.window=previousWindow;globalThis.fetch=previousFetch;await rm(directory,{recursive:true,force:true});});
 await build({stdin:{contents:`export {loadGithubJson} from './ui/ai-workspace/githubJsonRead.js';export {createInquiryClient} from './ui/ai-workspace/inquiryClient.js';export {serviceDeskRequest,getServiceDeskSession} from './ui/ai-workspace/serviceDeskClient.js';export {setHostSession,getGithubSession} from './ui/ai-workspace/session.js';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:path.join(directory,'client.mjs'),logLevel:'silent'});
 const api=await import(pathToFileURL(path.join(directory,'client.mjs')));
 globalThis.fetch=()=>{throw Error('Renderer must never contact GHES directly');};
 const user={id:7,login:'nubi',name:'김누비'},account={generation:1,state:'connected',accessController:new AbortController(),status:async()=>({connected:account.state==='connected'}),credential:async()=>({generation:account.generation,token:'host-only-test-token'})};
 const master={items:[{id:'ERROR',label:'오류 신고',active:true}]},head='a'.repeat(40),sha='b'.repeat(40),calls=[],issues=[];
 let mode='normal',lostReceipt=false;
 const bridge=createWorkspaceFetch(account,{fetcher:async(url,options)=>{
  const u=new URL(url),route=u.pathname,method=options.method;calls.push({route,method});
  assert.equal(options.headers.Authorization,'Bearer host-only-test-token');
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status});
  if(route===repo+'/git/ref/heads/main')return mode==='denied'?response({message:'Forbidden'},403):response({object:{sha:head}});
  if(route===repo+'/contents/data/masters/inquiry-types.json'){
   assert.equal(u.searchParams.get('ref'),head);
   return mode==='missing'?response({},404):response({sha,encoding:'none'});
  }
  if(route===repo+'/git/blobs/'+sha)return response({sha,encoding:'base64',content:Buffer.from(JSON.stringify(master)).toString('base64')});
  if(route==='/api/v3/users/nubi')return response(user);
  if(route===repo+'/issues'){
   if(mode==='issues-denied')return response({},403);
   if(method==='GET')return response(issues);
   const body=JSON.parse(options.body),issue={...body,number:issues.length+1,user,state:'open',created_at:'2026-10-15T00:00:00Z',assignees:[]};issues.push(issue);
   if(lostReceipt)throw TypeError('fixture lost POST response');
   return response(issue,201);
  }
  if(route===repo+'/issues/1')return response(issues[0]);
  if(route===repo+'/issues/1/comments')return response([]);
  throw Error('Unexpected fixture route '+route);
 }});
 globalThis.window={nubi:{request:async(method,args)=>{assert.equal(method,'ghesFetch');assert.equal(new Headers(args.headers).has('authorization'),false);return bridge(args);}}};
 api.setHostSession(user);
 const load=()=>api.loadGithubJson({...api.getGithubSession(),path:'data/masters/inquiry-types.json'});
 assert.deepEqual((await load()).document,master);
 mode='missing';assert.equal(await load(),null);
 mode='denied';await assert.rejects(load(),error=>error.status===403&&error.requestUrl.endsWith('/git/ref/heads/main'));
 mode='normal';const client=api.createInquiryClient();assert.equal(client.signedIn,true);assert.deepEqual(await client.list(),[]);
 const request={session:api.getServiceDeskSession(),payload:{title:'문의 연결 확인',description:'본문 유지',type:'오류 신고',page:'앱'},requestId:'11111111-1111-4111-8111-111111111111'};
 lostReceipt=true;await assert.rejects(api.serviceDeskRequest(request),error=>error.uncertain===true);
 const receipt=await api.serviceDeskRequest({...request,verifyOnly:true});assert.equal(receipt.number,1);
 assert.equal(calls.filter(call=>call.method==='POST').length,1,'an uncertain creation is never posted twice');
 assert.equal((await client.list())[0].title,'문의 연결 확인');assert.equal((await client.detail(1)).post.body,'본문 유지');
 mode='issues-denied';await assert.rejects(client.list(),error=>error.status===403&&error.message.includes('조회 권한'));
 account.state='guest';await assert.rejects(load(),/ghes_login_required/);
});
