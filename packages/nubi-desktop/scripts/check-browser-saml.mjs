import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-saml-')),requests=[];
let origin,idp;
const server=createServer(async(req,res)=>{
 let body='';for await(const part of req)body+=part;
 requests.push({path:req.url,method:req.method,body,cookie:req.headers.cookie||''});res.setHeader('Content-Type','text/html; charset=utf-8');
 const redirect=(status,location)=>{res.writeHead(status,{Location:location});res.end();};
 if(req.url==='/epsso/start')return redirect(307,idp+'/epsso/relay');
 if(req.url==='/epsso/relay')return redirect(303,idp+'/epsso/form');
 if(req.url==='/epsso/form')return res.end(`<title>EpSSO SAML fixture</title><form method="POST" action="${origin}/saml/consume"><input name="SAMLResponse" value="synthetic-assertion"><input name="RelayState" value="synthetic-return"><button id="continue">Continue</button></form>`);
 if(req.url==='/saml/consume')return redirect(303,origin+'/return');
 if(req.url==='/return')return res.end('<h1>Returned</h1><script>window.hasOpener=!!window.opener;if(opener)opener.postMessage("fixture-return", "*");</script>');
 if(req.url==='/epsso/error')return res.end('<title>EpSSO SAML Single Sign On Service</title><h1>Cannot invoke org.apache.http.client.methods.HttpGet.getURI() because httpGet is null</h1>');
 if(req.url==='/epsso/unavailable'){res.statusCode=502;return res.end('<title>EpSSO</title>Unavailable');}
 res.setHeader('Set-Cookie','fixture=portal; Path=/; SameSite=Lax');res.end(`<h1>Portal fixture</h1><script>addEventListener('message',e=>{if(e.data==='fixture-return')window.returned=true;});</script><form action="${idp}/epsso/start" method="post" target="_blank" rel="opener"><input name="SAMLRequest" value="synthetic-request"><input name="RelayState" value="synthetic-state"><button id="post">Open service</button></form><a id="error" target="_blank" href="${idp}/epsso/error">Error service</a><a id="http" target="_blank" href="${idp}/epsso/unavailable">Unavailable service</a>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;idp='http://localhost:'+server.address().port;
const entry=path.join(temporary,'main.cjs');await writeFile(entry,`const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temporary,'data'))});app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('about:blank');const {BrowserHost}=require(${JSON.stringify(path.resolve('electron-app/browser-host.cjs'))});global.browserHost=new BrowserHost(win);global.portalSession=session.fromPartition('persist:saml-fixture');global.browserHost.create(${JSON.stringify(origin)},{session:global.portalSession,authentication:true});await global.browserHost.request({action:'layout',bounds:{x:80,y:100,width:900,height:600},visible:true});});`);
let app;const waitFor=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);};
try{
 app=await electron.launch({executablePath:require('electron'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});await app.firstWindow();await waitFor(()=>app.evaluate(()=>!!global.browserHost?.active&&global.browserHost.tab().contentReady),'portal');
 const opener=await app.evaluate(()=>global.browserHost.active);
 const click=selector=>app.evaluate(async({},{opener,selector})=>{const host=global.browserHost;await host.request({action:'select',id:opener});await host.tab().view.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`,true);},{opener,selector});
 for(const named of [false,true]){
  if(named)await app.evaluate(async({},{opener})=>global.browserHost.tab(opener).view.webContents.executeJavaScript('document.querySelector("form").target="service-window"'),{opener});
  await click('#post');await waitFor(()=>app.evaluate(()=>global.browserHost.tab().contentReady&&global.browserHost.tab().view.webContents.getURL().endsWith('/epsso/form')),'redirected POST popup');const child=await app.evaluate(()=>global.browserHost.active);assert.notEqual(child,opener);
  await app.evaluate(()=>global.browserHost.tab().view.webContents.executeJavaScript('document.querySelector("#continue").click()',true));await waitFor(()=>app.evaluate(()=>global.browserHost.tab().contentReady&&global.browserHost.tab().view.webContents.getURL().endsWith('/return')),'POST assertion and return');
  const state=await app.evaluate(async({},{opener})=>{const host=global.browserHost,row=host.tab();return {hasOpener:await row.view.webContents.executeJavaScript('window.hasOpener'),returned:await host.tab(opener).view.webContents.executeJavaScript('window.returned'),sameSession:row.view.webContents.session===global.portalSession,flow:row.authFlow.snapshot(),authReturn:host.status().tabs.find(t=>t.id===row.id).authReturn};},{opener});
  assert.equal(state.hasOpener,true);assert.equal(state.returned,true);assert.equal(state.sameSession,true);assert.equal(state.authReturn,true);assert.equal(state.flow.failure,null);assert(state.flow.events.some(e=>e.stage==='redirect'&&e.httpStatus===307));assert(state.flow.events.some(e=>e.stage==='post'));assert(!/synthetic-|cookie|http:\/\//.test(JSON.stringify(state.flow)));await app.evaluate(async({},{child})=>global.browserHost.request({action:'close',id:child}),{child});
 }
 for(const route of ['/epsso/start','/epsso/relay','/saml/consume']){const rows=requests.filter(r=>r.path===route);assert.equal(rows.length,2,route+' sent once per flow');assert(rows.every(r=>r.method==='POST'));assert(rows.every(r=>r.body===(route==='/saml/consume'?'SAMLResponse=synthetic-assertion&RelayState=synthetic-return':'SAMLRequest=synthetic-request&RelayState=synthetic-state')));}
 assert(requests.filter(r=>r.path==='/return').every(r=>r.method==='GET'&&r.cookie.includes('fixture=portal')));
 await click('#error');await waitFor(()=>app.evaluate(()=>global.browserHost.tab().authFlow.failure?.code==='epsso_request_missing'),'server error classification');const failed=await app.evaluate(()=>{const host=global.browserHost;return {flow:host.tab().authFlow.snapshot(),visible:host.tab().view.getVisible()};});assert.equal(failed.visible,true);
 await app.evaluate(()=>global.browserHost.request({action:'authReturn'}));assert.equal(await app.evaluate(()=>global.browserHost.active),opener);await click('#http');await waitFor(()=>app.evaluate(()=>global.browserHost.tab().authFlow.failure?.httpStatus===502),'HTTP failure');
 const output=path.resolve('verification/browser-saml-2026-10-16');await mkdir(output,{recursive:true});await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks:['new blank and named tab','cross-origin POST','307 preserves POST exactly once','303 becomes GET','opener retained','same session and return cookie','200 EpSSO null error','502 stage','return to original tab','safe bounded diagnostics'],failure:failed.flow,liveCompanyVerified:false,windowsVerified:false},null,2));console.log('Electron SAML popup checks passed: POST, 307/303, opener/session, error stage and return.');
}finally{await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(temporary,{recursive:true,force:true});}
