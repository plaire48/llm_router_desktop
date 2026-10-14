import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PersonalMail} from '../runtime/mail.mjs';
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
 await assert.rejects(run({operation:'eml',folderId:'1',seq:'9'},new Response('<!DOCTYPE html><html>Login</html>')),/mail_portal_login/);
 await assert.rejects(run({operation:'folders'},new Response('denied',{status:403})),/mail_portal_login/);
 const raw=await run({operation:'eml',folderId:'1',seq:'9'},new Response(eml));assert.deepEqual(Buffer.from(raw.raw,'base64'),eml);
 await run({operation:'approvals',userId:'fixture-user',page:2},new Response('{"data":[],"totalCount":0}'));assert.equal(calls.at(-1).url,'/approval/rest/v1/desktop/list/getDeskTopApList?epid=fixture-user&pageNum=2');assert.equal(calls.at(-1).args.headers['X-EpUserID'],'fixture-user');
 assert.deepEqual(foldersOf(folders).map(folder=>folder.mailbox),['inbox','sent','draft','spam']);assert.equal(identityOf({userInfo:{epUserId:'fixture-user',email:'owner@example.test',domainSet:'fixture@host'}}).setCd,'fixture');
});
test('portal EML is stored and searched with folder isolation, original hashes and no AI call for drafts/spam',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-portal-'));const mail=new PersonalMail({storageRoot:directory},{personalRoot:path.join(directory,'mail'),pull:()=>assert.fail('must not contact POP3')});t.after(async()=>{mail.dispose();await rm(directory,{recursive:true,force:true});});
 await mail.call({action:'setAutoWiki',enabled:false});await mail.call({action:'portalConnect',identity:'fixture-user',email:'owner@example.test',folders:foldersOf(folders)});
 const metadata={subject:'Portal metadata contract',localdate:'2026-10-13T12:34:00+09:00',receivedAddress:'alias@example.test',toRecipients:[{name:'alias@example.test',email:'other@example.test'}],ccRecipients:[{email:'alias@example.test'}]};
 for(const folder of foldersOf(folders))await mail.call({action:'portalImport',uid:`portal:${folder.id}:9`,raw:eml.toString('base64'),size:eml.length,folder,metadata});
 assert.equal(mail.rows().length,4);assert.equal(mail.status().protocol,'portal');assert.equal(mail.rows().filter(row=>row.state==='collected').length,2);
 for(const id of ['1','2','3','4'])assert.equal((await mail.call({action:'search',query:'Verified',filters:{mailbox:'folder:'+id}})).total,1);
 const sent=(await mail.call({action:'search',query:'',filters:{mailbox:'sent'}})).results[0];assert.equal(sent.recipientRole,'sent');
 const row=mail.rows()[0],read=await mail.read(row.id,{includePresentation:true});assert.equal(read.mail.subject,'Portal metadata contract');assert.equal(read.mail.date,'2026-10-13T03:34:00.000Z');assert.equal(read.mail.recipientRole,'cc');assert.match(read.mail.text,/Verified body/);assert.match(read.mail.presentation.html,/<table>/);assert.deepEqual(read.mail.presentation.images,[]);assert.deepEqual(await readFile(path.join(mail.root,'raw',row.id,'message.eml')),eml);
 await mail.call({action:'portalImport',uid:'portal:1:9',raw:eml.toString('base64'),size:eml.length,folder:foldersOf(folders)[0]});assert.equal(mail.rows().length,4);assert.equal((await mail.call({action:'portalKnown'})).uids.length,4);
});
test('portal session restores without opening a login window, and expired sessions request login',async()=>{
 const calls=[];class Window{constructor(){this.webContents={session:{setPermissionRequestHandler(){}},setWindowOpenHandler(){},on(){},executeJavaScript(){}};}isDestroyed(){return false;}on(){}async loadURL(){}show(){calls.push('show');}hide(){}destroy(){}}
 const host=new MailPortal({BrowserWindow:Window,invoke:async(method,args)=>{calls.push(args.action);if(args.action==='portalKnown')return {uids:folders.map(folder=>`portal:${folder.folderID}:9`)};return {};}});
 host.read=async op=>op==='identity'?{userId:'fixture-user'}:op==='folders'?folders:{liteHeaderVOs:[{mailSeq:9}]};await host.restore();await settled(()=>!host.state.checking);assert.equal(host.status().connected,true);assert(!calls.includes('show'));assert(calls.includes('portalConnect'));
 host.read=async()=>{throw Error('mail_portal_login');};await assert.rejects(host.sync(),/mail_portal_login/);assert.equal(host.status().connected,false);assert.equal(host.status().error,'mail_portal_login');host.dispose();
});
test('approval reads use the portal session and the requested source, with no approval mutation endpoint',async()=>{
 const host=new MailPortal({invoke:async(method,args)=>{assert.equal(args.action,'portalDocument');return {mail:{subject:'Approval',text:'Read-only body'}};}});host.state.connected=true;host.identity={userId:'fixture-user'};
 const calls=[];host.read=async(op,args)=>{calls.push({op,args});if(op==='approvals')return {totalCount:1,data:[{apId:'approval-1',aplnId:'line-1',sbmDt:'2026-10-13T09:00:00Z'}]};return [{subject:'Approval contract',result:eml.toString('latin1')}];};
 const list=await host.approvals();assert.equal(list.items[0].subject,'Approval contract');const document=await host.approvalRead({id:'approval-1',lineId:'line-1'});assert.equal(document.mail.text,'Read-only body');assert.equal(calls.filter(call=>call.op==='approvalItem').length,1);assert(calls.every(call=>['approvals','approvalItem'].includes(call.op)));await assert.rejects(host.approvalRead({id:'../other',lineId:'line-1'}),/mail_input_invalid/);host.dispose();
});
test('MIME alternatives retain useful HTML text and attachment names while keeping inline images separate',async()=>{
 const raw=Buffer.from('Subject: Mixed\r\nContent-Type: multipart/related; boundary=b\r\n\r\n--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<table><tr><td>Body table</td></tr></table><img src="cid:logo">\r\n--b\r\nContent-Type: image/png\r\nContent-ID: <logo>\r\nContent-Disposition: inline; filename="image001.png"\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--b\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="contract.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nYWJj\r\n--b--');
 const mail=await normalizePortalMail(raw,{includePresentation:true});assert.match(mail.normalized.text,/Body table/);assert.equal(mail.attachments[0].presentation,'inline');assert.equal(mail.attachments[1].filename,'contract.pdf');assert.deepEqual(mail.presentation.images,[]);
});
test('the authenticated profile and own sent-mail metadata identify the account without a manual recipient form',async()=>{
 const host=new MailPortal({invoke:async()=>{}}),calls=[];
 host.read=async(operation,args)=>{calls.push({operation,args});if(operation==='identity')return {email:'owner@example.test'};if(operation==='folders')return folders;if(operation==='list')return {liteHeaderVOs:[{mailSeq:9}]};return {from:{userID:'fixture-user',email:'owner@example.test'}};};
 const result=await host.identify();assert.equal(result.identity.userId,'fixture-user');assert.equal(result.identity.id,'fixture-user');assert.equal(result.identity.email,'owner@example.test');assert.equal(calls.find(call=>call.operation==='summary').args.folderId,'2');host.dispose();
});
test('receivedAddress identifies the logged-in mailbox even without profile fields or sent mail',async()=>{
 const host=new MailPortal({invoke:async()=>{}});
 host.read=async(operation)=>operation==='identity'?{}:operation==='folders'?[folders[0]]:operation==='list'?{liteHeaderVOs:[{mailSeq:9}]}:{receivedAddress:'owner@example.test',toRecipients:[{email:'owner@example.test',userID:'owner-id'}]};
 const result=await host.identify();assert.equal(result.identity.email,'owner@example.test');assert.equal(result.identity.userId,'owner-id');assert.equal(result.identity.id,'owner-id');host.dispose();
});
test('portal login opens inside the app browser tab, closes it after identification, and a closed tab cancels the wait',async()=>{
 class Window{constructor(){this.webContents={session:{setPermissionRequestHandler(){}},setWindowOpenHandler(){},on(){},executeJavaScript(){}};}isDestroyed(){return false;}on(){}async loadURL(){}show(){throw Error('separate window must not open');}hide(){}destroy(){}}
 const pages=[],closed=[];let onClosed=null;
 const host=new MailPortal({BrowserWindow:Window,invoke:async()=>({}),openPage:(url,options)=>{pages.push({url,session:options.session});onClosed=options.onClosed;return {opened:true,tabId:'tab-'+pages.length};},closePage:id=>closed.push(id)});
 host.read=async op=>op==='identity'?{userId:'fixture-user',email:'owner@example.test'}:op==='folders'?folders:{liteHeaderVOs:[{mailSeq:9}]};
 host.sync=async()=>{};
 const status=await host.connect({});assert.equal(status.connected,true);assert.equal(pages.length,1);assert.equal(pages[0].url,LOGIN_URL);assert.deepEqual(closed,['tab-1']);
 await host.disconnect();assert.equal(host.page,null);
 host.read=async()=>{throw Error('mail_portal_login');};
 const pending=host.connect({});await settled(()=>pages.length===2);onClosed();
 await assert.rejects(pending,/mail_cancelled/);assert.equal(host.page,null);assert.deepEqual(closed,['tab-1','tab-2']);host.dispose();
});

