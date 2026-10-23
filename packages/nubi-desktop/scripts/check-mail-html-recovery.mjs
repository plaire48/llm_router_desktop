import {build,stop as stopBuildService} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/mail-html-recovery-2026-10-16');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/mail-html-recovery-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.svg':'dataurl','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

// Synthetic EML travels through the actual encrypted intake/read path before UI rendering.
const {mkdtemp,rm}=await import('node:fs/promises'),os=await import('node:os');
const {PersonalMail}=await import('../tests/helpers-personal-mail.mjs');
const {normalizePortalMail}=await import('../runtime/mail-portal-content.mjs');
const root=await mkdtemp(path.join(os.tmpdir(),'html-ui-')),mail=new PersonalMail({storageRoot:root},{personalRoot:path.join(root,'mail')});mail.autoWiki=false;
let browser;
try{
 const html='<h2>검토 결과</h2><p>아래 금액을 확인해 주세요.</p><table border="1" cellpadding="12"><tr><th>항목</th><th>금액</th></tr><tr><td>승인 금액</td><td><b>120,000원</b></td></tr></table><script>parent.mailUnsafe=true</script>';
 const part=(name,body)=>`--b\r\nContent-Type: text/html; charset=utf-8\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString('base64')}\r\n`;
 const raw=Buffer.from('Subject: HTML body recovery\r\nFrom: sender@example.test\r\nTo: reader@example.test\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nThis message contains HTML.\r\n'+part('body.html',html)+part('report.html','<p>별도 첨부 문서</p>')+'--b--\r\n');
 await mail.intake({mails:[{...await normalizePortalMail(raw),uidl:'ui-fixture',protocol:'local'}]},mail.generation,{collectOnly:true});
 const source=await mail.read(mail.rows()[0].id,{includePresentation:true});await writeFile(path.join(dir,'source.json'),JSON.stringify(source));
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1000,420]){
  await page.setViewportSize({width,height:850});await page.goto('http://127.0.0.1:'+server.address().port);
  const frame=page.frameLocator('iframe[title="메일 본문"]');await frame.getByRole('cell',{name:'120,000원',exact:true}).waitFor();
  assert.equal(await frame.locator('table').count(),1);assert.equal(await frame.locator('script').count(),0);assert.equal(await page.evaluate(()=>window.mailUnsafe),undefined);
  assert.equal(await page.locator('.nubi-mail-attachment-label').count(),1);assert.equal(await page.locator('.nubi-mail-attachment-label strong').innerText(),'report.html');
  assert.equal(await frame.getByText('별도 첨부 문서',{exact:true}).count(),0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(dir,`recovered-${width}.png`)});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,widths:[1000,420],checks:['actual MIME intake and read','HTML table and Korean text rendered','only real attachment listed','script removed','no horizontal page overflow'],liveCompanyVerified:false},null,2));console.log('HTML body recovery and real MailReader rendering passed.');
}finally{await browser?.close();mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;await rm(root,{recursive:true,force:true});server.closeAllConnections();await new Promise(r=>server.close(r));stopBuildService();}
