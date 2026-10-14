import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/community-wiki');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/community-wiki-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><style>body{margin:0} .nubi-skill-page{height:100vh;overflow:auto} .nubi-skill-page-body{padding:20px}</style><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));



let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({viewport:{width:1100,height:950},reducedMotion:'reduce'});p.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [1100,440,360]){
  await p.setViewportSize({width,height:950});await p.goto(origin);
  const tabs=p.getByRole('tablist',{name:'AI Workspace 영역'});await tabs.getByRole('tab').first().waitFor();assert.deepEqual(await tabs.getByRole('tab').allTextContents(),['스킬','위키','앱','Talk','문의']);
  await tabs.getByRole('tab',{name:'문의',exact:true}).click();await p.getByRole('region',{name:'문의'}).getByText('문의는 누비 Workspace 앱에서 사내 로그인 뒤 사용할 수 있어요.').waitFor();await tabs.getByRole('tab',{name:'앱',exact:true}).click();
  await tabs.getByRole('tab',{name:'앱',exact:true}).click();assert.equal(await p.getByRole('heading',{name:'앱',exact:true}).count(),0,'the tab names the section; no repeated heading');await p.getByRole('button',{name:'등록',exact:true}).click();const register=p.getByRole('region',{name:'앱 등록'});await register.waitFor();assert.equal(await p.getByRole('dialog').count(),0);await register.getByRole('button',{name:'돌아가기',exact:true}).click();await register.waitFor({state:'hidden'});await p.getByRole('button',{name:/업무 현황/}).click();assert((await p.evaluate(()=>window.calls)).some(c=>c.method==='openWorkspaceApp'&&c.id==='app1'));
  await p.screenshot({animations:'disabled',path:path.join(dir,'apps-'+width+'.png')});await tabs.getByRole('tab',{name:'Talk',exact:true}).click();assert.equal(await tabs.getByRole('tab',{name:'Talk',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await p.locator('.nubi-app-grid').count(),0);await p.getByRole('button',{name:'격자 보기'}).click();await p.locator('.nubi-talk-list[data-view=grid]').waitFor();await p.screenshot({animations:'disabled',path:path.join(dir,'talk-grid-'+width+'.png')});
  await p.getByRole('button',{name:'줄글 보기'}).click();await p.getByRole('button',{name:/실무에서 써 본/}).click();
  // Authors show the session-read avatar, the name with the email beside it, and a compact profile card on hover (user request 2026-10-14).
  const author=p.locator('.nubi-talk-detail .nubi-talk-person').first();await author.locator('img').waitFor();assert.match(await author.innerText(),/김누비[\s\S]*nubi@example.test/);await author.hover();const card=p.getByRole('tooltip');await card.waitFor();assert.match(await card.innerText(),/김누비[\s\S]*nubi@example.test[\s\S]*제조IT/);await p.screenshot({animations:'disabled',path:path.join(dir,'talk-person-'+width+'.png')});await p.mouse.move(5,5);await card.waitFor({state:'hidden'});await p.getByRole('textbox',{name:'댓글 내용'}).fill('다음 업무에 활용해 볼게요.');await p.getByRole('button',{name:'댓글 등록'}).click();await p.getByText('댓글을 등록했어요.',{exact:true}).waitFor();
  // The composer is a page in place of the list, as ai_workspace shows it, not a dialog (user decision 2026-10-14).
  await p.getByRole('button',{name:'글쓰기',exact:true}).click();const d=p.getByRole('region',{name:'Talk 글쓰기'});await d.waitFor();assert.equal(await p.getByRole('dialog').count(),0);await d.getByRole('textbox',{name:'글 제목'}).fill('경험 공유');await d.getByRole('textbox',{name:'글 내용'}).fill('유용한 내용을 정리했습니다.');await p.screenshot({animations:'disabled',path:path.join(dir,'talk-compose-'+width+'.png')});await d.getByRole('button',{name:'글 등록',exact:true}).click();await d.waitFor({state:'hidden'});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.goto(origin+'/?wiki');
  await p.locator('.nubi-wiki-document h2').filter({hasText:'서비스 운영'}).waitFor();
  assert.equal((await p.evaluate(()=>window.calls)).filter(c=>c.action==='read').length,1,'entry opens the project home without another click');
  await p.getByRole('navigation',{name:''}).filter({has:p.getByRole('button',{name:'배포 절차'})}).getByRole('button',{name:'배포 절차'}).click();
  await p.locator('.nubi-wiki-document h2').filter({hasText:'배포 절차'}).waitFor();
  await p.getByRole('button',{name:'대화로 돌아가기',exact:true}).click();await p.getByRole('button',{name:'위키 다시 열기',exact:true}).click();
  await p.locator('.nubi-wiki-document h2').filter({hasText:'배포 절차'}).waitFor();
  await p.getByRole('searchbox',{name:'위키 문서 검색'}).fill('서비스');await p.getByRole('searchbox',{name:'위키 문서 검색'}).press('Enter');
  await p.locator('.nubi-wiki-document h2').filter({hasText:'서비스 운영'}).waitFor();
  await p.getByRole('searchbox',{name:'위키 문서 검색'}).fill('');
  await p.getByRole('button',{name:'위키 수정',exact:true}).click();await p.getByRole('textbox',{name:'위키 본문'}).fill('# 저장 전 메모');
  await p.getByRole('tab',{name:'메일',exact:true}).click();await p.locator('.nubi-wiki-document h2').waitFor();
  await p.getByRole('tab',{name:'업무 프로젝트',exact:true}).click();await p.getByRole('textbox',{name:'위키 본문'}).waitFor();
  assert.equal(await p.getByRole('textbox',{name:'위키 본문'}).inputValue(),'# 저장 전 메모','scope switch preserves unsaved text and selected document');
  await p.getByRole('button',{name:'수정 취소',exact:true}).click();
  await p.screenshot({animations:'disabled',path:path.join(dir,'wiki-reading-'+width+'.png')});
  await p.getByRole('button',{name:'위키 수정',exact:true}).click();await p.getByRole('textbox',{name:'위키 본문'}).fill('# 사람이 보완한 운영 지침');await p.getByRole('button',{name:'위키 저장',exact:true}).click();await p.getByText('저장했어요. 다음 위키 조회에 반영됩니다.',{exact:true}).waitFor();await p.getByRole('tab',{name:'관계 지도',exact:true}).click();await p.getByRole('img',{name:'2개 문서의 연결'}).waitFor();await p.locator('.nubi-wiki-map-side').getByRole('button',{name:/^배포 절차/}).click();await p.locator('.nubi-wiki-document h2').filter({hasText:'배포 절차'}).waitFor();await p.screenshot({animations:'disabled',path:path.join(dir,'wiki-'+width+'.png')});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 assert.deepEqual(errors,[]);console.log('Workspace tabs, app opening, Talk grid/feed/post/comment, Wiki edit/save/graph: fixture 1100/440/360px passed, with direct opening, last document restoration, related navigation, Enter search and draft retention.');
}finally{await browser?.close();server.close();}
