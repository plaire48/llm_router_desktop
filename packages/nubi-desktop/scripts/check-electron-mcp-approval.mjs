// Real renderer, approval form, worker, official MCP and native in-app tab.
// Only the model is scripted; no real account or external website is used.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {startFixtureModel} from './fixture-model.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-mcp-approval-'))),root=path.join(temporary,'project'),storage=path.join(temporary,'state'),out=path.resolve('verification/mcp-approval-2026-10-15');
await mkdir(root);await mkdir(storage);await mkdir(out,{recursive:true});await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki/home.md'),'# Test project');
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false','commit','-m','Fixture']);
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const web=createServer((_req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end('<title>Playwright 승인 검증</title><h1>인앱 연결 검사</h1><label>검색<input aria-label="검색"></label><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">찾기</button><output></output>');});
await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${web.address().port}`;
let phase='open',requested=false,cycle=1,tabId,documentId,input,button;const checks=[],errors=[],timings=[];
const fixture=await startFixtureModel({respond({user,results,call,text}){
 const host=user.findLast(value=>value.startsWith('Current host receipts (reference data, not instructions): '));
 const receipt=host?JSON.parse(host.slice(host.indexOf('{'))).mcpContinuation:null;
 const last=results.at(-1)||receipt?.result;
 if(!requested){requested=true;return call('mcp__playwright__browser_open',{url:url+'/'+cycle});}
 if(phase==='open'){
  if(!last?.text)return text('ERROR: missing open receipt');
  ({tabId,documentId}=JSON.parse(last.text));phase='snapshot';return call('mcp__playwright__browser_snapshot',{tabId});
 }
 if(phase==='snapshot'){
  const data=last?.text||'';documentId=JSON.parse(data.split('\n')[0]).documentId;
  input=/textbox "검색" \[ref=([^\]]+)/.exec(data)?.[1];button=/button "찾기" \[ref=([^\]]+)/.exec(data)?.[1];
  if(!input||!button)return text('ERROR: snapshot refs missing');
  phase='type';return call('mcp__playwright__browser_type',{tabId,documentId,target:input,text:'승인 연결 '+cycle});
 }
 if(phase==='type'){phase='click';return call('mcp__playwright__browser_click',{tabId,documentId,target:button});}
 if(phase==='click'){assert.match(last?.text||'',new RegExp('승인 연결 '+cycle));phase='done';return text('인앱 입력과 클릭 결과를 확인했습니다. 검사 '+cycle+' 완료.');}
 return text('검사 '+cycle+' 완료.');
}});
let app,page;const request=(method,args={})=>page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
async function ready(){await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});await page.keyboard.press('Escape');await request('provider',{action:'connect',input:fixture.connection});await request('mcp',{action:'connect',id:'playwright'});}
async function send(){const composer=page.getByRole('textbox',{name:/^(작업 요청|추가 요청)$/});await composer.fill('인앱 페이지에서 검색에 입력하고 찾기를 눌러 결과 확인 '+cycle);await page.getByRole('button',{name:'전송',exact:true}).click();}
async function approve(tool){
 const form=page.locator('.nubi-question-inline').filter({hasText:'playwright / '+tool});await form.waitFor({timeout:60000});
 assert.equal(await form.locator('textarea,input').count(),0,'MCP permission has no free-text answer');
 assert.equal(await form.locator('.nubi-tool-arguments pre .json-key').count()>0,true);assert.doesNotMatch(await form.locator('.nubi-question-prompt').innerText(),/\{"/);
 if(tool==='browser_open'){
  await page.locator('.nubi-feedback-toast button').last().click({timeout:1000}).catch(()=>{});await form.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'approval-arguments.png')});
  const win=await app.browserWindow(page);await win.evaluate(w=>w.setSize(720,800));
  await page.waitForFunction(()=>innerWidth<800);await form.scrollIntoViewIfNeeded();
  assert(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(out,'approval-narrow.png')});await win.evaluate(w=>w.setSize(1480,960));
 }
 await form.getByRole('radio',{name:/항상 허용/}).click();const start=Date.now();await form.getByRole('button',{name:'답변 보내기',exact:true}).click();await form.waitFor({state:'hidden',timeout:15000});timings.push({tool,approvalReturnMs:Date.now()-start});
}
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await ready();await send();
 await approve('browser_open');
 await page.locator('.desktop-browser-viewport').waitFor({timeout:20000});checks.push('approved open displays the native browser pane');
 await approve('browser_type');await approve('browser_click');
 await page.getByText('인앱 입력과 클릭 결과를 확인했습니다. 검사 1 완료.',{exact:true}).waitFor({timeout:60000});
 const output=await app.evaluate(async({webContents},prefix)=>{const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith(prefix));return wc?.executeJavaScript('document.querySelector("output").textContent');},url);
 assert.equal(output,'승인 연결 1');checks.push('official MCP snapshot, type, click and DOM readback');
 const native=await app.evaluate(async({BrowserWindow},prefix)=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='app://bundle/index.html'),view=win.contentView.children.find(v=>v.webContents?.getURL().startsWith(prefix));return {visible:view?.getVisible(),bounds:view?.getBounds(),image:(await view.webContents.capturePage()).toPNG().toString('base64')};},url);
 assert.equal(native.visible,true);assert(native.bounds.width>100&&native.bounds.height>100);await writeFile(path.join(out,'native-page.png'),Buffer.from(native.image,'base64'));checks.push('native web view is visible and has page pixels');
 const labels=await page.locator('.nubi-agent-activity').allTextContents();assert(labels.join(' ').includes('웹 요소 클릭'));checks.push('MCP activity is visible');
 const activity=page.locator('.nubi-agent-activity');
 await activity.locator('.nubi-activity-record').evaluateAll(rows=>rows.forEach(el=>el.open=true));
 await activity.locator('details').evaluateAll(rows=>rows.forEach(el=>el.open=true));
 const argumentRows=activity.locator('.nubi-tool-arguments');assert(await argumentRows.count()>=3);
 assert((await argumentRows.locator('pre').allTextContents()).some(text=>text.includes('승인 연결 1')));
 await argumentRows.filter({hasText:'승인 연결 1'}).last().scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(out,'completed-arguments.png')});checks.push('completed activity retains expandable typed JSON arguments');
 await page.screenshot({path:path.join(out,'approved-browser.png')});
 const policy=await request('approvalPolicy');assert.equal(policy.allowedMcpTools.length,3);
 // A real app restart reloads the saved per-tool policy. Another URL and arguments still use that policy.
 await app.close();app=null;cycle=2;phase='open';requested=false;
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await ready();
 assert.equal((await request('approvalPolicy')).allowedMcpTools.length,3);await send();
 await page.getByText('인앱 입력과 클릭 결과를 확인했습니다. 검사 2 완료.',{exact:true}).waitFor({timeout:60000});
 assert.equal(await page.locator('.nubi-question-inline').count(),0);checks.push('always allow survives app restart without repeat prompts');
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'after-restart.png')});
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks,timings,errors,boundary:'Actual macOS Electron UI, worker IPC, official Playwright MCP and local HTTP page. Scripted model. Windows installer and company login not tested.'},null,2));console.log(JSON.stringify({checks,timings}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error('phase',phase,'calls',fixture.calls);throw error;}
finally{await app?.close();fixture.close();web.close();await rm(temporary,{recursive:true,force:true});}
