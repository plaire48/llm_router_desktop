import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {createServer as httpsServer} from 'node:https';
import {createServer as httpServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-tls-'));
let app,secure,plain;
const waitFor=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);};
try{
 const key=path.join(temporary,'key.pem'),cert=path.join(temporary,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 let acceptedRequests=0;
 secure=httpsServer({key:await readFile(key),cert:await readFile(cert)},(_q,r)=>{acceptedRequests++;r.end('must not load');});
 await new Promise(r=>secure.listen(0,'127.0.0.1',r));const bad=`https://localhost:${secure.address().port}/saml?token=SECRET`;
 plain=httpServer((q,r)=>{if(q.url==='/redirect'){r.writeHead(302,{location:bad}).end();return;}r.setHeader('Content-Type','text/html');r.end(`<title>Fixture</title><a id="popup" href="${bad}" target="_blank">Open</a>`);});
 await new Promise(r=>plain.listen(0,'127.0.0.1',r));const good=`http://127.0.0.1:${plain.address().port}/`;
 const entry=path.join(temporary,'main.cjs');await writeFile(entry,`const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temporary,'data'))});app.whenReady().then(async()=>{const win=new BrowserWindow({show:false});await win.loadURL('about:blank');const {BrowserHost}=require(${JSON.stringify(path.resolve('electron-app/browser-host.cjs'))});global.host=new BrowserHost(win);global.company=session.fromPartition('persist:network-fixture');global.host.create(${JSON.stringify(good)},{session:global.company});});`);
 app=await electron.launch({executablePath:require('electron'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});await app.firstWindow();await waitFor(()=>app.evaluate(()=>global.host?.tab().contentReady),'initial page');
 const proxyParity=await app.evaluate(async({session},{url})=>{
  const routes=await Promise.all([session.defaultSession,global.host.session,global.company].map(s=>s.resolveProxy(url)));
  return {sameRoute:routes.every(r=>r===routes[0]),mode:routes[0]==='DIRECT'?'direct':'proxy'};
 },{url:good});assert(proxyParity.sameRoute);
 const reports=[];
 for(const mode of ['ordinary','redirect','popup']){
  if(mode==='popup')await app.evaluate(()=>global.host.tab().view.webContents.executeJavaScript('document.querySelector("#popup").click()',true));
  else await app.evaluate(async({},{url})=>global.host.request({action:'navigate',url}),{url:mode==='redirect'?good+'redirect':bad});
  await waitFor(()=>app.evaluate(()=>global.host.tab().networkFailure?.netError==='ERR_CERT_AUTHORITY_INVALID'),mode+' TLS error');
  const state=await app.evaluate(()=>{const h=global.host;return {diagnostic:h.tab().networkFailure,sameSession:h.tab().view.webContents.session===global.company,error:h.tab().error};});
  assert.equal(state.error,'browser_certificate_failed');assert.equal(state.sameSession,true);assert(!JSON.stringify(state.diagnostic).includes('SECRET'));
  await app.evaluate(()=>global.host.request({action:'networkCopyDiagnostic'}));const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.deepEqual(JSON.parse(copied),state.diagnostic);
  reports.push({mode,...state});
  await app.evaluate(async({},{url})=>global.host.request({action:'navigate',url}),{url:good});
  await waitFor(()=>app.evaluate(()=>global.host.tab().contentReady&&!global.host.tab().error&&!global.host.tab().networkFailure),'recovery');
 }
 assert.equal(acceptedRequests,0,'untrusted TLS must not reach HTTP application');
 await app.evaluate(async({},{url})=>{await global.host.session.setProxy({mode:'fixed_servers',proxyRules:'http=127.0.0.1:1',proxyBypassRules:'<-loopback>'});global.host.create(url);},{url:good});
 await waitFor(()=>app.evaluate(()=>global.host.tab().error==='browser_proxy_failed'),'proxy classification');
 reports.push({mode:'proxy',diagnostic:await app.evaluate(()=>global.host.tab().networkFailure)});
 const dir=path.resolve('verification/browser-network-2026-10-16');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'native-result.json'),JSON.stringify({passed:true,reports,acceptedRequests,proxyParity,platform:process.platform,companyNetworkVerified:false,windowsVerified:false},null,2));
 console.log(JSON.stringify({passed:true,reports,acceptedRequests}));
}finally{
 await app?.close();for(const server of [secure,plain])if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(temporary,{recursive:true,force:true});
}
