import {build,stop as stopBuildService} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/browser-saml-2026-10-16');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/browser-saml-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1100,440,360]){
  await page.setViewportSize({width,height:800});await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('SSO 이동을 완료하지 못했어요').waitFor();await page.getByText(/원래 탭에서 링크를 다시 열어 주세요/).waitFor();
  const notice=page.getByRole('complementary',{name:'SSO 이동 확인'});await notice.locator('summary').click();await page.screenshot({path:path.join(dir,`failure-${width}.png`)});await page.getByRole('button',{name:'SSO 진단 복사',exact:true}).click();assert.equal(await page.evaluate(()=>window.copied),true);
  await page.getByRole('button',{name:'원래 탭으로 돌아가기'}).click();assert.equal(await page.evaluate(()=>window.returned),true);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const bounds=await notice.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width);
  await page.goto('http://127.0.0.1:'+server.address().port+'/?network');
  await page.getByText('페이지를 열지 못했어요',{exact:true}).waitFor();
  await page.getByText('연결 오류 상세',{exact:true}).click();
  await page.getByText('ERR_CERT_AUTHORITY_INVALID (-202)',{exact:true}).waitFor();
  await page.screenshot({path:path.join(dir,`network-${width}.png`)});
  await page.getByRole('button',{name:'연결 진단 복사',exact:true}).click();assert.equal(await page.evaluate(()=>window.copied),true);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));


 }
 assert.deepEqual(errors,[]);console.log('SSO notice: 1100/440/360px, copy/return and overflow checks passed.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stopBuildService();}
