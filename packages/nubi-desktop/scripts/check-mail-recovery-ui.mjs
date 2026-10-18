import {build,stop} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=process.cwd(),dir=path.resolve('verification/mail-session-recovery-2026-10-15');await mkdir(dir,{recursive:true});
const contents=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MailLoginForm} from '${root}/ui/MailLoginForm.jsx';import '${root}/node_modules/@e2e/cx-design-system/dist/styles.css';import '${root}/electron-app/workbench.css';import '${root}/design/workspace-identity.css';import '${root}/design/workspace-typography.css';import '${root}/design/workspace-dialogs.css';
window.signedIn=false;window.rejectLogin=false;window.submissions=0;window.methods=[];
async function api(method,args){window.methods.push(args.action);if(args.action==='portalSession')return {connected:window.signedIn};if(args.action==='portalLogin'){window.submissions++;if(window.rejectLogin)throw Error('mail_portal_request');return new Promise(resolve=>{window.finishLogin=()=>resolve({connected:true});});}return {};}
function App(){const [open,setOpen]=useState(true);window.openLogin=()=>setOpen(true);return <main className="desktop-shell" style={{padding:24,minHeight:'100vh'}}>{open?<MailLoginForm api={api} onClose={()=>setOpen(false)}/>:<p>로그인 확인 완료</p>}</main>;}createRoot(document.getElementById('root')).render(<App/>);`;

await build({stdin:{contents,resolveDir:root,loader:'jsx'},outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Session recovery fixture</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const name=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!name.startsWith(dir+path.sep))throw Error();const data=await readFile(name);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(name)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1000,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>window.submissions===1);
 assert.equal(await page.locator('input').count(),0);assert.equal(await page.getByRole('dialog').count(),0,'portal remains unobstructed');
 await page.evaluate(()=>window.finishLogin());await page.getByText('로그인 확인 완료',{exact:true}).waitFor();
 await page.evaluate(()=>{window.signedIn=true;window.openLogin();});await page.getByText('로그인 확인 완료',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.submissions),1);
 await page.evaluate(()=>{window.signedIn=false;window.rejectLogin=true;window.openLogin();});await page.getByRole('alert').waitFor();assert.equal(await page.locator('input').count(),0);
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(dir,'browser-login-error.png')});await page.setViewportSize({width:440,height:900});await page.waitForTimeout(250);assert(await page.locator('.nubi-mail-login-form').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(dir,'browser-login-error-narrow.png')});
 await page.evaluate(()=>window.rejectLogin=false);await page.getByRole('button',{name:'다시 로그인',exact:true}).click();await page.waitForFunction(()=>window.submissions===3);assert.equal(await page.getByRole('dialog').count(),0);
 await page.evaluate(()=>window.finishLogin());await page.getByText('로그인 확인 완료',{exact:true}).waitFor();
 assert((await page.evaluate(()=>window.methods)).every(method=>['portalSession','portalLogin'].includes(method)));
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,scope:'Real session handoff UI in Chrome with mocked host; no credential input, session reuse, unobstructed browser and retry. Not company SSO.',errors},null,2));console.log('Mail browser login UI passed: no credential form, session reuse, overlay removed before browser and explicit retry.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stop();}
