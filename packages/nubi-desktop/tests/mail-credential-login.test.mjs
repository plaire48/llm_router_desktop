import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{MailCredentialLogin,companyPage}=require('../electron-app/mail-credential-login.cjs');
const {createMailLoginNotices}=require('../electron-app/mail-login-notices.cjs');
test('hidden SSO submits once, preserves native popups, wipes transient credentials and closes',async()=>{
 const windows=[];let submissions=0,handler;
 class Window{
  constructor(options){assert.equal(options.show,false);this.url='https://samsung.net/loginapp/login';this.webContents={on(){},setWindowOpenHandler(value){handler=value;},isLoadingMainFrame:()=>false,getURL:()=>this.url,executeJavaScript:async()=>{submissions++;this.url='http://kor3.samsung.net/portalapp/home';return 'submitted';}};windows.push(this);}
  on(){}async loadURL(){}isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;}
 }
 const credentials={username:'fixture',password:'fixture-password'};
 await new MailCredentialLogin({BrowserWindow:Window,session:{},signal:new AbortController().signal}).run(credentials);
 assert.equal(submissions,1);assert.deepEqual(credentials,{username:'',password:''});assert(windows.every(w=>w.destroyed));
 assert.equal(handler({url:'https://samsung.net/loginapp/login'}).action,'allow');assert.equal(handler({url:'https://evil.example/login'}).action,'deny');
});
test('foreign origins are never accepted as credential destinations',()=>{
 assert.equal(companyPage('https://samsung.net.evil.example/loginapp/login'),false);assert.equal(companyPage('https://x:y@samsung.net/loginapp/login'),false);assert.equal(companyPage('file:///tmp/login'),false);
});
test('Windows notice is deduplicated and opens the in-app login form without secrets',()=>{
 const instances=[],events=[];let focused=0;
 class Notification{static isSupported(){return true;}constructor(options){this.options=options;this.events={};instances.push(this);}on(name,fn){this.events[name]=fn;}show(){}close(){}}
 const notices=createMailLoginNotices({Notification,getWindow:()=>({isDestroyed:()=>false,isMinimized:()=>true,restore(){},show(){},focus(){focused++;}}),send:e=>events.push(e),platform:'win32'});
 assert.equal(notices.show({code:'mail_portal_request'}).shown,true);assert.equal(notices.show({code:'mail_portal_request'}).shown,false);assert.equal(instances.length,1);assert.match(instances[0].options.body,/사내망.*VPN/);
 instances[0].events.click();assert.equal(focused,1);assert.equal(events.at(-1).type,'mail_login_open');notices.clear();
 notices.show({code:'mail_portal_login'});assert.match(instances[1].options.body,/누비에서 다시 로그인/);assert.doesNotMatch(instances[1].options.body,/채팅|폼/);notices.clear();
});
