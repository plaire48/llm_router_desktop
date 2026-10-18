import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/decision-flow');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));




let browser,p;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',error=>errors.push(error.message));await p.addInitScript(()=>localStorage.removeItem('nubi-session-tabs-v1:fixture'));
 const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [1280,440,360]){
  await p.setViewportSize({width,height:900});
  for(const kind of ['question','command']){
   await p.goto(origin+'/?integrated&modals&toolbar&decision='+kind);
   const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
   await p.locator('.nubi-session-select').filter({hasText:'요청한 결과를 확인해 주세요.'}).click();
   const form=p.locator(kind==='question'?'.nubi-question-inline':'.nubi-approval-form');await form.waitFor();
   assert.equal(await p.locator('[aria-modal="true"]').count(),0);
   assert.equal(await p.locator('.nubi-decision-toast').count(),0);
   assert.equal(await p.evaluate(()=>window.decisionCalls.length),0,'rendering never approves');
   const send=form.getByRole('button',{name:kind==='question'?'답변 보내기':'승인',exact:true});
   await send.scrollIntoViewIfNeeded();
   const geometry=await form.evaluate(node=>[node,...node.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1).slice(0,12).map(e=>({class:e.className,width:e.clientWidth,scroll:e.scrollWidth,css:getComputedStyle(e).margin,left:e.getBoundingClientRect().left})));assert(await form.evaluate(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1;}),JSON.stringify(geometry));
   assert(await send.evaluate(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth;}));
   if(kind==='question'){
    assert(await send.isDisabled());await form.getByRole('radio',{name:/표로 정리/}).click();
    await form.getByRole('textbox',{name:'기타',exact:true}).fill('중요한 항목부터 정리');
   }else{
    assert(await form.getByRole('button',{name:'취소',exact:true}).isVisible());
    const copy=form.locator('.nubi-terminal-bar').getByRole('button',{name:'명령어 복사',exact:true});
    await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copiedCommand=text}}));
    await copy.click();await form.locator('.nubi-terminal-bar').getByRole('button',{name:'명령어 복사 완료',exact:true}).waitFor();
    assert.equal(await p.evaluate(()=>window.copiedCommand),'node --version');
   }
   assert.equal(await p.evaluate(()=>window.decisionCalls.length),0);
   await form.screenshot({path:path.join(dir,kind+'-'+width+'.png'),animations:'disabled'});
   await send.click();await form.waitFor({state:'hidden'});
   assert.equal(await p.evaluate(()=>window.decisionCalls.length),1);
   assert.equal(await p.evaluate(()=>window.decisionCalls[0].method),kind==='question'?'answerAgent':'decideSetupAction');
  }
  console.log('PASS '+width+'px inline question/command, safe bounds, visible actions, copying never executes, explicit submission only.');
 }
 await p.addInitScript(()=>{
  window.nativeNotices=[];window.nativeNoticeListeners=new Set();
  window.nubi={desktop:true,platform:'win32',request:async(method,args)=>{if(method==='decisionNotice')window.nativeNotices.push(args);return {};},onHostEvent:callback=>{window.nativeNoticeListeners.add(callback);return()=>window.nativeNoticeListeners.delete(callback);}};
 });
 await p.goto(origin+'/?integrated&modals&toolbar&decision=command');
 await p.waitForFunction(()=>window.nativeNotices.some(row=>row.action==='show'));
 const noticeId=await p.evaluate(()=>window.nativeNotices.find(row=>row.action==='show').id);
 await p.evaluate(id=>window.nativeNoticeListeners.forEach(callback=>callback({type:'decision_open',id})),noticeId);
 const form=p.locator('.nubi-approval-form');await form.waitFor();
 await p.waitForFunction(()=>document.activeElement?.matches('.nubi-approval-form'));
 assert.equal(await p.evaluate(()=>window.decisionCalls.length),0,'OS click only reveals inline form');
 assert.equal(await p.locator('[aria-modal="true"]').count(),0);
 await form.getByRole('button',{name:'취소',exact:true}).click();await form.waitFor({state:'hidden'});
 assert.equal(await p.evaluate(()=>window.decisionCalls[0].decision),'reject');
 await p.waitForFunction(id=>window.nativeNotices.some(row=>row.action==='clear'&&row.id===id),noticeId);
 console.log('PASS native-event bridge focuses inline approval and cancellation clears notice. OS delivery mocked.');
 assert.deepEqual(errors,[]);
} catch(error){if(p)await p.screenshot({path:path.join(dir,'failure.png')});throw error;} finally{await browser?.close();server.close();}
