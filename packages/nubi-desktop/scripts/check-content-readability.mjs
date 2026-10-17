import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const before=process.argv.includes('--before'),stage=before?'before':'after',dir=path.resolve('verification/content-readability-2026-10-16');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/readability-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><title>누비 가독성 검토</title><link rel="stylesheet" href="app.css"><div class="desktop-shell"><div id="root"></div></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2'})[path.extname(file)]||'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const results=[],errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const [width,height,scale] of [[1280,900,100],[440,820,100],[360,640,100],[440,640,200]])for(const view of ['update','reset-mail','reset-wiki','wiki-detail','wiki-editor']){
  await p.setViewportSize({width,height});await p.emulateMedia({reducedMotion:'reduce'});await p.goto(`http://127.0.0.1:${server.address().port}/?view=${view}`);
  if(view==='wiki-detail')await p.locator('.nubi-wiki-repo-open').first().click();
  if(view==='wiki-editor')await p.getByRole('button',{name:'위키 등록',exact:true}).click();
  const dialog=p.locator('.deck-dialog:visible').first();await dialog.waitFor();await p.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);await p.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  if(view==='wiki-detail')await dialog.getByRole('button',{name:'다운로드',exact:true}).waitFor();
  const measure=await dialog.evaluate(el=>({text:el.innerText.length,width:el.clientWidth,scroll:el.scrollWidth,buttons:[...el.querySelectorAll('button')].filter(x=>x.checkVisibility()).map(x=>x.getAttribute('aria-label')||x.textContent.trim())}));
  await p.screenshot({path:path.join(dir,`${stage}-${view}-${width}-${scale}.png`),animations:'disabled'});
  if(!before){
   assert(measure.scroll<=measure.width+1,JSON.stringify({view,width,measure}));
   const footerFits=await dialog.evaluate(el=>{const footer=el.querySelector('.cx-panel-footer');if(!footer)return true;const bounds=el.getBoundingClientRect();return [...footer.querySelectorAll('button')].every(button=>{const b=button.getBoundingClientRect();return b.left>=bounds.left&&b.right<=bounds.right&&b.bottom<=bounds.bottom;});});
   assert(footerFits,`${view} ${width} ${scale}: footer actions fit`);
   if(view==='update'){
    const details=dialog.locator('details').filter({hasText:'업데이트 내용'});assert.equal(await details.getAttribute('open'),null);
    await details.locator('summary').click();await p.getByText('메일과 위키의 연결 흐름을 개선했습니다.',{exact:false}).waitFor();await details.locator('summary').click();
    await dialog.getByRole('button',{name:'업데이트',exact:true}).click();assert(await p.evaluate(()=>window.started));
   }
   if(view==='wiki-detail'){
    const details=dialog.locator('details').filter({hasText:'관리 정보'});assert.equal(await details.getAttribute('open'),null);await details.locator('summary').click();await dialog.getByText('maintainer',{exact:false}).waitFor();
    assert(await dialog.getByRole('button',{name:'다운로드',exact:true}).isEnabled());
    await dialog.getByRole('button',{name:'새 버전',exact:true}).click();
    const editor=p.getByRole('dialog',{name:'새 위키 버전'}),managers=editor.locator('details').filter({hasText:'공동 관리자'});
    assert.notEqual(await managers.getAttribute('open'),null);assert(await managers.getByText('maintainer',{exact:true}).isVisible());
   }
   if(view==='wiki-editor'){
    const details=dialog.locator('details').filter({hasText:'공동 관리자'});assert.equal(await details.getAttribute('open'),null);await details.locator('summary').click();assert(await details.locator('input').isVisible());
    assert(await dialog.getByText('GitHub 원본 접근 권한은 바뀌지 않습니다.',{exact:false}).isVisible());
   }
   if(view.startsWith('reset')){
    for(const label of ['삭제','유지'])assert(await dialog.locator('.nubi-reset-scope dt').filter({hasText:label}).isVisible());
    assert(await dialog.getByText(/직접 수정한 위키도 삭제/).isVisible());
   }
  }
  results.push({view,width,height,scale,...measure});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,`${stage}.json`),JSON.stringify({results,errors},null,2));console.log(`PASS: ${results.length} ${stage} readability cases`);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
