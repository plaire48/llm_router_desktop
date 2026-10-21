import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {ORIGIN,LOGIN_URL,portalFetchSource} from '../electron-app/mail-portal-contract.cjs';
const require=createRequire(import.meta.url),{MailPortal}=require('../electron-app/mail-portal.cjs'),{portalFetch,foldersOf,identityOf}=require('../electron-app/mail-portal-contract.cjs');
const eml=Buffer.from('Subject: Portal contract\r\nFrom: Alice <alice@example.test>\r\nTo: owner@example.test\r\nCc: team@example.test\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<table><tr><td>Verified body</td></tr></table><img src="https://example.invalid/track.png">');
const folders=[{folderID:1,folderName:'받은메일함',mailCount:1},{folderID:2,folderName:'보낸메일함',mailCount:1},{folderID:3,folderName:'임시보관함',mailCount:1},{folderID:4,folderName:'스팸함',mailCount:1}];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function settled(fn){for(let i=0;i<200;i++){if(fn())return;await sleep(10);}assert.fail('portal did not settle');}
test('the same-origin adapter admits only the provided read endpoints and never extracts cookies or tokens',async()=>{
 const calls=[];const run=async(input,response=new Response(JSON.stringify(folders)))=>vm.runInNewContext(`(${portalFetchSource()})(${JSON.stringify(input)})`,{location:{origin:ORIGIN},URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,btoa,fetch:async(url,args)=>{calls.push({url,args});return response;}});
 assert.deepEqual(JSON.parse(JSON.stringify(await run({operation:'folders'}))),folders);assert.equal(calls[0].args.credentials,'same-origin');assert.equal(calls[0].args.redirect,'error');assert.deepEqual(JSON.parse(calls[0].args.body),{topFolderId:'0',setCd:''});
 await assert.rejects(run({operation:'deleteMail'}),/mail_portal_action/);
 await assert.rejects(run({operation:'eml',folderId:'1',seq:'9'},new Response('<!DOCTYPE html><html><input type="password"></html>')),/mail_portal_login/);
 await assert.rejects(run({operation:'folders'},new Response('denied',{status:403})),/mail_portal_forbidden/);
 const raw=await run({operation:'eml',folderId:'1',seq:'9'},new Response(eml));assert.deepEqual(Buffer.from(raw.raw,'base64'),eml);
 await run({operation:'approvals',userId:'fixture-user',page:2},new Response('{"data":[],"totalCount":0}'));assert.equal(calls.at(-1).url,'/approval/rest/v1/desktop/list/getDeskTopApList?epid=fixture-user&pageNum=2');assert.equal(calls.at(-1).args.headers['X-EpUserID'],'fixture-user');assert.equal(calls.at(-1).args.headers['Content-Type'],undefined);assert.equal(calls.at(-1).args.body,'');
 await assert.rejects(run({operation:'approvals',userId:'fixture-user'},new Response('',{status:415})),/mail_portal_approval_request/);
 await assert.rejects(run({operation:'approvals',userId:'fixture-user'},new Response('',{status:403})),/mail_portal_approval_forbidden/);
 assert.deepEqual(foldersOf(folders).map(folder=>folder.mailbox),['inbox','sent','draft','spam']);assert.equal(identityOf({userInfo:{epUserId:'fixture-user',email:'owner@example.test',domainSet:'fixture@host'}}).setCd,'fixture');
});
test('portal EML is stored and searched with folder isolation, original hashes and no AI call for drafts/spam',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-portal-'));const mail=new PersonalMail({storageRoot:directory},{personalRoot:path.join(directory,'mail'),pull:()=>assert.fail('must not contact POP3')});t.after(async()=>{mail.dispose();await rm(directory,{recursive:true,force:true});});
 const personalFolders=foldersOf([...folders,{folderID:6,folderName:'개인 프로젝트 자료',mailCount:1}]);
 await mail.call({action:'setAutoWiki',enabled:false});await mail.call({action:'portalConnect',identity:'fixture-user',email:'owner@example.test',folders:personalFolders});
 const metadata={subject:'Portal metadata contract',localdate:'2026-10-13T12:34:00+09:00',receivedAddress:'alias@example.test',toRecipients:[{name:'alias@example.test',email:'other@example.test'}],ccRecipients:[{email:'alias@example.test'}]};
 for(const folder of personalFolders)await mail.call({action:'portalImport',uid:`portal:${folder.id}:9`,raw:eml.toString('base64'),size:eml.length,folder,metadata});
 assert.equal(mail.rows().length,5);assert.equal(mail.status().protocol,'portal');assert.equal(mail.rows().filter(row=>row.state==='collected').length,3);
 for(const id of ['1','2','3','4','6'])assert.equal((await mail.call({action:'search',query:'Verified',filters:{mailbox:'folder:'+id}})).total,1);
 const sent=(await mail.call({action:'search',query:'',filters:{mailbox:'sent'}})).results[0];assert.equal(sent.recipientRole,'sent');
 const row=mail.rows()[0],read=await mail.read(row.id,{includePresentation:true});assert.equal(read.mail.subject,'Portal metadata contract');assert.equal(read.mail.date,'2026-10-13T03:34:00.000Z');assert.equal(read.mail.recipientRole,'cc');assert.match(read.mail.text,/Verified body/);assert.match(read.mail.presentation.html,/<table>/);assert.deepEqual(read.mail.presentation.images,[]);assert.deepEqual(await mail.rawVault.read(path.join(mail.root,'raw',row.id,'message.eml')),eml);
 await mail.call({action:'portalImport',uid:'portal:1:9',raw:eml.toString('base64'),size:eml.length,folder:foldersOf(folders)[0]});assert.equal(mail.rows().length,5);assert.equal((await mail.call({action:'portalKnown'})).uids.length,5);
});
test('portal session restores without opening a login window, and expired sessions request login',async()=>{
 const calls=[];class Window{constructor(){this.webContents={session:{setPermissionRequestHandler(){}},setWindowOpenHandler(){},on(){},executeJavaScript(){}};}isDestroyed(){return false;}on(){}async loadURL(){}show(){calls.push('show');}hide(){}destroy(){}}
 const host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),BrowserWindow:Window,invoke:async(method,args)=>{calls.push(args.action);if(args.action==='portalKnown')return {uids:folders.map(folder=>`portal:${folder.folderID}:9`)};return {};}});
 host.read=async op=>op==='identity'?{userId:'fixture-user'}:op==='folders'?folders:{liteHeaderVOs:[{mailSeq:9}]};await host.restore();await settled(()=>!host.state.checking);assert.equal(host.status().connected,true);assert(!calls.includes('show'));assert(calls.includes('portalConnect'));
 host.read=async()=>{throw Error('mail_portal_login');};await assert.rejects(host.sync(),/mail_portal_login/);assert.equal(host.status().connected,false);assert.equal(host.status().error,'mail_portal_login');host.dispose();
});
test('approval reads use the portal session and the requested source, with no approval mutation endpoint',async()=>{
 const host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),invoke:async(method,args)=>{assert.equal(args.action,'portalDocument');return {mail:{subject:'Approval',text:'Read-only body'}};}});host.state.connected=true;host.identity={userId:'fixture-user'};
 const calls=[];host.read=async(op,args)=>{calls.push({op,args});if(op==='approvals')return {totalCount:1,data:[{apId:'approval-1',aplnId:'line-1',sbmDt:'2026-10-13T09:00:00Z'}]};return [{subject:'Approval contract',result:eml.toString('latin1')}];};
 const list=await host.approvals();assert.equal(list.items[0].titlePending,true);assert.equal(calls.filter(call=>call.op==='approvalItem').length,0);const title=await host.approvalTitle(list.items[0]);assert.equal(title.subject,'Approval contract');const document=await host.approvalRead({id:'approval-1',lineId:'line-1'});assert.equal(document.mail.text,'Read-only body');assert.equal(calls.filter(call=>call.op==='approvalItem').length,1);assert(calls.every(call=>['approvals','approvalItem'].includes(call.op)));await assert.rejects(host.approvalRead({id:'../other',lineId:'line-1'}),/mail_input_invalid/);host.dispose();
});
test('MIME alternatives retain useful HTML text and attachment names while keeping inline images separate',async()=>{
 const raw=Buffer.from('Subject: Mixed\r\nContent-Type: multipart/related; boundary=b\r\n\r\n--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<table><tr><td>Body table</td></tr></table><img src="cid:logo">\r\n--b\r\nContent-Type: image/png\r\nContent-ID: <logo>\r\nContent-Disposition: inline; filename="image001.png"\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="contract.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--b--');
 const mail=await normalizePortalMail(raw,{includePresentation:true});assert.match(mail.normalized.text,/Body table/);assert.equal(mail.attachments[0].presentation,'inline');assert.equal(mail.attachments[1].filename,'contract.pdf');assert.deepEqual(mail.presentation.images,[]);
});
test('the authenticated profile and own sent-mail metadata identify the account without a manual recipient form',async()=>{
 const host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),invoke:async()=>{}}),calls=[];
 host.read=async(operation,args)=>{calls.push({operation,args});if(operation==='identity')return {email:'owner@example.test'};if(operation==='folders')return folders;if(operation==='list')return {liteHeaderVOs:[{mailSeq:9}]};return {from:{userID:'fixture-user',email:'owner@example.test'}};};
 const result=await host.identify();assert.equal(result.identity.userId,'fixture-user');assert.equal(result.identity.id,'fixture-user');assert.equal(result.identity.email,'owner@example.test');assert.equal(calls.find(call=>call.operation==='summary').args.folderId,'2');host.dispose();
});
test('receivedAddress identifies the logged-in mailbox even without profile fields or sent mail',async()=>{
 const host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),invoke:async()=>{}});
 host.read=async(operation)=>operation==='identity'?{}:operation==='folders'?[folders[0]]:operation==='list'?{liteHeaderVOs:[{mailSeq:9}]}:{receivedAddress:'owner@example.test',toRecipients:[{email:'owner@example.test',userID:'owner-id'}]};
 const result=await host.identify();assert.equal(result.identity.email,'owner@example.test');assert.equal(result.identity.userId,'owner-id');assert.equal(result.identity.id,'owner-id');host.dispose();
});
test('portal login opens inside the app browser tab, closes it after identification, and a closed tab cancels the wait',async()=>{
 class Window{constructor(){this.webContents={session:{setPermissionRequestHandler(){}},setWindowOpenHandler(){},on(){},executeJavaScript(){}};}isDestroyed(){return false;}on(){}async loadURL(){}show(){throw Error('separate window must not open');}hide(){}destroy(){}}
 const pages=[],closed=[];let onClosed=null;
 const host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),BrowserWindow:Window,invoke:async()=>({}),openPage:(url,options)=>{pages.push({url,session:options.session});onClosed=options.onClosed;return {opened:true,tabId:'tab-'+pages.length};},closePage:id=>closed.push(id)});
 host.read=async op=>op==='identity'?{userId:'fixture-user',email:'owner@example.test'}:op==='folders'?folders:{liteHeaderVOs:[{mailSeq:9}]};
 host.sync=async()=>{};
 const status=await host.connect({});assert.equal(status.connected,true);assert.equal(pages.length,1);assert.equal(pages[0].url,LOGIN_URL);assert.deepEqual(closed,['tab-1']);
 await host.disconnect();assert.equal(host.page,null);
 host.read=async()=>{throw Error('mail_portal_login');};
 const pending=host.connect({});await settled(()=>pages.length===2);onClosed();
 await assert.rejects(pending,/mail_cancelled/);assert.equal(host.page,null);assert.deepEqual(closed,['tab-1','tab-2']);host.dispose();
});

