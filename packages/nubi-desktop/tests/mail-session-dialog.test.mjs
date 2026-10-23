import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {expiredSessionDialog,automaticExpiryConfirmation,mailDialogPending,installMailSessionDialogs} from '../electron-app/mail-session-dialog.cjs';
const notice={url:'https://www.samsung.net/loginapp/abnormal-logout',type:'alert',message:'사용자 세션이 만료되었습니다. 브라우저를 종료하고 다시 로그인해 주시기 바랍니다.'};
function fixture(){
 const contents=new EventEmitter(),debuggerApi=new EventEmitter(),commands=[];let attached=false;
 Object.assign(debuggerApi,{isAttached:()=>attached,attach:()=>{attached=true;},sendCommand:async(method,args)=>{commands.push({method,args});},detach:()=>{attached=false;debuggerApi.emit('detach');}});
 contents.debugger=debuggerApi;installMailSessionDialogs(contents);
 return {contents,commands,emit:(method,args)=>debuggerApi.emit('message',{},method,args)};
}
test('only known portal session-expired alerts require navigation after manual confirmation',()=>{
 assert(expiredSessionDialog(notice));
 for(const change of [{type:'prompt'},{message:'로그인 정보를 저장할까요?'},{url:'https://www.samsung.net.evil.test/loginapp/logout'},{url:Object.assign(new URL('https://www.samsung.net/loginapp/logout'),{username:'user',password:'password'}).href},{url:'https://www.samsung.net:8443/loginapp/logout'}])assert.equal(expiredSessionDialog({...notice,...change}),false);
});
test('known native expiry alerts advance automatically and block probes through the redirect gap',()=>{
 const {contents,commands,emit}=fixture();
 assert.equal(mailDialogPending(contents),false);
 emit('Page.javascriptDialogOpening',{...notice,url:'https://www.samsung.net/loginapp/logout'});assert.equal(mailDialogPending(contents),true);
 emit('Page.javascriptDialogClosed',{result:true});assert.equal(mailDialogPending(contents),true);
 contents.emit('did-start-navigation',{},'https://www.samsung.net/loginapp/login',true,true);assert.equal(mailDialogPending(contents),true,'hash changes do not prove login navigation');
 contents.emit('did-start-navigation',{},'https://www.samsung.net/loginapp/login',false,true);assert.equal(mailDialogPending(contents),false);
 assert.deepEqual(commands,[{method:'Page.enable',args:undefined},{method:'Page.handleJavaScriptDialog',args:{accept:true}}],'only the known alert is accepted; no Network/Runtime data');
 installMailSessionDialogs(contents);assert.equal(contents.debugger.listenerCount('message'),1);
});
test('unrelated confirmation remains manual and does not require a redirect',()=>{
 const {contents,commands,emit}=fixture();emit('Page.javascriptDialogOpening',{...notice,type:'confirm',message:'작업을 진행할까요?'});
 assert.equal(mailDialogPending(contents),true);emit('Page.javascriptDialogClosed',{result:false});assert.equal(mailDialogPending(contents),false);
 assert.equal(commands.length,1);contents.debugger.detach();assert.equal(contents.debugger.listenerCount('message'),0);assert.equal(contents.listenerCount('did-start-navigation'),0);
});

// Portal login waits as in 1.2.9 (user decision 2026-10-23): the person answers the portal's dialog while the app waits
// without probing, and five minutes after the login started it stops with 연결이 안 됐습니다.
test('a human confirmation waits without probes and resumes only after confirmation and navigation',async t=>{
 const {MailPortal}=await import('../electron-app/mail-portal.cjs');
 t.mock.timers.enable({apis:['Date'],now:1000});
 const {contents,emit,commands}=fixture();Object.assign(contents,{getURL:()=> 'https://www.samsung.net/loginapp/login',isDestroyed:()=>false});
 const host=new MailPortal({getPageContents:()=>[contents],invoke:async()=>({})});t.after(()=>host.dispose());
 host.page={tabId:'fixture'};host.windowForLogin=async()=>{};host.sync=async()=>{};host.readSession=async()=>[{folderID:'1',folderName:'Inbox'}];let probes=0;
 host.identify=async()=>{probes++;return {identity:{id:'owner',userId:'owner'},folders:[]};};
 emit('Page.javascriptDialogOpening',{...notice,type:'confirm',message:'작업을 진행할까요?'});const connecting=host.connect();
 await new Promise(r=>setTimeout(r,20));t.mock.timers.setTime(4*60*1000);await new Promise(r=>setTimeout(r,300));
 assert.equal(host.status().connecting,true);assert.equal(host.status().loginStage,'confirmation');assert.equal(probes,0);
 emit('Page.javascriptDialogClosed',{result:true});contents.getURL=()=> 'http://kor3.samsung.net/portalapp/home';contents.emit('did-start-navigation',{},contents.getURL(),false,true);
 assert.equal((await connecting).connected,true);assert.equal(probes,1);assert.deepEqual(commands,[{method:'Page.enable',args:undefined}]);
});

