import {desktopTestWindow} from './electron-test-window.mjs';
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {outer,inner,child} from '../tests/fixtures-mail-mime.mjs';

// Real built Electron/IPC and native encrypted storage, with synthetic mail only.
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-mime-native-'));
const root=path.join(temporary,'project'),storage=path.join(temporary,'state'),archive=path.join(temporary,'archive');
const output=path.resolve('verification/mail-mime-container-2026-10-16');
await mkdir(path.join(root,'openwiki'),{recursive:true});await mkdir(storage);await mkdir(path.join(archive,'AUTO_INBOX'),{recursive:true});await mkdir(output,{recursive:true});
await writeFile(path.join(root,'openwiki/home.md'),'# Local project\n');
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
await writeFile(path.join(archive,'AUTO_INBOX','outer.eml'),outer());
let app,page;const styles=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'personal'),ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});
 await page.emulateMedia({reducedMotion:'reduce'});
 await (await app.browserWindow(page)).evaluate(window=>window.webContents.setBackgroundThrottling(false));
 await page.locator('.nubi-sidebar-project').first().waitFor();
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.nubi.request('mail',{action:'setAutoWiki',enabled:false}));
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},archive);
 const result=await page.evaluate(()=>window.nubi.request('importMailFolder'));assert(!result.__nubiError,JSON.stringify(result));
 let status;
 for(let i=0;i<120;i++){
  status=await page.evaluate(()=>window.nubi.request('mail',{action:'status'}));
  if(['completed','failed','cancelled'].includes(status.localImport?.state))break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.equal(status.localImport?.state,'completed',JSON.stringify(status.localImport));assert.equal(status.localCount,1);
 await page.getByRole('button',{name:'메일',exact:true}).click();
 await page.getByRole('button',{name:'Outer message',exact:true}).click();
 await page.getByRole('button').filter({has:page.locator('strong',{hasText:'export.dat'})}).click();
 const mail=page.getByRole('article',{name:'첨부 메일',exact:true});await mail.getByRole('heading',{name:'Inner message',exact:true}).waitFor();
 assert.equal(await page.locator('#nubi-auxiliary-pane').getByRole('button',{name:'AI에 질문',exact:true}).count(),1);
 assert.equal(await page.locator('#nubi-auxiliary-pane').getByRole('textbox').count(),0,'questions use the common agent composer');
 assert.equal(await mail.locator('.nubi-mail-sender strong').innerText(),'Alice');
 assert.equal(await mail.locator('.nubi-mail-reader-heading').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
 const frame=page.frameLocator('iframe[title="첨부 메일 본문"]');await frame.getByRole('heading',{name:'내부 메일 본문',exact:true}).waitFor();
 await assertTheme();
 assert.equal(await mail.getByRole('region',{name:'내부 첨부 파일'}).locator('.nubi-mail-attachment-row').count(),1);
 assert.equal(await mail.locator('.nubi-mail-attachment-label strong').innerText(),'notes.txt');
 assert.equal(await frame.locator('script').count(),0);
 assert(await page.getByRole('heading',{name:'Outer message',exact:true}).isVisible(),'parent mail stays visible');
 await page.mouse.move(0,0);await recordStyles();
 await page.screenshot({path:path.join(output,'native-mail.png'),animations:'disabled'});
 const downloaded=path.join(temporary,'downloaded.txt');
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},downloaded);
 await mail.getByRole('button',{name:'notes.txt 다운로드',exact:true}).click();
 await mail.getByText('파일을 저장했어요.',{exact:true}).waitFor();assert.deepEqual(await readFile(downloaded),child);
 // The outer container is still independently downloadable without rewriting it.
 const original=path.join(temporary,'export.dat');
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},original);
 await page.getByRole('button',{name:'첨부 원본 다운로드',exact:true}).click();
 await assertFile(original,inner);
 await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();
 assert(await page.getByRole('heading',{name:'Outer message',exact:true}).isVisible());
 await page.getByRole('button').filter({has:page.locator('strong',{hasText:'export.dat'})}).click();
 await mail.getByRole('heading',{name:'Inner message',exact:true}).waitFor();
 await page.getByRole('button',{name:'추출 텍스트 보기',exact:true}).focus();await page.keyboard.press('Enter');
 assert.match(await page.locator('.nubi-document-source').innerText(),/내부 메일 본문/);
 await page.getByRole('button',{name:'문서 보기',exact:true}).focus();await page.keyboard.press('Space');
 if(await page.getByRole('button',{name:'알림 닫기',exact:true}).count())await page.getByRole('button',{name:'알림 닫기',exact:true}).click();
 for(const width of [1100,440]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  await mail.getByRole('heading',{name:'Inner message',exact:true}).waitFor();
  const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.equal(overflow.width,width);
  assert(overflow.scroll<=overflow.width+1,JSON.stringify(overflow));
  const controls=await mail.getByRole('group',{name:'첨부 메일 도구'}).getByRole('button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  for(const [i,a]of controls.entries())for(const b of controls.slice(i+1))assert(!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top),'mail controls must not overlap');
  assert(controls.every(r=>r.left>=0&&r.right<=width+1),'mail controls stay inside the viewport');
  await assertTheme();
  await recordStyles();
  await page.screenshot({path:path.join(output,`native-mail-${width}.png`),animations:'disabled'});
 }
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'computed-styles.json'),JSON.stringify(styles,null,2));
 await writeFile(path.join(output,'native-checks.json'),JSON.stringify({passed:true,scope:'Built macOS Electron, synthetic EML, real encrypted intake and IPC; native save dialog selection supplied by test.',checks:['content-based MIME attachment preview','mail headers and HTML body','only actual inner attachment listed','inner and parent original download byte identity','parent mail preserved','close and reopen','text view toggle with Enter/Space','single common mail action row and no duplicate question composer','sender name/address hierarchy and plain heading','1100/440 widths at 20px root font','no page overflow or action overlap'],windowsOfficeVerified:false,liveCompanyVerified:false,errors},null,2));
 console.log('Built Electron MIME attachment flow passed.');
}catch(error){await page?.screenshot({path:path.join(output,'native-failure.png'),timeout:5000}).catch(()=>{});console.error(await page?.evaluate(()=>document.body.innerText.slice(-7000)).catch(()=>''));throw error;}
finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
async function assertFile(file,expected){for(let i=0;i<100;i++){try{assert.deepEqual(await readFile(file),expected);return;}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('File was not saved');}
async function compareStyles(){return page.evaluate(()=>{
 const props=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom','borderRadius','borderBottomColor','borderBottomWidth','gap'];
 const styles=node=>node?Object.fromEntries(props.map(prop=>[prop,getComputedStyle(node)[prop]])):null;
 const parts=['.nubi-mail-reader-heading','.nubi-mail-reader-heading h2','.nubi-mail-reader-envelope','.nubi-mail-sender strong','.nubi-mail-sender span','.nubi-mail-addresses','.nubi-mail-reader-actions','.nubi-mail-ask','.nubi-mail-attachments','.nubi-mail-attachments h3','.nubi-mail-attachment','.nubi-mail-attachment-label strong','.nubi-muted'];
 return {width:innerWidth,rootFont:getComputedStyle(document.documentElement).fontSize,parts:Object.fromEntries(parts.map(selector=>[selector,{mail:styles(document.querySelector('.nubi-mail-history-detail '+selector)),attachment:styles(document.querySelector('.desktop-mail-source '+selector))}]))};
 });}
async function recordStyles(){
 const row=await compareStyles();
 for(const [selector,pair]of Object.entries(row.parts)){
  if(!pair.mail||!pair.attachment)continue;
  for(const property of ['fontFamily','fontSize','fontWeight','lineHeight','color','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom','borderRadius','gap'])assert.equal(pair.attachment[property],pair.mail[property],`${selector} ${property} must match the existing mail surface`);
 }
 styles.push(row);
}
async function assertTheme(){
 const actual=await page.locator('iframe[title="첨부 메일 본문"]').evaluate(async frame=>{
  const faces=await frame.contentDocument.fonts.load('16px "Noto Sans KR"','메일');
  if(!faces.length||faces.some(face=>face.status!=='loaded'))throw Error('Bundled Korean fonts must load in the isolated mail document');
  const body=getComputedStyle(frame.contentDocument.body),host=getComputedStyle(frame.closest('.desktop-mail-source')),subject=getComputedStyle(frame.closest('article').querySelector('h2'));
  return {font:body.fontFamily,expectedFont:host.fontFamily,size:body.fontSize,expectedSize:getComputedStyle(document.documentElement).fontSize,color:body.color,expectedColor:host.color,heading:getComputedStyle(frame.contentDocument.querySelector('h1')).fontSize,expectedHeading:subject.fontSize};
 });
 assert.equal(actual.font,actual.expectedFont);assert.equal(actual.size,actual.expectedSize);assert.equal(actual.color,actual.expectedColor);assert.equal(actual.heading,actual.expectedHeading);
}
