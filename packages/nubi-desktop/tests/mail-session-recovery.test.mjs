import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MailPortal}=require('../electron-app/mail-portal.cjs');
const {portalFetch,LOGIN_URL}=require('../electron-app/mail-portal-contract.cjs');
const {retryDelay,recoveryState,loginRedirect}=require('../electron-app/mail-session-recovery.cjs');
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
test('bounded exponential retry uses jitter and honors a server wait',()=>{
 assert.equal(retryDelay('mail_portal_request',0,0,()=>0),15000);
 assert.equal(retryDelay('mail_portal_request',2,0,()=>0),60000);
 assert.equal(retryDelay('mail_portal_request',100,0,()=>1),360000);
 assert.equal(retryDelay('mail_portal_rate_limited',0,90000,()=>0),90000);
 assert.equal(recoveryState('mail_portal_forbidden'),'blocked');assert.equal(recoveryState('mail_portal_timeout'),'retrying');
 assert(loginRedirect(new URL('http://samsung.net/loginapp/login'),LOGIN_URL));
 for(const url of ['https://samsung.net/error','https://attacker.example/login','https://samsung.net.attacker.example/login','https://x:y@samsung.net/login'])assert.equal(loginRedirect(new URL(url),LOGIN_URL),false);
});
test('VPN outage preserves the account and recovers automatically without opening SSO',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});const {host,actions,read}=fixture(t);
 host.read=async()=>{throw Error('mail_portal_request');};await assert.rejects(host.sync(),/mail_portal_request/);
 assert.equal(host.status().connected,true);assert.equal(host.status().connectionState,'retrying');assert(host.status().nextRetryAt);assert(!actions.includes('disconnect'));
 host.read=read;t.mock.timers.tick(18001);await host.syncing;
 assert.equal(host.status().connectionState,'connected');assert.equal(host.status().error,null);assert.equal(host.status().nextRetryAt,null);
});
test('starting off VPN retries saved browser session and explicit logout cancels recovery',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});const {host,actions,read}=fixture(t);host.state.connected=false;
 host.read=async()=>{throw Error('mail_portal_timeout');};await host.restore();assert.equal(host.status().connectionState,'retrying');assert(!actions.includes('disconnect'));
 host.read=read;t.mock.timers.tick(18001);await host.restoring;await host.syncing;assert.equal(host.status().connected,true);assert(actions.includes('portalConnect'));
 host.read=async()=>{throw Error('mail_portal_request');};await assert.rejects(host.sync());await host.disconnect();const count=actions.length;
 t.mock.timers.tick(400000);await host.restore();assert.equal(actions.length,count);assert.equal(host.status().connected,false);
});
test('a resource 401 only disconnects after fixed API confirmation; denial or network do not',async t=>{
 for(const confirmation of ['ok','mail_portal_request','mail_portal_login']){
  const {host,actions,read}=fixture(t);let count=0;
  host.read=async(...args)=>{count++;if(count===1)throw Error('mail_portal_login');if(confirmation==='ok')return read(...args);throw Error(confirmation);};
  await assert.rejects(host.sync(),{message:confirmation==='ok'?'mail_portal_forbidden':confirmation});
  assert.equal(host.status().connected,confirmation!=='mail_portal_login');assert.equal(actions.includes('disconnect'),confirmation==='mail_portal_login');host.dispose();
 }
});
test('repeated manual checks cannot bypass Retry-After or fan out restoration',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});const {host,actions,read}=fixture(t);let calls=0;
 host.read=async()=>{calls++;throw Object.assign(Error('mail_portal_rate_limited'),{retryAfterMs:90000});};await assert.rejects(host.sync());
 await assert.rejects(host.recheck(),/mail_portal_rate_limited/);await assert.rejects(host.sync({manual:true}),/mail_portal_rate_limited/);assert.equal(calls,1);
 host.read=read;t.mock.timers.tick(90000);await host.syncing;assert.equal(host.status().error,null);
 await host.disconnect();let finish;host.identify=()=>new Promise(r=>finish=r);const first=host.recheck();await Promise.resolve();await Promise.resolve();const second=host.recheck();
 finish({identity:{id:'fixture',setCd:''},folders:[]});await Promise.all([first,second]);await host.syncing;assert.equal(actions.filter(x=>x==='portalConnect').length,1);
});
test('logout during expiry confirmation cannot invalidate a replacement connection',async t=>{
 const {host,actions}=fixture(t);let rejectCheck;host.read=async()=>{host.read=()=>new Promise((_r,reject)=>rejectCheck=reject);throw Error('mail_portal_login');};
 const pending=host.sync();while(!rejectCheck)await Promise.resolve();await host.disconnect();actions.length=0;host.state.connected=true;rejectCheck(Error('mail_portal_login'));
 await assert.rejects(pending,/mail_cancelled/);assert.equal(host.status().connected,true);assert(!actions.includes('disconnect'));
});