function loginFixture({whiteLabel=false,backgroundExpired=false,homeOnly=false,backgroundBlocked=false,passwordField=false,authenticated=true}={}){
 const events=[],pages=[],handlers={},calls=[];
 const reply=operation=>operation==='identity'?{userId:'fixture-user',email:'owner@example.test'}:folders;
 function contents(url,{background=false,errorPage=false}={}){return {
  getURL:()=>url,isDestroyed:()=>false,isLoadingMainFrame:()=>false,stop:()=>events.push('stop'),
  session:{setPermissionRequestHandler(){},async fetch(url){const operation=Object.entries(require('../electron-app/mail-portal-contract.cjs').PATHS).find(([,route])=>route===new URL(url).pathname)?.[0];events.push('reader:'+operation);return new Response(JSON.stringify(reply(operation)),{status:backgroundExpired||whiteLabel||!authenticated?401:200});}},on:(name,handler)=>{if(background)handlers[name]=handler;},setWindowOpenHandler:handler=>{if(background)handlers.popup=handler;},
  async executeJavaScript(source){
   if(source.includes('document.querySelectorAll'))return vm.runInNewContext(source,{document:{body:{},querySelectorAll:()=>passwordField?[{getClientRects:()=>[1]}]:[]}});
   if(source.includes('document.body'))return vm.runInNewContext(source,{document:{body:{innerText:errorPage?'Whitelabel Error Page\nThis application has no explicit mapping for /error, so you are seeing this as a fallback.\nstatus=404':'Sign in'}}});
   const operation=JSON.parse(source.slice(source.lastIndexOf(')(')+2,-1)).operation;events.push((background?'reader:':'page:')+operation);
   if(!authenticated||background&&backgroundExpired)throw Error('mail_portal_login');return reply(operation);
  }
 };}
 // Like a real window: a load moves the page, except the mail origin while signed out, whose SSO redirect the guard blocks.
 class Window{constructor(){this.webContents=contents(ORIGIN,{background:true});}isDestroyed(){return false;}on(){}async loadURL(url){events.push('load:'+url);if(!(url===ORIGIN&&(whiteLabel||backgroundBlocked)))this.webContents.getURL=()=>url;}hide(){}show(){throw Error('unexpected popup');}destroy(){}}
 const portal=contents(`${ORIGIN}/portal`),sso=contents('https://sso.example.test/signin',{errorPage:whiteLabel}),home=contents(LOGIN_URL);
 // The login tab follows a navigation the host asks for, as the interactive browser does.
 home.loadURL=async url=>{events.push('tab-load:'+url);home.getURL=()=>url;};
 const host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),BrowserWindow:Window,invoke:async(_method,args)=>{calls.push(args);return {};},openPage:(url,options)=>{events.push('login:'+url);pages.push({url,options});return {tabId:'login'};},getPageContents:()=>whiteLabel?[sso]:homeOnly?[home]:[sso,portal],closePage:()=>events.push('close-login')});host.sync=async()=>{};
 return {host,events,pages,handlers,calls,contents,authenticate:()=>authenticated=true};
}
test('interactive portal login preserves the browser flow before creating the background reader',async()=>{
 const {host,events,handlers,calls}=loginFixture();
 await host.connect({});assert.equal(host.status().connected,true);
 assert.deepEqual(events,['stop','load:about:blank',`login:${LOGIN_URL}`,'page:identityPortal','page:identity','page:identityPolicy','page:folders','reader:folders','close-login']);
 assert.equal(calls.filter(c=>c.action==='portalConnect').length,1);
 const count=events.length;assert.deepEqual(handlers.popup({url:'https://sso.example.test/callback',postBody:{data:[{bytes:Buffer.from('fixture')}]}}),{action:'deny'});assert.equal(events.length,count,'background popup is never replayed as a GET');
 let prevented=false;handlers['will-redirect']({preventDefault(){prevented=true;}},'https://sso.example.test/login');assert.equal(prevented,true);host.dispose();
});
test('a visible login is not marked connected when the background session remains expired',async()=>{
 const {host,calls,events}=loginFixture({backgroundExpired:true});const pending=host.connect({});await settled(()=>events.includes('reader:folders'));await sleep(300);assert.equal(host.status().connecting,true);assert.equal(host.status().connected,false);assert(!events.includes('close-login'));assert(!calls.some(c=>c.action==='portalConnect'));await host.disconnect();await assert.rejects(pending,/mail_cancelled/);host.dispose();
});
test('Whitelabel login errors return a fixed error without collecting page contents or waiting five minutes',async()=>{
 const {host,calls}=loginFixture({whiteLabel:true});await assert.rejects(host.connect({}),/mail_portal_sso/);assert.equal(host.status().error,'mail_portal_sso');assert(!calls.some(c=>c.action==='portalConnect'));assert(!JSON.stringify(host.status()).includes('404'));host.dispose();
});
test('a portal login retry starts from kor3 and clears the failed reader document',async()=>{
 const {host,events}=loginFixture({whiteLabel:true});await assert.rejects(host.connect({}),/mail_portal_sso/);await assert.rejects(host.connect({}),/mail_portal_sso/);assert.equal(events.filter(x=>x===`login:${LOGIN_URL}`).length,2);assert.equal(events.filter(x=>x==='load:about:blank').length,2);host.dispose();
});

