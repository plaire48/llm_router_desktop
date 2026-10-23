import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
const require=createRequire(import.meta.url);
const {MailPortal}=require('../electron-app/mail-portal.cjs');
const {ORIGIN,portalFetch,portalFetchSource}=require('../electron-app/mail-portal-contract.cjs');
const {safeApprovalFailure,approvalFailure}=require('../electron-app/approval-failure.cjs');
const input={operation:'approvalItem',ap:'a-1',ln:'l-2'};
const run=(input,response)=>vm.runInNewContext(`(${portalFetchSource()})(${JSON.stringify(input)})`,{location:{origin:ORIGIN},URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,btoa,fetch:async()=>response});
function host(invoke=async()=>({})){const value=new MailPortal({invoke});value.state.connected=true;value.identity={userId:'fixture'};return value;}

test('approval item POST and reconstructed MIME bytes match the supplied userscript',async()=>{
 let request;
 await portalFetch(input,{origin:ORIGIN,fetch:async(url,options)=>{request={url,...options};return new Response('[{"subject":"title","result":"body"}]');}});
 assert.equal(request.url,ORIGIN+'/approval/rest/v1/desktop/getDeskTopApItem');assert.equal(request.method,'POST');assert.equal(request.headers.Accept,'application/json');assert.equal(request.headers['Content-Type'],'application/json; charset=utf-8');assert.equal(request.headers['X-EpUserID'],undefined);assert.equal(request.body,'[{"ap":"a-1","ln":"l-2"}]');
 for(const encoding of ['latin1','utf8']){
  const raw=Buffer.from('Subject: Approval\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<table><tr><td>결재 본문</td></tr></table>');
  const value=host(async(_method,args)=>{assert.deepEqual(Buffer.from(args.raw,'base64'),raw);const parsed=await normalizePortalMail(Buffer.from(args.raw,'base64'),{includePresentation:true});return {mail:{...parsed.normalized,presentation:parsed.presentation}};});
  value.read=async()=>[{subject:'결재',result:raw.toString(encoding)}];
  const document=await value.approvalRead({id:'a',lineId:'l'});assert.match(document.mail.text,/결재 본문/);assert(document.mail.presentation);value.dispose();
 }
});

test('HTTP diagnosis survives the serialized page reader and session reader without server text',async()=>{
 for(const status of [400,401,403,404,415,429,502]){
  const response=()=>new Response('private server account value',{status});
  const packet=await run({...input,reportFailure:true},response());assert.equal(packet.httpStatus,status);assert(!JSON.stringify(packet).includes('private'));
  await assert.rejects(portalFetch(input,{origin:ORIGIN,fetch:async()=>response()}),error=>error.httpStatus===status&&!error.message.includes('private'));
  const value=host();const contents={getURL:()=>ORIGIN+'/portalapp/home',executeJavaScript:async source=>vm.runInNewContext(source,{location:{origin:ORIGIN},URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,btoa,fetch:async()=>response()})};
  await assert.rejects(value.readContents(contents,'approvalItem',input),error=>error.approvalFailure.stage==='document'&&error.approvalFailure.httpStatus===status);value.dispose();
 }
});

test('HTML login, unexpected HTML and malformed JSON have different safe reasons',async()=>{
 for(const [body,code] of [['<html><input type="password"></html>','mail_portal_login'],['<html>proxy error</html>','mail_portal_response'],['not-json','mail_portal_format']]){
  const packet=await run({...input,reportFailure:true},new Response(body));assert.equal(packet.__nubiPortalError,code);assert.equal(packet.httpStatus,200);
 }
});

test('identity, list shape, document retrieval and parsing retain their failing stage',async()=>{
 const value=host();value.identity={};await assert.rejects(value.approvals(),e=>e.approvalFailure.stage==='identity');
 value.identity={userId:'fixture'};value.read=async()=>({data:[{apId:'a'}]});await assert.rejects(value.approvals(),e=>e.approvalFailure.stage==='list'&&e.message==='mail_portal_format');
 value.read=async()=>{throw Object.assign(Error('mail_portal_unavailable'),{httpStatus:502});};await assert.rejects(value.approvalRead({id:'a',lineId:'l'}),e=>e.approvalFailure.stage==='document'&&e.approvalFailure.httpStatus===502);
 value.read=async()=>[{subject:'title',result:''}];await assert.rejects(value.approvalRead({id:'a',lineId:'l'}),e=>e.approvalFailure.stage==='parse'&&e.message==='mail_approval_empty');
 value.read=async()=>[{subject:'title',result:'raw'}];value.invoke=async()=>{throw Error('PRIVATE PARSER CONTENT');};await assert.rejects(value.approvalRead({id:'a',lineId:'l'}),e=>e.approvalFailure.stage==='parse'&&e.message==='mail_approval_parse');
 assert.equal(value.approvalCache.size,0);value.dispose();
});

