import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MailPortal}=require('../electron-app/mail-portal.cjs');
const {ORIGIN,portalOrigin,portalFetchSource}=require('../electron-app/mail-portal-contract.cjs');
const secure=new URL(ORIGIN);secure.protocol='https:';
const folders=[{folderID:1,folderName:'받은메일함',mailCount:0}];
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 const loads=[],handlers={},invocations=[],pages=[],scripts=[];
 function contents(url){return {url,loading:false,isDestroyed:()=>false,isLoadingMainFrame(){return this.loading;},getURL(){return this.url;},stop(){},
  async loadURL(url){this.url=url;loads.push({kind:'interactive',url});},
  async executeJavaScript(source){scripts.push(source);if(source.includes('document.body'))return false;
   return vm.runInNewContext(source,{location:{origin:new URL(this.url).origin},URLSearchParams,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,btoa,fetch:async route=>new Response(JSON.stringify(route.includes('userinfo')?{userId:'owner',email:'owner@example.test'}:folders))});}
 };}
 class Window{
  constructor(){this.webContents=contents('about:blank');this.webContents.session={setPermissionRequestHandler(){},fetch:async url=>new Response(JSON.stringify(url.includes('userinfo')?{userId:'owner',email:'owner@example.test'}:folders))};this.webContents.setWindowOpenHandler=()=>{};this.webContents.on=(name,fn)=>handlers[name]=fn;}
  isDestroyed(){return false;}on(){}hide(){}destroy(){}
  async loadURL(url){loads.push({kind:'background',url});this.webContents.url=url;}
 }
 const host=new MailPortal({fetchSession:(session,url,options)=>session.fetch(url,options),BrowserWindow:Window,invoke:async(_method,args)=>{invocations.push(args);return {};},
  openPage:(url,options)=>{pages.push({url,options});return {tabId:'login'};},getPageContents:()=>rows,closePage(){}});
 let rows=[contents(ORIGIN)];host.sync=async()=>{};
 return {host,loads,handlers,invocations,pages,scripts,contents,setRows:value=>rows=value};
}
test('mail origin accepts same-host HTTPS upgrade only, and pins against downgrade',()=>{
 assert.equal(portalOrigin(secure.href),secure.origin);
 assert.equal(portalOrigin(ORIGIN,secure.origin),new URL(ORIGIN).protocol==='https:'?ORIGIN:null);
 for(const url of ['https://other.invalid','https://kor3.samsung.net.evil.invalid','https://user:password@'+secure.host,'https://'+secure.hostname+':8443'])assert.equal(portalOrigin(url),null);
 assert.throws(()=>portalFetchSource('https://other.invalid'),/mail_portal_login/);
});
test('upgraded interactive portal and background reader execute the same HTTPS-bound API script',async()=>{
 const {host,loads,scripts,contents,setRows}=fixture();setRows([contents(secure.origin+'/mail')]);
 await host.connect();assert.equal(host.status().connected,true);assert.equal(host.origin,secure.origin);
 assert.deepEqual(loads.filter(x=>x.kind==='background').map(x=>x.url),['about:blank']);
 assert(scripts.filter(x=>!x.includes('document.body')).every(x=>x.includes(JSON.stringify(secure.origin))));host.dispose();
});
test('reader allows a legitimate HTTPS upgrade but blocks another host and subsequent downgrade',async()=>{
 const {host,handlers}=fixture();await host.windowForLogin(true);let prevented=false;
 handlers['will-redirect']({preventDefault(){prevented=true;}},secure.href);assert.equal(prevented,false);assert.equal(host.origin,secure.origin);
 handlers['will-redirect']({preventDefault(){prevented=true;}},'https://sso.example.invalid');assert.equal(prevented,true);
 prevented=false;handlers['will-navigate']({preventDefault(){prevented=true;}},'http://'+secure.host);assert.equal(prevented,true);host.dispose();
});
test('pending child authentication blocks probing the old parent mailbox',async()=>{
 const {host,loads,scripts,contents,setRows}=fixture();await host.windowForLogin(true);host.state.connecting=true;
 const child=contents('https://sso.example.invalid/bridge');child.loading=true;setRows([contents(ORIGIN),child]);
 await assert.rejects(host.read('identity'),/mail_portal_login/);
 child.loading=false;await assert.rejects(host.read('identity'),/mail_portal_login/);
 assert.equal(scripts.length,0);assert.deepEqual(loads.map(x=>x.url),['about:blank']);host.dispose();
});
test('a single abnormal-logout login page stays open until authentication returns to the portal',async t=>{
 const {host,contents,setRows,scripts,invocations}=fixture();t.after(()=>host.dispose());
 const login=contents('https://www.samsung.net/loginapp/abnormal-logout');setRows([login]);
 let probes=0,closed=0;host.closePage=()=>closed++;
 const pending=host.connect();await tick();
 host.window.webContents.session.fetch=async()=>{probes++;return new Response('',{status:403});};
 await tick();assert.equal(host.status().connecting,true);assert.equal(closed,0);
 await assert.rejects(host.read('folders'),/mail_portal_login/);
 assert.equal(probes,0);assert.equal(invocations.length,0);
 assert(scripts.every(source=>source.includes('document.body')),'no mail API or credential script enters the login page');
 login.url=secure.origin+'/portalapp/home';
 host.window.webContents.session.fetch=async()=>{probes++;return new Response(JSON.stringify(folders));};
 await pending;assert.equal(host.status().connected,true);assert.equal(probes,1);assert.equal(closed,1);
 assert.equal(invocations.filter(row=>row.action==='portalConnect').length,1);
});
test('same-origin abnormal logout is also a login page, never a mail API execution target',async()=>{
 const {host,contents,setRows,scripts}=fixture();await host.windowForLogin(true);
 const login=contents(secure.origin+'/loginapp/abnormal-logout');setRows([login]);
 await assert.rejects(host.read('identity'),/mail_portal_login/);
 await assert.rejects(host.readContents(login,'identity'),/mail_portal_login/);
 assert.equal(scripts.length,0);host.dispose();
});
for(const loginPath of ['abnormal-logout','logout'])test(`background ${loginPath} redirects require login without replaying the request`,async()=>{
 const {host}=fixture();await host.windowForLogin(true);let calls=0;
 host.window.webContents.session.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:`https://www.samsung.net/loginapp/${loginPath}`}});};
 await assert.rejects(host.readSession('folders'),{message:'mail_portal_login'});assert.equal(calls,1);host.dispose();
});
test('native session probes use cookies and never follow an SSO redirect or request arbitrary endpoints',async()=>{
 const {host}=fixture();await host.windowForLogin(true);const calls=[];
 host.window.webContents.session.fetch=async(url,args)=>{calls.push({url,args});return new Response(null,{status:302,headers:{location:'https://sso.example.invalid/login'}});};
 // A redirect to an unknown SSO host is not a login expiry (mail_portal_redirect, 2026-10-15); only the company login paths are.
 await assert.rejects(host.readSession('folders'),/mail_portal_redirect/);assert.equal(calls.length,1);assert.equal(calls[0].args.credentials,'include');assert.equal(calls[0].args.redirect,'manual');assert.equal(new URL(calls[0].url).pathname,'/mail/rest/v1/mails/desktop/folders');assert(!calls[0].args.headers.Cookie);
 await assert.rejects(host.readSession('deleteMail'),/mail_portal_action/);assert.equal(calls.length,1);host.dispose();
});
test('API HTTPS upgrade keeps the exact fixed path and POST body and pins subsequent requests',async()=>{
 const {host}=fixture();await host.windowForLogin(true);const calls=[];
 host.window.webContents.session.fetch=async(url,args)=>{calls.push({url,args});if(calls.length===1){const target=new URL(url);target.protocol='https:';return new Response(null,{status:307,headers:{location:target.href}});}return new Response(JSON.stringify(folders));};
 await host.readSession('folders');assert.equal(calls.length,2);assert.equal(calls[0].args.method,'POST');assert.equal(calls[1].args.body,calls[0].args.body);assert.equal(host.origin,secure.origin);
 await host.readSession('folders');assert.equal(new URL(calls[2].url).origin,secure.origin);host.dispose();
});
test('an HTTPS redirect to another path is not treated as a mail API upgrade',async()=>{
 const {host}=fixture();await host.windowForLogin(true);let count=0;
 host.window.webContents.session.fetch=async()=>{count++;return new Response(null,{status:302,headers:{location:secure.origin+'/sso'}});};
 await assert.rejects(host.readSession('folders'),/mail_portal_login/);assert.equal(count,1);host.dispose();
});
test('disconnect aborts the old session request and prevents it from returning as a fresh result',async()=>{
 const {host}=fixture();await host.windowForLogin(true);const response=deferred();let signal;
 host.window.webContents.session.fetch=async(_url,args)=>{signal=args.signal;return response.promise;};
 const pending=host.readSession('folders');await host.disconnect();assert.equal(signal.aborted,true);response.resolve(new Response(JSON.stringify(folders)));await assert.rejects(pending,/mail_cancelled/);host.dispose();
});
test('manual login invalidates and serializes an in-flight restore before opening the browser',async()=>{
 const {host,pages,invocations}=fixture(),load=deferred();let first=true;
 const Window=host.BrowserWindow;host.BrowserWindow=class extends Window{async loadURL(url){if(first){first=false;await load.promise;}return super.loadURL(url);}};
 const restore=host.restore(),login=host.connect();await tick();assert.equal(pages.length,0);
 load.resolve();await Promise.all([restore,login]);assert.equal(pages.length,1);assert.equal(invocations.filter(x=>x.action==='portalConnect').length,1);host.dispose();
});
test('cancelling a queued login while restore is pending never opens a late login tab',async()=>{
 const {host,pages}=fixture(),load=deferred();const Window=host.BrowserWindow;
 host.BrowserWindow=class extends Window{async loadURL(url){await load.promise;return super.loadURL(url);}};
 const restore=host.restore(),login=host.connect();await host.disconnect();load.resolve();await restore;await assert.rejects(login,/mail_cancelled/);assert.equal(pages.length,0);host.dispose();
});
