import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PortalWebList}=require('../electron-app/mail-portal-web-list.cjs'),{portalFetch,ORIGIN}=require('../electron-app/mail-portal-contract.cjs'),{ExternalMailPortal}=require('../electron-app/external-mail-portal.cjs');

test('the supplied web endpoint uses bounded page/count POSTs on the existing session and preserves EML bytes',async()=>{
 const calls=[],bytes=Uint8Array.from([0,255,13,10,128,65]);
 const fetch=async(url,args)=>{calls.push({url,args});return new Response(url.includes('/eml/')?bytes:JSON.stringify({headerVOs:[{mailSeq:9}],totalCount:1}));};
 const result=await portalFetch({operation:'webList',folderId:'1',page:2,count:30},{origin:ORIGIN,fetch});assert.equal(result.headerVOs[0].mailSeq,9);
 assert.equal(calls[0].url,ORIGIN+'/mail/rest/v1/mails/list?folderID=1&page=2&count=30');assert.equal(calls[0].args.method,'POST');assert.equal(calls[0].args.body,'{}');assert.equal(calls[0].args.credentials,'include');assert.equal(calls[0].args.redirect,'error');assert.equal(calls[0].args.headers.Cookie,undefined);
 const raw=await portalFetch({operation:'eml',folderId:'1',seq:'9'},{origin:ORIGIN,fetch});assert.deepEqual(Buffer.from(raw.raw,'base64'),Buffer.from(bytes));
 for(const input of [{page:0},{page:201},{count:101},{folderId:'1&other=2'}])await assert.rejects(portalFetch({operation:'webList',folderId:'1',page:1,count:30,...input},{origin:ORIGIN,fetch}),/mail_input_invalid/);
 assert.equal(calls.length,2);
});
test('web API capability errors stay distinct from expired authentication and denied access',async()=>{
 for(const [status,code] of [[404,'mail_portal_endpoint_unavailable'],[405,'mail_portal_endpoint_unavailable'],[401,'mail_portal_login'],[403,'mail_portal_forbidden'],[500,'mail_portal_unavailable']])await assert.rejects(portalFetch({operation:'webList',folderId:'1',page:1,count:30},{origin:ORIGIN,fetch:async()=>new Response('',{status})}),new RegExp(code));
});
test('page/count results retain the importer cursor across overlapping pages and keep only current metadata',async()=>{
 const adapter=new PortalWebList(),calls=[],request=async(op,args)=>{calls.push({op,args});return {headerVOs:args.page===1?[{mailSeq:9},{mailSeq:8}]:args.page===2?[{mailSeq:7},{mailSeq:8}]:[],totalCount:3};};
 assert.deepEqual((await adapter.read({folderId:'1',cursor:0},request)).liteHeaderVOs.map(r=>r.mailSeq),[9,8]);
 assert.deepEqual((await adapter.read({folderId:'1',cursor:8},request)).liteHeaderVOs.map(r=>r.mailSeq),[7,8]);
 assert.equal(adapter.summary({folderId:'1',seq:'9'}),undefined);assert.equal(adapter.summary({folderId:'1',seq:'7'}).mailSeq,7);
 assert.deepEqual((await adapter.read({folderId:'1',cursor:7},request)).liteHeaderVOs,[]);assert.deepEqual(calls.map(c=>c.args.page),[1,2,3]);
 await assert.rejects(adapter.read({folderId:'2',cursor:7},request),/mail_input_invalid/);
});
test('only a missing web route selects the existing desktop list, and authentication errors never trigger another route',async()=>{
 const adapter=new PortalWebList(),calls=[],request=async(op)=>{calls.push(op);if(op==='webList')throw Error('mail_portal_endpoint_unavailable');return {liteHeaderVOs:[]};};
 await adapter.read({folderId:'1'},request);await adapter.read({folderId:'1'},request);assert.deepEqual(calls,['webList','list','list']);
 for(const code of ['mail_portal_login','mail_portal_forbidden','mail_portal_unavailable']){const target=new PortalWebList(),called=[];await assert.rejects(target.read({folderId:'1'},async op=>{called.push(op);throw Error(code);}),new RegExp(code));assert.deepEqual(called,['webList']);}
});
test('an invalid response and a changed session cannot select another route or populate metadata',async()=>{
 const adapter=new PortalWebList();await assert.rejects(adapter.read({folderId:'1'},async()=>({headerVOs:[{mailSeq:'bad'}]})),/mail_portal_format/);assert.equal(adapter.mode,null);
 await assert.rejects(adapter.read({folderId:'1'},async()=>({headerVOs:[{mailSeq:9}]}),()=>{throw Error('mail_cancelled');}),/mail_cancelled/);assert.equal(adapter.metadata.size,0);
});
test('external collection uses the web list and existing EML import, skips known originals and does not need the desktop summary route',async()=>{
 const imported=[],requests=[],known=new Set(['portal:1:9']);
 const browser={generation:'session-1',command:async(action,{input})=>{assert.equal(action,'portalRead');requests.push(input);if(input.operation==='folders')return [{folderID:1,folderName:'받은메일함',mailCount:3}];if(input.operation==='webList')return {headerVOs:input.page===1?[{mailSeq:9},{mailSeq:8,subject:'목록 제목'}]:[{mailSeq:7}],totalCount:3};if(input.operation==='summary')throw Error('mail_portal_endpoint_unavailable');if(input.operation==='eml'){const raw=Buffer.from('Subject: Mail '+input.seq+'\r\n\r\nOriginal bytes');return {raw:raw.toString('base64'),size:raw.length};}throw Error('unexpected_operation');}};
 const portal=new ExternalMailPortal({browser,invoke:async(_,args)=>{if(args.action==='status')return {};if(args.action==='portalKnown')return {uids:[...known]};if(args.action==='portalImport'){imported.push(args);known.add(args.uid);}return {};}});
 portal.binding={generation:browser.generation,tabId:'7',origin:ORIGIN};portal.identity={setCd:''};portal.state.connected=true;
 try{await portal.sync();assert.deepEqual(imported.map(r=>r.uid),['portal:1:8','portal:1:7']);assert.equal(imported[0].metadata.subject,'목록 제목');assert.equal(Buffer.from(imported[1].raw,'base64').toString(),'Subject: Mail 7\r\n\r\nOriginal bytes');assert.deepEqual(requests.filter(r=>r.operation==='webList').map(r=>r.page),[1,2]);assert(!requests.some(r=>r.operation==='list'));assert.equal(requests.filter(r=>r.operation==='eml').length,2);
  await portal.disconnect();assert.equal(portal.webLists.mode,null);assert.equal(portal.binding,null);
 }finally{portal.dispose();}
});
