import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/wave2-approval');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nubi Wave 2</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));


let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,440])for(const scene of ['mcp','commands']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&irreversible='+scene);
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  if(scene==='mcp'){
   await page.getByText('외부 반영 도구라 항상 허용을 적용하지 않아요',{exact:true}).waitFor({timeout:5000});
   assert.equal(await page.getByRole('radio',{name:/항상 허용/}).count(),0);
   await page.getByRole('radio',{name:/취소/}).waitFor();
   assert.match(await page.getByLabel('도구 실행 인자',{exact:true}).innerText(),/fixture@example.invalid/);
  }else{
   await page.getByText('되돌리기 어려운 작업(강제 push)이라 자동 모드에서도 확인해요.',{exact:true}).waitFor({timeout:5000});
   await page.getByText('되돌리기 어려운 작업(기존 파일 삭제)이라 자동 모드에서도 확인해요.',{exact:true}).waitFor();
  }
  const notices=page.locator('[data-irreversible-notice]');assert(await notices.count()>0);
  for(const notice of await notices.all()){await notice.scrollIntoViewIfNeeded();assert(await notice.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'notice must wrap without clipping');}
  await page.screenshot({path:path.join(dir,scene+'-'+width+'.png'),animations:'disabled'});
  if(scene==='commands'){
   await page.getByRole('button',{name:/승인 방식: 매번 확인/}).click();
   await page.getByRole('menuitemradio',{name:/파일과 명령 자동/}).click();
   await page.getByText('되돌리기 어려운 명령은 자동 모드에서도 확인해요.',{exact:true}).waitFor({timeout:5000});
   await page.screenshot({path:path.join(dir,'mode-'+width+'.png'),animations:'disabled'});
  }
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: irreversible approval screens');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