test('known expiry alerts work on home and logout, once per document with a bounded loop',()=>{
 assert(automaticExpiryConfirmation(notice));assert(automaticExpiryConfirmation({...notice,type:'confirm'}));
 for(const url of ['https://www.samsung.net/loginapp/logout','http://www.samsung.net/loginapp/logout','http://kor3.samsung.net/portalapp/home','https://kor3.samsung.net/portalapp/home'])assert(automaticExpiryConfirmation({...notice,url}));
 for(const change of [{type:'prompt'},{message:'삭제하시겠습니까?'},{url:'https://evil.test/loginapp/abnormal-logout'}])assert.equal(automaticExpiryConfirmation({...notice,...change}),false);
 const {contents,commands,emit}=fixture();
 emit('Page.javascriptDialogOpening',notice);
 assert.deepEqual(commands,[{method:'Page.enable',args:undefined},{method:'Page.handleJavaScriptDialog',args:{accept:true}}]);
 assert.equal(mailDialogPending(contents),true,'command success is not proof of navigation');
 emit('Page.javascriptDialogClosed',{result:true});assert.equal(mailDialogPending(contents),true);
 contents.emit('did-start-navigation',{},'https://www.samsung.net/loginapp/login',false,true);assert.equal(mailDialogPending(contents),false);
 emit('Page.javascriptDialogOpening',notice);assert.equal(commands.length,3);
 emit('Page.javascriptDialogOpening',notice);assert.equal(commands.length,3,'same document is not auto-clicked twice');
 for(let i=0;i<4;i++){contents.emit('did-start-navigation',{},notice.url,false,true);emit('Page.javascriptDialogOpening',notice);}
 assert.equal(commands.length,4,'at most three automatic confirmations per tab');
});
test('failed automatic confirmation leaves the original dialog available',async()=>{
 const {contents,emit}=fixture();contents.debugger.sendCommand=async()=>{throw Error('unavailable');};
 emit('Page.javascriptDialogOpening',notice);await new Promise(r=>setImmediate(r));
 assert.equal(mailDialogPending(contents),true);
 emit('Page.javascriptDialogClosed',{result:true});contents.emit('did-start-navigation',{},'https://www.samsung.net/loginapp/login',false,true);assert.equal(mailDialogPending(contents),false);
});

test('an existing debugger connection does not disable expiry handling',()=>{
 const contents=new EventEmitter(),debuggerApi=new EventEmitter(),commands=[];
 contents.debugger=Object.assign(debuggerApi,{isAttached:()=>true,attach:()=>assert.fail('already attached'),sendCommand:async(method,args)=>commands.push({method,args})});
 installMailSessionDialogs(contents);
 debuggerApi.emit('message',{},'Page.javascriptDialogOpening',notice);
 assert(commands.some(row=>row.method==='Page.handleJavaScriptDialog'));
});

test('login input waits without API probes and remains cancellable',async t=>{
 const {MailPortal}=await import('../electron-app/mail-portal.cjs');
 t.mock.timers.enable({apis:['Date'],now:1000});
 const contents={getURL:()=> 'https://www.samsung.net/loginapp/login',isDestroyed:()=>false};
 const host=new MailPortal({getPageContents:()=>[contents],invoke:async()=>({})});t.after(()=>host.dispose());
 host.page={tabId:'fixture'};host.windowForLogin=async()=>{};let probes=0;host.identify=async()=>{probes++;throw Error('mail_portal_forbidden');};
 const pending=host.connect();await new Promise(r=>setTimeout(r,20));
 t.mock.timers.setTime(4*60*1000);await new Promise(r=>setTimeout(r,300));
 assert.equal(host.status().connecting,true);assert.equal(host.status().loginStage,'authenticating');assert.equal(probes,0);
 await host.disconnect();await assert.rejects(pending,/mail_cancelled/);
});

for(const [name,dialog] of [['an open portal confirmation',true],['a sign-in page still being filled in',false]])test(`${name} does not keep the login past five minutes`,async t=>{
 const {MailPortal}=await import('../electron-app/mail-portal.cjs');
 t.mock.timers.enable({apis:['Date'],now:1000});
 const {contents,emit}=fixture();Object.assign(contents,{getURL:()=> 'https://www.samsung.net/loginapp/login',isDestroyed:()=>false});
 const host=new MailPortal({getPageContents:()=>[contents],invoke:async()=>({})});t.after(()=>host.dispose());
 host.page={tabId:'fixture'};host.windowForLogin=async()=>{};host.closeLoginPage=()=>{};let probes=0;host.identify=async()=>{probes++;throw Error('mail_portal_forbidden');};
 if(dialog)emit('Page.javascriptDialogOpening',{...notice,type:'confirm',message:'작업을 진행할까요?'});
 const pending=host.connect();await new Promise(r=>setTimeout(r,20));
 t.mock.timers.setTime(1000+6*60*1000);
 await assert.rejects(pending,/mail_portal_login_timeout/);assert.equal(probes,0);assert.equal(host.status().connecting,false);assert.equal(host.status().error,'mail_portal_login_timeout');
});