// Login completion must be verified by mail APIs, never guessed from a home page without password fields.
test('an idle portal home connects automatically after the shared session authenticates without navigating to mail',async()=>{
 const {host,events,calls,pages,authenticate}=loginFixture({homeOnly:true,authenticated:false});
 const pending=host.connect();await settled(()=>pages.length===1);await sleep(2200);
 assert.equal(host.status().connected,false);assert.equal(host.status().loginStage,'authenticating');
 assert(!events.includes(`load:${ORIGIN}`));assert(!events.some(event=>event.startsWith('tab-load:')));assert(!calls.some(c=>c.action==='portalConnect'));
 authenticate();await pending;assert.equal(host.status().connected,true);
 assert(!events.includes(`load:${ORIGIN}`),'no mailbox-page navigation required');assert(!events.some(event=>event.startsWith('tab-load:')));host.dispose();
});
test('a password page is not moved automatically',async()=>{
 const {host,events,pages}=loginFixture({homeOnly:true,passwordField:true,authenticated:false});
 const pending=host.connect();await settled(()=>pages.length===1);await sleep(2200);
 assert(!events.some(event=>event.startsWith('tab-load:')));assert(!events.includes(`load:${ORIGIN}`));
 await host.disconnect();await assert.rejects(pending,/mail_cancelled/);host.dispose();
});

