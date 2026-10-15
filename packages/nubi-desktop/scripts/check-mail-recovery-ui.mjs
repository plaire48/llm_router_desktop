import {build,stop} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=process.cwd(),dir=path.resolve('verification/mail-session-recovery-2026-10-15');await mkdir(dir,{recursive:true});
const contents=`import React from 'react';import {createRoot} from 'react-dom/client';import {MailLibrary} from '${root}/ui/MailLibrary.jsx';import '${root}/node_modules/@e2e/cx-design-system/dist/styles.css';import '${root}/electron-app/workbench.css';import '${root}/design/workspace-identity.css';import '${root}/design/workspace-typography.css';import '${root}/design/workspace-dialogs.css';
window.mode='retrying';window.checks=0;window.fail=false;
const state=()=>({connected:window.mode!=='authentication_required',protocol:'portal',counts:{received:2},catalogs:[],error:window.mode==='connected'?null:window.mode==='blocked'?'mail_portal_forbidden':window.mode==='authentication_required'?'mail_portal_login':'mail_portal_request',portal:{connectionState:window.mode,nextRetryAt:window.mode==='retrying'?new Date(Date.now()+15000).toISOString():null}});
async function api(method,args){if(args.action==='portalSync'){window.checks++;if(window.fail)throw Error('mail_portal_request');window.mode='connected';}return state();}
createRoot(document.getElementById('root')).render(<main className="desktop-shell" style={{padding:24,minHeight:'100vh'}}><div style={{maxWidth:650,margin:'0 auto'}}><MailLibrary api={api}/></div></main>);`;
await build({stdin:{contents,resolveDir:root,loader:'jsx'},outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Session recovery fixture</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const name=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!name.startsWith(dir+path.sep))throw Error();const data=await readFile(name);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(name)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1000,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByText('포털 재연결 대기',{exact:true}).waitFor();await page.locator('.nubi-mail-connection-error summary').click();assert(await page.getByText('다음 확인',{exact:false}).isVisible());assert.equal(await page.getByRole('button',{name:'포털 로그인',exact:true}).count(),0);
 await page.screenshot({path:path.join(dir,'retrying.png')});await page.setViewportSize({width:600,height:900});assert(await page.locator('.nubi-mail-connection-error').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(dir,'narrow.png')});
 await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'연결 다시 확인',exact:true}).click();assert.equal(await page.evaluate(()=>window.checks),1);
 await page.evaluate(()=>{window.mode='connected';window.fail=false;});await page.getByText('사내 포털 연결됨',{exact:true}).waitFor();await page.locator('.nubi-mail-connection-error').waitFor({state:'hidden'});
 await page.evaluate(()=>window.mode='blocked');await page.getByText('포털 접근 확인 필요',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'포털 로그인',exact:true}).count(),0);
 await page.evaluate(()=>window.mode='authentication_required');await page.getByRole('button',{name:'포털 로그인',exact:true}).waitFor();await page.getByText('포털에 로그인해 주세요',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,scope:'Real MailLibrary component; simulated connection responses, not company SSO',errors},null,2));console.log('Mail recovery UI passed: retained account, retry action, background recovery, access denied, confirmed expiry, narrow layout.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stop();}