test('empty or malformed documents are fetched afresh on retry',async()=>{
 const value=host(async()=>({mail:{text:'recovered'}}));let count=0;
 value.read=async()=>[{subject:'title',result:++count===1?'':'valid raw'}];
 await assert.rejects(value.approvalRead({id:'a',lineId:'l'}),/mail_approval_empty/);
 assert.equal((await value.approvalRead({id:'a',lineId:'l'})).mail.text,'recovered');assert.equal(count,2);value.dispose();
});

test('diagnostic sanitizer drops private fields and rejects unknown codes',()=>{
 assert.deepEqual(safeApprovalFailure({stage:'document',code:'mail_portal_request',httpStatus:502,url:'secret',body:'private',userId:'account'}),{stage:'document',code:'mail_portal_request',httpStatus:502});
 assert.equal(safeApprovalFailure({stage:'document',code:'private text'}),null);
 assert.equal(safeApprovalFailure({stage:'cookie',code:'mail_portal_request'}),null);
});

test('actual main dispatch awaits approval rejections and renderer restores their diagnostics',async()=>{
 const main=await readFile('electron-app/main.cjs','utf8');const start=main.indexOf('const dispatch=async('),end=main.indexOf('\n const terminalLog=boundedLog(',start);assert(start>=0&&end>start);
 for(const action of ['approvals','approvalRead','approvalTitle']){
  const dispatch=vm.runInNewContext(main.slice(start,end)+'\ndispatch',{installingUpdate:false,DESKTOP_FEATURES:{computerUse:false},invoke:async()=>({connectionMethod:'portal'}),mailPortal:{[action]:async()=>{await Promise.resolve();throw approvalFailure({message:'mail_portal_unavailable',httpStatus:502},action==='approvals'?'list':'document');}},safeApprovalFailure});
  const result=await dispatch('mail',{action});assert.equal(result.__nubiError,'mail_portal_unavailable');assert.equal(result.approvalFailure.httpStatus,502);
  const renderer=await readFile('electron-app/renderer.jsx','utf8');const line=renderer.split('\n').find(line=>line.startsWith('const request=async('));assert(line);let cleared=0;
  const request=vm.runInNewContext(line+'\nrequest',{markBusy(){},clearBusy(){cleared++;},window:{nubi:{request:async()=>result}}});
  await assert.rejects(request('mail',{action}),error=>error.approvalFailure.httpStatus===502&&error.message==='mail_portal_unavailable');assert.equal(cleared,1);
 }
});

test('portal identity takes precedence over the different mail account ID, matching userscript order',async()=>{
 const value=host();const calls=[];value.read=async(operation,args)=>{calls.push({operation,args});
  if(operation==='identityPortal')return {epUserId:83421,email:'owner@example.test'};
  if(operation==='identity')return {userId:'mail-login-name',email:'owner@example.test',setCd:'DM'};
  if(operation==='identityPolicy')return {userId:'policy-id'};
  if(operation==='folders')return [];
  if(operation==='approvals')return {data:[],totalCount:0};
 };
 const result=await value.identify();value.identity=result.identity;
 assert.equal(value.identity.userId,'83421');assert.equal(value.identity.setCd,'DM');
 await value.approvals();assert.equal(calls.at(-1).args.userId,'83421');value.dispose();
});
test('identity probes start together and never wait for another probe to start',async()=>{
 const value=host();const release=[];const calls=[];
 value.read=async operation=>{calls.push(operation);if(operation==='folders')return [];return new Promise(resolve=>release.push(()=>resolve({email:'owner@example.test',epUserId:83421})));};
 const pending=value.identify();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['identityPortal','identity','identityPolicy']);release.forEach(resolve=>resolve());await pending;value.dispose();
});
test('title and body share one in-flight document request',async()=>{
 const value=host(async()=>({mail:{text:'read once'}}));let release,calls=0;
 value.read=async()=>{calls++;return new Promise(resolve=>{release=()=>resolve([{subject:'title',result:'Content-Type: text/plain\r\n\r\nbody'}]);});};
 const title=value.approvalTitle({id:'a',lineId:'l'}),body=value.approvalRead({id:'a',lineId:'l'});
 assert.equal(calls,1);release();assert.equal((await title).subject,'title');assert.equal((await body).mail.text,'read once');assert.equal(value.approvalPending.size,0);value.dispose();
});
test('failed shared requests can retry, and an old page cannot refill a new page cache',async()=>{
 const value=host();let release,calls=0;
 value.read=async operation=>operation==='approvals'?{data:[],totalCount:0}:(calls++,new Promise(resolve=>{release=()=>resolve([{subject:'old',result:'body'}]);}));
 const old=value.approvalTitle({id:'a',lineId:'l'});await value.approvals();release();await old;assert.equal(value.approvalCache.size,0);
 value.read=async()=>{calls++;throw Error('mail_portal_timeout');};
 await assert.rejects(value.approvalTitle({id:'a',lineId:'l'}),/mail_portal_timeout/);assert.equal(value.approvalPending.size,0);
 value.read=async()=>{calls++;return [{subject:'fresh',result:'body'}];};assert.equal((await value.approvalTitle({id:'a',lineId:'l'})).subject,'fresh');assert.equal(calls,3);value.dispose();
});
