import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/profile-wiki');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/profile-wiki-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><style>main {padding:24px;max-width:1000px;margin:auto} .nubi-account-profile {margin-block:24px}</style><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));



let browser;const errors=[];
try {
 browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({viewport:{width:1100,height:950}});p.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [1100,440]){
  await p.setViewportSize({width,height:950});await p.goto(origin);await p.getByText('서비스 운영 위키',{exact:true}).waitFor();
  assert.equal(await p.locator('.nubi-account-status-emoji').count(),2);
  /* Status follows the name. */
  for(const emoji of await p.locator('.nubi-account-status-emoji').all()){const place=await emoji.evaluate(e=>{const scope=e.closest('.nubi-account-button,.nubi-account-profile'),a=scope.querySelector('.nubi-account-avatar').getBoundingClientRect(),b=e.getBoundingClientRect();const nameLabel=scope.querySelector('.nubi-account-name-label, .nubi-account-name-row strong'),nameShown=!!nameLabel&&nameLabel.getClientRects().length>0&&nameLabel.getBoundingClientRect().width>0;return {nameShown,right:b.left>=a.right,level:b.top+b.height/2>a.top&&b.top+b.height/2<a.bottom,below:b.top>=a.bottom-1&&b.right>a.left&&b.left<a.right,a:[a.left,a.top,a.right,a.bottom],b:[b.left,b.top,b.right,b.bottom]};});/* Beside the name when the name is shown; under the avatar in the narrow rail where the name is hidden (Codex rail 56px, 2026-10-17). */assert(place.nameShown?place.right&&place.level:(place.right&&place.level)||place.below,JSON.stringify(place));}
  await p.getByText('서비스 운영 위키',{exact:true}).click();const info=p.getByRole('dialog',{name:'위키 정보'});await info.waitFor();/* The audience control sits inside the folded 관리 정보 section (modal density decision 2026-10-16). */const admin=info.locator('details').filter({hasText:'관리 정보'}).first();if(await admin.count()&&!(await admin.getAttribute('open')))await admin.locator('summary').click();await info.getByRole('button',{name:'변경',exact:true}).click();
  const dialog=p.getByRole('dialog',{name:'위키 표시 대상'});await dialog.waitFor();await assertDesktopDialog(dialog,{});
  await dialog.getByRole('combobox',{name:'앱 표시 대상'}).click();await p.getByRole('option',{name:'지정한 사람',exact:true}).click();await dialog.getByRole('combobox',{name:'표시할 사람',exact:true}).fill('누비');await dialog.getByRole('option',{name:/김누비/}).click();await dialog.getByRole('button',{name:'김누비 제외'}).waitFor();await dialog.getByRole('combobox',{name:'표시할 사람',exact:true}).fill('carol@example.test');await dialog.getByRole('option',{name:/이누비/}).waitFor();assert.match(await dialog.getByRole('option',{name:/이누비/}).textContent(),/이누비carol@example.test/);assert.doesNotMatch(await dialog.getByRole('option',{name:/이누비/}).textContent(),/운영팀|@carol/);
  assert.equal(await dialog.getByRole('combobox',{name:'표시할 사람',exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'none');const chips=await dialog.locator('.nubi-person-chips').boundingBox(),results=await dialog.locator('.nubi-person-results').boundingBox();assert(chips.y>=results.y+results.height-1,'selected chips follow the search results');await p.screenshot({path:path.join(dir,'audience-'+width+'.png')});await dialog.getByRole('combobox',{name:'표시할 사람',exact:true}).press('Enter');await dialog.getByRole('button',{name:'이누비 제외'}).waitFor();await dialog.getByRole('button',{name:'저장',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const payload=await p.evaluate(()=>window.wikiCalls.findLast(x=>x.action==='publish'));assert.deepEqual(payload.metadata.audience,{scope:'selected',readers:['bob','carol']});assert.equal(payload.audienceOnly,true);assert.equal(await p.getByText('검토 응답 형식 확인 필요',{exact:true}).count(),1);
  await p.evaluate(()=>window.setProfileStatus({emoji:'😄',message:'expired',expiresAt:new Date(Date.now()-100).toISOString()}));await p.waitForFunction(()=>!document.querySelector('.nubi-account-status-emoji'));
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 assert.deepEqual(errors,[]);console.log('Profile badge and Wiki audience: 1100/440px passed; expired emoji hidden; saved audience verified.');
} finally {await browser?.close();server.close();}