test('closing login clears connecting state and a fresh attempt can connect immediately',async()=>{
 const {host,pages}=loginFixture();const identify=host.identify.bind(host);let rejectOld;
 host.identify=()=>new Promise((_resolve,reject)=>{rejectOld=reject;});
 const old=host.connect();await settled(()=>!!rejectOld);pages[0].options.onClosed();
 assert.equal(host.status().connecting,false);assert.equal(host.status().connected,false);
 host.identify=identify;await host.connect();assert.equal(host.status().connected,true);
 rejectOld(Error('mail_portal_login'));await assert.rejects(old,/mail_cancelled/);
 assert.equal(host.status().connected,true,'old cancellation must not overwrite the replacement connection');host.dispose();
});

test('a late failure from the previous mailbox cannot disconnect a new session',async()=>{
 const calls=[],host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),invoke:async(_method,args)=>{calls.push(args.action);return {};}});host.state.connected=true;host.identity={id:'old',setCd:''};
 let rejectRead;host.read=()=>new Promise((_resolve,reject)=>{rejectRead=reject;});
 const pending=host.sync();await settled(()=>!!rejectRead);await host.disconnect();calls.length=0;
 host.state={...host.state,connected:true};host.identity={id:'new',setCd:''};rejectRead(Error('mail_portal_login'));
 await assert.rejects(pending,/mail_cancelled/);assert.equal(host.status().connected,true);assert(!calls.includes('disconnect'));host.dispose();
});

