import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {mailPreviewMatrix} from '../tests/helpers-mail-preview-matrix.mjs';

const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-detail-')),output=path.resolve('verification/auxiliary-detail-2026-10-23');
await mkdir(output,{recursive:true});
const attachmentMode=process.argv.includes('--attachments'),matrix=attachmentMode?await mailPreviewMatrix(directory):null;
await build({...rendererBundleOptions(),entryPoints:['tests/auxiliary-detail-fixture.jsx'],outdir:directory,splitting:false,entryNames:'app'});
await cp('../../extensions/aipro-chat/public/icons',directory+'/icons',{recursive:true});
if(matrix){await mkdir(directory+'/chunks',{recursive:true});await cp('../../extensions/aipro-chat/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',directory+'/chunks/pdf.worker.mjs');}
await writeFile(directory+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
const server=createServer(async(req,res)=>{try{if(matrix&&req.url==='/attachment-api'&&req.method==='POST'){let body='';for await(const bytes of req)body+=bytes;try{const {method,args}=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await matrix.request(method,args)));}catch(error){res.end(JSON.stringify({error:error.message}));}return;}const file=path.resolve(directory,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(directory+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.css')?'text/css':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto('http://127.0.0.1:'+server.address().port+(attachmentMode?'/?attachments=1':''));
 const results=page.locator('.nubi-mail-results'),detail=page.locator('.desktop-selection-detail');
 await page.getByRole('button',{name:'검증 메일 0',exact:true}).click();
 await detail.getByRole('heading',{name:'검증 메일 0',exact:true}).waitFor();
 assert.equal(await page.locator('.nubi-mail-history .nubi-mail-history-detail').count(),0);
 assert.equal(await page.locator('aside .nubi-mail-history-detail').count(),1);
 if(matrix){
  for(const [name,,bytes,evidence] of matrix.samples){
   await detail.locator('button.nubi-mail-attachment').filter({hasText:name}).click();
   const preview=page.getByRole('region',{name:'첨부 미리보기',exact:true});await preview.getByRole('heading',{name,exact:true}).waitFor();
   if(name.endsWith('.png')){await preview.getByRole('img',{name,exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="첨부 미리보기"] img')?.naturalWidth>0);}
   else if(name.endsWith('.pdf')){await preview.getByRole('button',{name:'추출 텍스트 보기',exact:true}).click();await preview.locator('pre.nubi-document-source').waitFor();assert((await preview.locator('pre.nubi-document-source').innerText()).includes(evidence));}
   else if(evidence){if(await preview.locator('iframe').count())await preview.frameLocator('iframe').getByText(evidence,{exact:false}).waitFor();else assert((await preview.innerText()).includes(evidence),name+' evidence is visible');}
   const last=matrix.requests.at(-1);assert(last.expectedSourceHash&&last.expectedAttachmentHash&&last.attachmentId);
   if(name==='memo.txt')await page.screenshot({path:output+'/txt-attachment-right.png',animations:'disabled'});
   await preview.getByRole('button',{name:'메일 본문으로',exact:true}).click();await detail.getByRole('heading',{name:'검증 메일 0',exact:true}).waitFor();
   checks.push(name+' 첨부 클릭 → 원본 해시 확인 및 공통 worker/API 읽기 → 오른쪽 미리보기');
  }
 }
 await results.evaluate(node=>node.scrollTop=350);const scroll=await results.evaluate(node=>node.scrollTop);
 await detail.getByRole('button',{name:'다음 메일',exact:true}).click();
 await detail.getByRole('heading',{name:'검증 메일 1',exact:true}).waitFor();
 assert.equal(await results.evaluate(node=>node.scrollTop),scroll);
 const listBox=await results.boundingBox(),detailBox=await detail.boundingBox();assert(listBox&&detailBox&&listBox.x+listBox.width<=detailBox.x+2,'mail list stays in the center and its detail occupies the right pane');
 await page.screenshot({path:output+'/mail-wide.png',animations:'disabled'});
 checks.push('메일 상세가 오른쪽에 열리고 다음 메일 이동에도 목록 위치가 유지됨');
 await page.getByRole('button',{name:'파일 초안 보기'}).click();
 await page.getByRole('textbox',{name:'파일 초안',exact:true}).fill('사용자 수정 초안');
 await page.getByRole('button',{name:'상세로 돌아가기'}).click();
 await detail.getByRole('heading',{name:'검증 메일 1',exact:true}).waitFor();
 await page.getByRole('button',{name:'파일 초안 보기'}).click();
 assert.equal(await page.getByRole('textbox',{name:'파일 초안',exact:true}).inputValue(),'사용자 수정 초안');
 await page.getByRole('button',{name:'상세로 돌아가기'}).click();
 await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
 await page.getByRole('complementary').waitFor({state:'hidden'});
 assert.equal(await results.evaluate(node=>node.scrollTop),scroll);
 checks.push('상세 전환과 닫기에도 파일 초안과 목록 위치가 유지됨');
 // Closing an issued read must invalidate its late result rather than reopen.
 await page.getByRole('button',{name:'검증 메일 1',exact:true}).click();
 await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
 await page.waitForTimeout(350);
 assert.equal(await page.getByRole('complementary').isVisible(),false);
 checks.push('닫은 메일의 늦은 응답이 상세를 다시 열지 않음');
 await page.getByRole('button',{name:'wiki',exact:true}).click();
 await detail.getByRole('heading',{name:'검증 위키 0',exact:true}).waitFor();
 assert.equal(await page.locator('.nubi-wiki-browser .nubi-wiki-document').count(),0);
 await detail.getByRole('button',{name:'위키 수정',exact:true}).click();
 await detail.getByRole('textbox',{name:'위키 본문',exact:true}).fill('보관해야 할 위키 초안');
 await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
 await page.getByRole('button',{name:/^검증 위키 0/}).click();
 assert.equal(await detail.getByRole('textbox',{name:'위키 본문',exact:true}).inputValue(),'보관해야 할 위키 초안');
 checks.push('위키 상세가 오른쪽에 열리고 닫기와 재열기에도 미저장 초안이 유지됨');
 await page.screenshot({path:output+'/wiki-wide.png',animations:'disabled'});
 const spinner=page.getByLabel('로딩 아이콘');
 let motion=await spinner.evaluate(node=>{const s=getComputedStyle(node);return {name:s.animationName,duration:s.animationDuration,mask:s.maskImage,border:s.borderWidth};});
 assert.equal(motion.name,'nubi-hourglass-flip');assert.equal(motion.duration,'4s');assert.match(motion.mask,/svg/);assert.equal(motion.border,'0px');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await spinner.evaluate(node=>getComputedStyle(node).animationPlayState),'paused');
 await page.emulateMedia({reducedMotion:'no-preference'});
 checks.push('로딩은 모래시계로 통일되고 모션 감소 설정에서는 정지함');
 await page.setViewportSize({width:600,height:850});
 await page.screenshot({path:output+'/wiki-narrow.png',animations:'disabled'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.getByRole('button',{name:'browser',exact:true}).click();
 await page.getByRole('button',{name:'외부 연동 상태 다시 확인',exact:true}).waitFor();
 await page.evaluate(()=>window.failBrowserStatus=false);
 await page.getByRole('button',{name:'외부 연동 상태 다시 확인',exact:true}).click();
 await page.getByRole('heading',{name:'외부 브라우저와 함께 작업하세요'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'브라우저 가져오기',exact:true}).count(),0);
 assert.equal(await page.getByText('다른 브라우저 지정',{exact:true}).count(),0);
 await page.screenshot({path:output+'/external-recovered.png'});
 checks.push('브라우저 초기 연결 조회 실패를 재시도할 수 있고 Mac에 Windows 전용 동작이 표시되지 않음');
 assert.deepEqual(errors,[]);
 await writeFile(output+'/checks.json',JSON.stringify({scope:'Actual React components and shared shell detail host with synthetic local API fixtures; not Windows or company SSO acceptance',checks,errors},null,2));
 console.log(checks.join('\n'));
}catch(error){await page.screenshot({path:output+'/failure.png'}).catch(()=>{});await writeFile(output+'/failure.txt',JSON.stringify({checks,errors,message:error.message,body:await page.locator('body').innerText()},null,2));throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await matrix?.dispose();await rm(directory,{recursive:true,force:true});}
