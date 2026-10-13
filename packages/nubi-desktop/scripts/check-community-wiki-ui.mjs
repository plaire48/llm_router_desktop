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
 for(const width of [1100,440]){
  await p.setViewportSize({width,height:950});await p.goto(origin);
  const tabs=p.getByRole('tablist',{name:'AI Workspace 영역'});await tabs.getByRole('tab').first().waitFor();assert.deepEqual(await tabs.getByRole('tab').allTextContents(),['스킬','위키','앱','Talk']);
  await tabs.getByRole('tab',{name:'앱',exact:true}).click();await p.getByRole('button',{name:/업무 현황/}).click();assert((await p.evaluate(()=>window.calls)).some(c=>c.method==='openWorkspaceApp'&&c.id==='app1'));
  await p.screenshot({animations:'disabled',path:path.join(dir,'apps-'+width+'.png')});await tabs.getByRole('tab',{name:'Talk',exact:true}).click();assert.equal(await tabs.getByRole('tab',{name:'Talk',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await p.locator('.nubi-app-grid').count(),0);await p.getByRole('button',{name:'격자 보기'}).click();await p.locator('.nubi-talk-list[data-view=grid]').waitFor();await p.screenshot({animations:'disabled',path:path.join(dir,'talk-grid-'+width+'.png')});
  await p.getByRole('button',{name:'줄글 보기'}).click();await p.getByRole('button',{name:/실무에서 써 본/}).click();await p.getByRole('textbox',{name:'댓글 내용'}).fill('다음 업무에 활용해 볼게요.');await p.getByRole('button',{name:'댓글 등록'}).click();await p.getByText('댓글을 등록했어요.',{exact:true}).waitFor();
  await p.getByRole('button',{name:'글쓰기',exact:true}).click();const d=p.getByRole('dialog',{name:'Talk 글쓰기'});await assertDesktopDialog(d,{});await d.getByRole('textbox',{name:'글 제목'}).fill('경험 공유');await d.getByRole('textbox',{name:'글 내용'}).fill('유용한 내용을 정리했습니다.');await p.screenshot({animations:'disabled',path:path.join(dir,'talk-compose-'+width+'.png')});await d.getByRole('button',{name:'게시하기'}).click();await d.waitFor({state:'hidden'});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.goto(origin+'/?wiki');await p.getByRole('button',{name:/서비스 운영/}).click();await p.getByRole('button',{name:'위키 수정',exact:true}).click();await p.getByRole('textbox',{name:'위키 본문'}).fill('# 사람이 보완한 운영 지침');await p.getByRole('button',{name:'위키 저장',exact:true}).click();await p.getByText('저장했어요. 다음 위키 조회에 반영됩니다.',{exact:true}).waitFor();await p.getByRole('button',{name:'연결',exact:true}).click();await p.getByRole('img',{name:'2개 문서의 연결'}).waitFor();await p.screenshot({animations:'disabled',path:path.join(dir,'wiki-'+width+'.png')});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 assert.deepEqual(errors,[]);console.log('Workspace tabs, app opening, Talk grid/feed/post/comment, Wiki edit/save/graph: fixture 1100/440px passed.');
}finally{await browser?.close();server.close();}