test('a late folder list cannot overwrite the replacement mailbox folders',async()=>{
 const calls=[],host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),invoke:async(_method,args)=>{calls.push(args.action);return {};}});host.state.connected=true;host.identity={id:'old',setCd:''};
 let finishRead;host.read=()=>new Promise(resolve=>{finishRead=resolve;});
 const pending=host.sync();await settled(()=>!!finishRead);await host.disconnect();calls.length=0;
 host.state={...host.state,connected:true,folders:[{id:'new'}]};host.identity={id:'new',setCd:''};finishRead(folders);
 await assert.rejects(pending,/mail_cancelled/);assert.deepEqual(host.status().folders,[{id:'new'}]);assert(!calls.includes('portalFolders'));host.dispose();
});

test('approval list appears before slow document reads and named rows need no hydration',async()=>{
 const host=new MailPortal({invoke:async()=>{}});host.state.connected=true;host.identity={userId:'fixture-user'};
 let itemReads=0;host.read=async op=>{if(op==='approvals')return {totalCount:2,data:[{apId:'a',aplnId:'l',subject:'Named approval'},{apId:'b',aplnId:'l'}]};itemReads++;return new Promise(()=>{});};
 try{const list=await host.approvals();assert.equal(itemReads,0);assert.equal(list.items[0].titlePending,false);assert.equal(list.items[1].titlePending,true);assert.equal(list.items.length,2);}finally{host.dispose();}
});

