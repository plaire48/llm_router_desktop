import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MailPortal}=require('../electron-app/mail-portal.cjs');
const {portalFetch,LOGIN_URL}=require('../electron-app/mail-portal-contract.cjs');
const {loginRedirect}=require('../electron-app/mail-session-recovery.cjs');
const folders=[{folderID:1,folderName:'받은메일함',mailCount:0}];
function fixture(t){
 const actions=[];
 class Window{constructor(){this.webContents={session:{setPermissionRequestHandler(){}},setWindowOpenHandler(){},on(){}};}isDestroyed(){return false;}on(){}async loadURL(){}destroy(){}hide(){}show(){assert.fail('background recovery must not open login');}}
 const host=new MailPortal({BrowserWindow:Window,invoke:async(_method,args)=>{actions.push(args.action);return args.action==='portalKnown'?{uids:[]}:{};}});
 host.identity={id:'fixture',setCd:''};host.state.connected=true;
 host.read=async op=>op==='identity'?{userId:'fixture',email:'fixture@example.test'}:op==='folders'?folders:{liteHeaderVOs:[]};
 t.after(()=>host.dispose());return {host,actions,read:host.read};
}
test('HTTP denial, a block page, server outage and real login are distinct',async()=>{
 for(const [status,body,code] of [[401,'','mail_portal_login'],[403,'','mail_portal_forbidden'],[503,'','mail_portal_unavailable'],[200,'<html>Access denied by gateway</html>','mail_portal_response'],[200,'<html><input type="password"></html>','mail_portal_login']]){
  await assert.rejects(portalFetch({operation:'folders'},{fetch:async()=>new Response(body,{status})}),{message:code});
 }
 await assert.rejects(portalFetch({operation:'folders'},{fetch:async()=>new Response('',{status:429,headers:{'retry-after':'90'}})}),e=>e.message==='mail_portal_rate_limited'&&e.retryAfterMs===90000);
 const after=new Date(Date.now()+120000).toUTCString();
 await assert.rejects(portalFetch({operation:'folders'},{fetch:async()=>new Response('',{status:503,headers:{'retry-after':after}})}),e=>e.retryAfterMs>118000&&e.retryAfterMs<=120000);
});
test('connection and TLS errors are not authentication failures; cancellation stays cancellation',async()=>{
 for(const [message,code] of [['net::ERR_CONNECTION_RESET','mail_portal_request'],['net::ERR_CERT_AUTHORITY_INVALID','mail_tls_error']])await assert.rejects(portalFetch({operation:'folders'},{fetch:async()=>{throw Error(message);}}),{message:code});
 const signal=AbortSignal.abort();await assert.rejects(portalFetch({operation:'folders'},{signal,fetch:async()=>{throw Error('aborted');}}),{message:'mail_cancelled'});
});
test('only known company login routes count as login redirects',()=>{
 assert(loginRedirect(new URL('http://samsung.net/loginapp/login'),LOGIN_URL));
 for(const url of ['https://www.samsung.net/loginapp/abnormal-logout','https://www.samsung.net/loginapp/abnormal-logout/?reason=expired','https://samsung.net/loginapp/logout'])assert(loginRedirect(new URL(url),LOGIN_URL));
 for(const url of ['https://samsung.net/error','https://attacker.example/login','https://samsung.net.attacker.example/login','https://x:y@samsung.net/login','https://samsung.net/loginapp/abnormal-logout-other','https://samsung.net/loginapp/logout-other','https://samsung.net.attacker.example/loginapp/abnormal-logout','file://samsung.net/loginapp/abnormal-logout'])assert.equal(loginRedirect(new URL(url),LOGIN_URL),false);
});
test('abnormal logout form HTML requests login rather than reporting an unreadable response',async()=>{
 for(const action of ['/loginapp/login','/loginapp/logout','/loginapp/abnormal-logout','https://www.samsung.net/loginapp/abnormal-logout?reason=expired']){
  await assert.rejects(portalFetch({operation:'folders'},{fetch:async()=>new Response(`<html><form action="${action}"></form></html>`)}),{message:'mail_portal_login'});
 }
 await assert.rejects(portalFetch({operation:'folders'},{fetch:async()=>new Response('<html><form action="/loginapp/abnormal-logout-other"></form></html>')}),{message:'mail_portal_response'});
});
test('a VPN failure logs out once, clears portal cookies and never retries automatically',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});const {host,actions}=fixture(t);const notices=[],cleared=[];let reads=0;
 host.window={webContents:{session:{clearData:async args=>cleared.push(args)}},hide(){},destroy(){}};host.onDisconnected=value=>notices.push(value);
 host.read=async()=>{reads++;throw Error('mail_portal_request');};await assert.rejects(host.sync(),/mail_portal_request/);
 assert.equal(host.status().connected,false);assert.equal(host.status().connectionState,'authentication_required');assert.equal(actions.filter(x=>x==='disconnect').length,1);assert.equal(notices.length,1);
 assert(cleared.every(x=>x.dataTypes.join()==='cookies'&&x.origins.every(o=>new URL(o).hostname.endsWith('samsung.net')||new URL(o).hostname==='samsung.com')));
 t.mock.timers.tick(3600000);await host.restore();await assert.rejects(host.recheck(),/mail_portal_login/);assert.equal(reads,1);
});
test('starting off VPN stops after one attempt until the person starts login',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});const {host,actions}=fixture(t);host.state.connected=false;let reads=0;
 host.read=async()=>{reads++;throw Error('mail_portal_timeout');};await host.restore();const count=reads;
 t.mock.timers.tick(3600000);await host.restore();assert.equal(reads,count);assert.equal(host.status().connected,false);assert.equal(actions.filter(x=>x==='disconnect').length,1);
});
test('a valid existing session connects without credentials or opening SSO',async t=>{
 const {host,actions}=fixture(t);host.state.connected=false;
 const result=await host.sessionReady();assert.equal(result.connected,true);assert.equal(actions.filter(x=>x==='portalConnect').length,1);assert(!actions.includes('disconnect'));
});
test('a failure from a previous session cannot log out its replacement',async t=>{
 const {host,actions}=fixture(t);let reject;host.read=()=>new Promise((_r,r)=>reject=r);const pending=host.sync();while(!reject)await Promise.resolve();await host.disconnect();actions.length=0;host.state.connected=true;
 reject(Error('mail_portal_login'));await assert.rejects(pending,/mail_cancelled/);assert.equal(host.status().connected,true);assert(!actions.includes('disconnect'));
});
test('an approval timeout does not erase the authenticated mail session',async t=>{
 const {host}=fixture(t);host.identity.userId='fixture';host.read=async()=>{throw Error('mail_portal_timeout');};await assert.rejects(host.approvals(),/mail_portal_timeout/);assert.equal(host.status().connected,true);
});