function loginFixture({whiteLabel=false,backgroundExpired=false}={}){
 const events=[],pages=[],handlers={},calls=[];
 const reply=operation=>operation==='identity'?{userId:'fixture-user',email:'owner@example.test'}:folders;
 function contents(url,{background=false,errorPage=false}={}){return {
  getURL:()=>url,isDestroyed:()=>false,isLoadingMainFrame:()=>false,stop:()=>events.push('stop'),
  session:{setPermissionRequestHandler(){}},on:(name,handler)=>{if(background)handlers[name]=handler;},setWindowOpenHandler:handler=>{if(background)handlers.popup=handler;},
  async executeJavaScript(source){
   if(source.includes('document.body'))return vm.runInNewContext(source,{document:{body:{innerText:errorPage?'Whitelabel Error Page\nThis application has no explicit mapping for /error, so you are seeing this as a fallback.\nstatus=404':'Sign in'}}});
   const operation=JSON.parse(source.slice(source.lastIndexOf(')(')+2,-1)).operation;events.push((background?'reader:':'page:')+operation);
   if(background&&backgroundExpired)throw Error('mail_portal_login');return reply(operation);
  }
 };}
 class Window{constructor(){this.webContents=contents(ORIGIN,{background:true});}isDestroyed(){return false;}on(){}async loadURL(url){events.push('load:'+url);}hide(){}show(){throw Error('unexpected popup');}destroy(){}}
 const portal=contents(`${ORIGIN}/portal`),sso=contents('https://sso.example.test/signin',{errorPage:whiteLabel});
 const host=new MailPortal({BrowserWindow:Window,invoke:async(_method,args)=>{calls.push(args);return {};},openPage:(url,options)=>{events.push('login:'+url);pages.push({url,options});return {tabId:'login'};},getPageContents:()=>whiteLabel?[sso]:[sso,portal],closePage:()=>events.push('close-login')});host.sync=async()=>{};
 return {host,events,pages,handlers,calls,contents};
}
test('interactive portal login preserves the browser flow before creating the background reader',async()=>{
 const {host,events,handlers,calls}=loginFixture();
 await host.connect({});assert.equal(host.status().connected,true);
 assert.deepEqual(events,['stop','load:about:blank',`login:${LOGIN_URL}`,'page:identity','page:folders',`load:${ORIGIN}`,'reader:folders','close-login']);
 assert.equal(calls.filter(c=>c.action==='portalConnect').length,1);
 const count=events.length;assert.deepEqual(handlers.popup({url:'https://sso.example.test/callback',postBody:{data:[{bytes:Buffer.from('fixture')}]}}),{action:'deny'});assert.equal(events.length,count,'background popup is never replayed as a GET');
 let prevented=false;handlers['will-redirect']({preventDefault(){prevented=true;}},'https://sso.example.test/login');assert.equal(prevented,true);host.dispose();
});
test('a visible login is not marked connected when the background session remains expired',async()=>{
 const {host,calls}=loginFixture({backgroundExpired:true});await assert.rejects(host.connect({}),/mail_portal_login/);assert.equal(host.status().connected,false);assert(!calls.some(c=>c.action==='portalConnect'));host.dispose();
});
test('Whitelabel login errors return a fixed error without collecting page contents or waiting five minutes',async()=>{
 const {host,calls}=loginFixture({whiteLabel:true});await assert.rejects(host.connect({}),/mail_portal_sso/);assert.equal(host.status().error,'mail_portal_sso');assert(!calls.some(c=>c.action==='portalConnect'));assert(!JSON.stringify(host.status()).includes('404'));host.dispose();
});
test('a portal login retry starts from kor3 and clears the failed reader document',async()=>{
 const {host,events}=loginFixture({whiteLabel:true});await assert.rejects(host.connect({}),/mail_portal_sso/);await assert.rejects(host.connect({}),/mail_portal_sso/);assert.equal(events.filter(x=>x===`login:${LOGIN_URL}`).length,2);assert.equal(events.filter(x=>x==='load:about:blank').length,2);host.dispose();
});