test('approval identity is recovered from the own inbox even when email is already known',async()=>{
 const host=new MailPortal({invoke:async()=>{}});
 host.read=async op=>op==='identity'?{email:'owner@example.test'}:op==='folders'?[folders[0]]:op==='list'?{liteHeaderVOs:[{mailSeq:9}]}:{receivedAddress:'owner@example.test',toRecipients:[{email:'other@example.test',userID:'wrong'},{email:'owner@example.test',userID:'owner-id'}]};
 const result=await host.identify();assert.equal(result.identity.userId,'owner-id');assert.equal(result.identity.email,'owner@example.test');host.dispose();
});
test('a different received mailbox cannot supply the approval identity',async()=>{
 const host=new MailPortal({invoke:async()=>{}});
 host.read=async op=>op==='identity'?{email:'owner@example.test'}:op==='folders'?[folders[0]]:op==='list'?{liteHeaderVOs:[{mailSeq:9}]}:{receivedAddress:'other@example.test',toRecipients:[{email:'other@example.test',userID:'wrong'}]};
 const result=await host.identify();assert.equal(result.identity.userId,null);assert.equal(result.identity.email,'owner@example.test');host.dispose();
});
test('approval request errors do not erase a working mail session; actual login expiry still disconnects',async()=>{
 for(const operation of ['approvals','approvalItem'])for(const code of ['mail_portal_approval_request','mail_portal_approval_forbidden','mail_portal_unavailable','mail_portal_timeout','mail_portal_login']){
  const calls=[],host=new MailPortal({invoke:async(_method,args)=>{calls.push(args.action);return {};}});host.state.connected=true;host.identity={userId:'fixture-user'};
  host.read=async()=>{throw Error(code);};
  await assert.rejects(host[operation](operation==='approvalItem'?{id:'a',lineId:'l'}:{}));
  assert.equal(host.state.connected,code!=='mail_portal_login',operation+':'+code);assert.equal(calls.includes('disconnect'),code==='mail_portal_login');host.dispose();
 }
});

