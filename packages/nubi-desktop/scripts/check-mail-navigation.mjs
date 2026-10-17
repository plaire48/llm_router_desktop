import {build,stop} from 'esbuild';
import {mkdir,writeFile,readFile,copyFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/mail-navigation-2026-10-15');await mkdir(path.join(dir,'chunks'),{recursive:true});
await build({entryPoints:['tests/mail-navigation-fixture.jsx'],outdir:dir,entryNames:'app',bundle:true,splitting:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.png':'dataurl','.webp':'dataurl'},define:{'process.env.NODE_ENV':'"production"',__APP_VERSION__:'"fixture"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><title>누비 메일함과 결재</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>`);
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();const bytes=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;try{
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1100,height:900}});const errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1100,600,440]){
 await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}`);
 const mailboxes=page.getByRole('tablist',{name:'메일함',exact:true});await mailboxes.waitFor();console.log('tabs',width);
 await mailboxes.getByRole('tab',{name:'개인 폴더',exact:true}).waitFor();
 assert.deepEqual(await mailboxes.getByRole('tab').allTextContents(),['받은 메일함','보낸 메일함','임시 보관함','스팸 메일함','개인 폴더']);
 await page.waitForFunction(()=>document.querySelector('#mailbox-draft')?.getAttribute('aria-selected')==='true');
 for(const [key,name] of [['inbox','받은 메일함'],['sent','보낸 메일함'],['draft','임시 보관함'],['spam','스팸 메일함']]){await mailboxes.getByRole('tab',{name,exact:true}).click();await page.waitForFunction(key=>window.mailCalls.some(call=>call.action==='search'&&call.filters.mailbox===key),key);}
 await mailboxes.getByRole('tab',{name:'개인 폴더',exact:true}).click();
 await page.waitForFunction(()=>window.mailCalls.some(call=>call.action==='search'&&call.filters.mailbox==='folder:6'));
 const picker=page.getByRole('combobox',{name:'개인 폴더 선택',exact:true});await picker.click();
 await page.getByRole('option',{name:'오래된 업무와 개인 보관 자료가 담긴 긴 이름의 폴더',exact:true}).click();
 await page.waitForFunction(()=>window.mailCalls.some(call=>call.action==='search'&&call.filters.mailbox==='folder:7'));
 await mailboxes.getByRole('tab',{name:'받은 메일함',exact:true}).click();await mailboxes.getByRole('tab',{name:'개인 폴더',exact:true}).click();
 assert.match(await picker.innerText(),/오래된 업무/);
 await page.evaluate(()=>window.remountMail());await page.waitForFunction(()=>document.querySelector('#mailbox-personal')?.getAttribute('aria-selected')==='true');assert.match(await picker.innerText(),/오래된 업무/);
 await picker.click();const menu=page.getByRole('listbox');await menu.waitFor();const box=await menu.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);await page.screenshot({path:path.join(dir,`personal-folders-${width}.png`)});await picker.press('Escape');
 console.log('searched',width);const approvals=page.getByRole('tab',{name:'결재',exact:true});assert(await approvals.isVisible());assert(await page.locator('.nubi-mail-history').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(dir,`mail-${width}.png`)});
 await approvals.click();const pending=page.getByRole('button',{name:/결재 문서/});await pending.waitFor();assert.equal(await pending.isEnabled(),true);await page.getByRole('status',{name:'결재 제목 확인 중'}).waitFor();await page.screenshot({path:path.join(dir,`approval-pending-${width}.png`)});
 await page.evaluate(()=>window.resolveTitle());await page.getByRole('button',{name:'시스템 개선 검토 요청',exact:true}).click();await page.getByRole('heading',{name:'시스템 개선 검토 요청'}).waitFor();await page.frameLocator('iframe').getByText('검토할 결재 본문').waitFor();await page.screenshot({path:path.join(dir,`approval-${width}.png`)});
 await page.getByRole('button',{name:'다음 결재 페이지'}).click();await page.getByRole('button',{name:'예산 승인 요청'}).waitFor();assert(await page.getByRole('button',{name:'다음 결재 페이지'}).isDisabled());
 await page.evaluate(()=>window.remountMail());await page.waitForFunction(()=>document.querySelector('#portal-view-approvals')?.getAttribute('aria-selected')==='true');
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks:['four Korean mailbox tabs and personal folder picker','legacy server-folder selection migrated','category search for each tab','personal folder exact-ID search and re-entry','long folder names and menu fit at 1100, 600 and 440px','approval tab visible','approval rows usable before title hydration','approval body and pagination','approval tab retained on re-entry'],boundary:'Real Chrome with synthetic portal responses. Company portal and Windows installation unverified.'},null,2));console.log('Mail navigation, personal folders and approval UI passed');
}catch(error){await page?.screenshot({path:path.join(dir,'failure.png'),timeout:3000}).catch(()=>{});console.error(error);throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));stop();}
