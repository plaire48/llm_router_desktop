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
  await p.setViewportSize({width,height:800});
  for(const kind of ['question','command']){
   await p.goto(origin+'/?integrated&modals&toolbar&decision='+kind);
   const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
   await p.locator('.nubi-session-select').filter({hasText:'요청한 결과를 확인해 주세요.'}).click();
   assert.equal(await p.locator('[aria-modal="true"]').count(),0,'question never steals focus');
   assert.equal(await p.locator('.nubi-decision-toast').count(),0,'no in-app imitation toast');
   await p.getByRole('button',{name:kind==='question'?'답변하기':'확인하고 실행',exact:true}).click();
   const dialog=p.getByRole('dialog',{name:kind==='question'?'결과를 어떤 형식으로 정리할까요?':'이 명령을 실행할까요?',exact:true});await dialog.waitFor();
   assert.equal(await p.locator('[aria-modal="true"]').count(),1);
   assert(await dialog.evaluate(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight;}));
   assert.equal(await p.getByText('실행 후 확인 방법',{exact:true}).count(),0);
   assert.equal(await p.evaluate(()=>window.decisionCalls.length),0);
   if(kind==='question'){
    assert.equal(await dialog.locator('.question-option-index').first().innerText(),'1');
    assert.equal(await dialog.locator('.question-select-indicator').count(),0,'number and selection share one position');
    await dialog.screenshot({path:path.join(dir,'question-empty-'+width+'.png'),animations:'disabled'});
    await dialog.getByRole('checkbox',{name:/표로 정리/}).click();
    await dialog.getByRole('textbox',{name:'기타',exact:true}).fill('중요한 항목부터 정리');
    assert.equal(await p.evaluate(()=>window.decisionCalls.length),0,'selecting only saves a draft');
   }
   await p.screenshot({path:path.join(dir,kind+'-'+width+'.png'),animations:'disabled'});
   if(kind==='question')await dialog.getByRole('button',{name:'나중에',exact:true}).click();else await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
   assert.equal(await p.evaluate(()=>window.decisionCalls.length),0,'defer never sends an answer');
   await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await p.locator('[aria-modal="true"]').count(),0,'dismissed decisions do not reopen');
   const trigger=p.getByRole('button',{name:kind==='question'?'답변하기':'확인하고 실행',exact:true});assert(await trigger.evaluate(node=>document.activeElement===node));await trigger.click();await dialog.waitFor();
   if(kind==='question'){
    assert.equal(await dialog.getByRole('textbox',{name:'기타',exact:true}).inputValue(),'중요한 항목부터 정리');
    assert.equal(await dialog.getByRole('checkbox',{name:/표로 정리/}).getAttribute('aria-checked'),'true');
    await dialog.getByRole('checkbox',{name:/문장으로 정리/}).press('Space');
    assert.equal(await p.evaluate(()=>window.decisionCalls.length),0);
    await dialog.getByRole('button',{name:'답변 보내기',exact:true}).click();
    await dialog.waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.decisionCalls[0].method),'answerAgent');
    assert.equal(await p.evaluate(()=>window.decisionCalls[0].choice.text),'표로 정리\n문장으로 정리\n기타: 중요한 항목부터 정리');
   }else{
    await dialog.getByRole('button',{name:'실행',exact:true}).click();await dialog.waitFor({state:'hidden'});
    assert.equal(await p.evaluate(()=>window.decisionCalls[0].decision),'approve');
   }
   assert.equal(await p.evaluate(()=>window.decisionCalls.length),1,'exactly one explicit decision');
  }
  console.log('PASS '+width+'px: one decision modal, bounds, defer/reopen, draft preserved, explicit answer/approval only.');
 }
 await p.goto(origin+'/?integrated&modals&toolbar&decision=question');
 const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
 await p.locator('.nubi-session-select').filter({hasText:'요청한 결과를 확인해 주세요.'}).click();
 assert.equal(await p.locator('.nubi-decision-toast').count(),0);
 assert.equal(await p.locator('[aria-modal="true"]').count(),0);
 await p.getByRole('button',{name:'답변하기',exact:true}).click();
 const form=p.getByRole('dialog',{name:'결과를 어떤 형식으로 정리할까요?'}),send=form.getByRole('button',{name:'답변 보내기',exact:true});
 assert(await send.isDisabled());
 const other=form.getByRole('textbox',{name:'기타',exact:true});await other.fill('다른 방식으로');
 await other.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});
 assert.equal(await p.evaluate(()=>window.decisionCalls.length),0,'IME composition cannot submit');
 await p.evaluate(()=>window.decisionSendFailure=true);await send.click();
 await form.locator('.cx-kit-field-error').waitFor();assert.equal(await other.inputValue(),'다른 방식으로');
 assert.equal(await p.evaluate(()=>window.decisionCalls.length),0,'failure retains the pending question');
 await p.evaluate(()=>window.decisionSendFailure=false);await send.click();await form.waitFor({state:'hidden'});
 assert.equal(await p.evaluate(()=>window.decisionCalls[0].choice.text),'다른 방식으로');
 console.log('PASS no in-app toast, empty answer, IME, text-only answer and failed-send recovery.');
 await p.addInitScript(()=>{
  window.nativeNotices=[];window.nativeNoticeListeners=new Set();
  window.nubi={desktop:true,platform:'win32',request:async(method,args)=>{if(method==='decisionNotice')window.nativeNotices.push(args);return {};},onHostEvent:callback=>{window.nativeNoticeListeners.add(callback);return()=>window.nativeNoticeListeners.delete(callback);}};
 });
 await p.goto(origin+'/?integrated&modals&toolbar&decision=question');
 await p.waitForFunction(()=>window.nativeNotices.some(row=>row.action==='show'));
 assert.equal(await p.locator('[aria-modal="true"]').count(),0);
 const noticeId=await p.evaluate(()=>window.nativeNotices.find(row=>row.action==='show').id);
 await p.evaluate(id=>window.nativeNoticeListeners.forEach(callback=>callback({type:'decision_open',id})),noticeId);
 const nativeForm=p.getByRole('dialog',{name:'결과를 어떤 형식으로 정리할까요?',exact:true});await nativeForm.waitFor();
 assert.equal(await p.evaluate(()=>window.decisionCalls.length),0,'OS click only opens the form');
 await nativeForm.getByRole('checkbox',{name:/표로 정리/}).click();await nativeForm.getByRole('button',{name:'답변 보내기',exact:true}).click();await nativeForm.waitFor({state:'hidden'});
 await p.waitForFunction(id=>window.nativeNotices.some(row=>row.action==='clear'&&row.id===id),noticeId);
 await p.evaluate(id=>window.nativeNoticeListeners.forEach(callback=>callback({type:'decision_open',id})),noticeId);
 assert.equal(await p.locator('[aria-modal="true"]').count(),0,'stale OS click cannot reopen an answered question');
 console.log('PASS native-event bridge: opens the owning conversation, explicit answer, clears stale notice. OS delivery is mocked here.');
 assert.deepEqual(errors,[]);
} catch(error){if(p)await p.screenshot({path:path.join(dir,'failure.png')});throw error;} finally{await browser?.close();server.close();}