test('identity projection accepts nested numeric EP IDs and excludes token and unrelated identities',async()=>{
 const calls=[];const data={data:{userInfo:{epUserID:123456,receivedAddress:'owner@example.test',domainSet:'DM@company',token:'never return'}},recipients:[{userId:'other'}],accessToken:'secret'};
 const result=await portalFetch({operation:'identityPolicy'},{origin:ORIGIN,fetch:async(url,args)=>{calls.push({url,args});return new Response(JSON.stringify(data));}});
 assert.equal(identityOf(result).userId,'123456');assert.equal(identityOf(result).email,'owner@example.test');assert.equal(identityOf(result).setCd,'DM');
 assert(!JSON.stringify(result).includes('secret'));assert(!JSON.stringify(result).includes('never return'));assert(!JSON.stringify(result).includes('other'));
 assert.equal(calls[0].url,ORIGIN+'/mail/rest/v1/mails/desktop/auth/policy?svcSectCd=DM');assert.equal(calls[0].args.body,'');
});
test('approval retries identity through authenticated policy without forcing a second login',async()=>{
 const host=new MailPortal({invoke:async()=>({})});host.state.connected=true;host.identity={id:'owner@example.test',email:'owner@example.test'};
 const calls=[];host.read=async operation=>{calls.push(operation);if(operation==='identity')return {email:'owner@example.test'};if(operation==='identityPolicy')return {epUserId:'owner-id',email:'owner@example.test'};if(operation==='folders')return folders;if(operation==='approvals')return {totalCount:0,data:[]};throw Error('unexpected_read');};
 assert.deepEqual((await host.approvals()).items,[]);assert.equal(host.identity.userId,'owner-id');assert.equal(host.status().connected,true);assert.deepEqual(calls,['identityPortal','identity','identityPolicy','folders','approvals']);host.dispose();
});
test('approval identity failure preserves mail connection and rejects a changed account',async()=>{
 const host=new MailPortal({invoke:async()=>({})});host.state.connected=true;host.identity={id:'owner@example.test',email:'owner@example.test'};
 host.identify=async()=>({identity:{id:'other',userId:'other',email:'other@example.test'},folders:[]});
 await assert.rejects(host.approvals(),/mail_portal_identity/);assert.equal(host.identity.email,'owner@example.test');assert.equal(host.status().connected,true);host.dispose();
});

test('portal session identity uses GET and projects only the allowed profile fields in the renderer',async()=>{
 const calls=[],data={data:{sessionInfo:{epUserId:83421,email:'owner@example.test',domainSet:'DM@host',token:'private-session-value'}},accessToken:'private-access-value',users:[{userId:'unrelated'}]};
 const result=await vm.runInNewContext(`(${portalFetchSource()})({operation:'identityPortal'})`,{location:{origin:ORIGIN},URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,fetch:async(url,args)=>{calls.push({url,args});return new Response(JSON.stringify(data));}});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{epUserId:'83421',email:'owner@example.test',domainSet:'DM@host'});
 assert.equal(calls[0].url,'/portal/user/rest/v1/get/session/token');assert.equal(calls[0].args.method,'GET');assert.equal(calls[0].args.body,undefined);assert.equal(calls[0].args.headers['Content-Type'],undefined);assert.equal(calls[0].args.credentials,'same-origin');
});
test('approval list recovers the EP ID from the portal session when mail profiles have only an address',async()=>{
 const calls=[],host=new MailPortal({invoke:async()=>({})});host.state.connected=true;host.identity={id:'owner@example.test',email:'owner@example.test'};
 host.read=async(operation,args)=>{calls.push({operation,args});if(operation==='identity')return {email:'owner@example.test'};if(operation==='identityPolicy')return {};if(operation==='identityPortal')return {epUserId:83421,email:'owner@example.test'};if(operation==='folders')return [];if(operation==='approvals')return {data:[{apId:'a',aplnId:'l',subject:'Recovered approval'}],totalCount:1};throw Error('unexpected_read');};
 const result=await host.approvals();assert.equal(result.items[0].subject,'Recovered approval');assert.equal(calls.at(-1).args.userId,'83421');assert.equal(host.state.connected,true);assert.deepEqual(calls.map(c=>c.operation),['identityPortal','identity','identityPolicy','folders','approvals']);host.dispose();
});
test('missing portal profile does not break mail and cannot borrow a different account EP ID',async()=>{
 for(const profile of [null,{epUserId:'other',email:'other@example.test'}]){
  const host=new MailPortal({invoke:async()=>({})});host.state.connected=true;host.identity={id:'owner@example.test',email:'owner@example.test'};
  host.read=async operation=>{if(operation==='identity')return {email:'owner@example.test'};if(operation==='identityPolicy')return {};if(operation==='identityPortal'){if(!profile)throw Error('mail_portal_request');return profile;}if(operation==='folders')return [];assert.fail('must not query approval with an unverified identity');};
  await assert.rejects(host.approvals(),error=>error.message==='mail_portal_identity'&&error.approvalFailure.stage==='identity');assert.equal(host.state.connected,true);assert.equal(host.identity.email,'owner@example.test');host.dispose();
 }
});
test('own sent-folder fallback accepts numeric IDs and rejects a mismatched sender',async()=>{
 for(const email of ['owner@example.test','other@example.test']){
  const host=new MailPortal({invoke:async()=>({})});host.read=async operation=>{if(operation==='identity')return {email:'owner@example.test'};if(['identityPolicy','identityPortal'].includes(operation))return {};if(operation==='folders')return [{folderID:2,folderName:'발신함'}];if(operation==='list')return {liteHeaderVOs:[{mailSeq:9}]};return {from:{epID:83421,email}};};
  const result=await host.identify();assert.equal(result.identity.userId,email==='owner@example.test'?'83421':null);assert.equal(result.identity.email,'owner@example.test');host.dispose();
 }
});

test('403 during interactive login waits without closing and recovers on authentication',async()=>{
 const {host,events,calls}=loginFixture();const identify=host.identify.bind(host);let probes=0,ready=false;
 host.identify=async epoch=>{probes++;if(!ready)throw Error('mail_portal_forbidden');return identify(epoch);};
 const pending=host.connect();await settled(()=>probes===1);await sleep(300);
 assert.equal(host.status().connecting,true);assert.equal(host.status().error,null);assert(!events.includes('close-login'));assert.equal(probes,1);
 ready=true;await pending;assert.equal(host.status().connected,true);assert.equal(calls.filter(c=>c.action==='portalConnect').length,1);host.dispose();
});

test('a delayed shared-session verification remains in the same login and can recover',async()=>{
 const {host,events,calls}=loginFixture();const readSession=host.readSession.bind(host);let checks=0,ready=false;
 host.readSession=async(...args)=>{checks++;if(!ready)throw Error('mail_portal_forbidden');return readSession(...args);};
 const pending=host.connect();await settled(()=>checks===1);await sleep(300);
 assert.equal(host.status().connecting,true);assert(!events.includes('close-login'));assert(!calls.some(c=>c.action==='portalConnect'));
 ready=true;await pending;assert.equal(host.status().connected,true);assert.equal(calls.filter(c=>c.action==='portalConnect').length,1);host.dispose();
});

test('a closing SSO page cannot strand the login while an error-page probe is pending',async()=>{
 const {EventEmitter}=await import('node:events');
 const {host}=loginFixture();let reading=false,ready=false;
 const old=new EventEmitter();Object.assign(old,{getURL:()=>ORIGIN,isDestroyed:()=>false,isLoadingMainFrame:()=>false,executeJavaScript:()=>{reading=true;return new Promise(()=>{});}});
 let rows=[old];host.getPageContents=()=>rows;host.identify=async()=>{if(!ready)throw Error('mail_portal_forbidden');return {identity:{id:'fixture'},folders:[]};};host.readSession=async()=>folders;
 const pending=host.connect();await settled(()=>reading);rows=[];ready=true;old.emit('destroyed');
 assert.equal((await pending).connected,true);assert.equal(old.eventNames().length,0);host.dispose();
});

test('a login whose session check keeps failing stops after three checks and offers POP3 instead of probing on its own',async()=>{
 const {host,calls}=loginFixture();let probes=0;
 host.identify=async()=>{probes++;throw Error('mail_portal_forbidden');};
 await assert.rejects(host.connect(),/mail_portal_login_failed/);
 assert.equal(probes,3);assert.equal(host.status().connecting,false);assert.equal(host.status().fallback,'pop3');
 assert(!calls.some(c=>c.action==='portalConnect'));host.dispose();
});
