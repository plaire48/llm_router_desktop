import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,mkdtemp,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root=process.cwd(),directory=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-resume-ui-'));
const output=path.join(root,'verification/wiki-update-resume-2026-10-15');await mkdir(output,{recursive:true});
const styles=['electron-app/workbench.css','design/workspace-identity.css','electron-app/shell.css','electron-app/ios-tokens.css','design/workspace-typography.css','design/workspace-density.css','design/workspace-dialogs.css'];
await writeFile(path.join(directory,'fixture.jsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{DetailPanel}from'@e2e/cx-design-system';import{DeckDisclosure}from'${root}/../../extensions/aipro-chat/src/DeckSurfaces.jsx';import{WikiUpdate}from'${root}/ui/WikiUpdate.jsx';
import '@e2e/cx-design-system/styles.css';${styles.map(file=>`import '${root}/${file}';`).join('')}
window.calls=[];window.failResume=false;
const update={id:'fixture-update',state:'failed',canResume:true,error:'timeout',fingerprint:'fixture-fingerprint',pageProgress:{completed:5,total:11},events:[]};
const api=async(method,args)=>{window.calls.push({method,...args});if(args.method==='resume'){if(window.failResume)throw Error('wiki_update_sources_changed');update.state='running';update.startedAt=new Date().toISOString();update.events=[{type:'progress',stage:'generating',index:6,total:11,completed:5}];}if(args.method==='cancel')update.state='cancelled';if(args.method==='discard')update.state='discarded';return {status:{state:'stale',lastUpdate:{},changedFiles:['app.txt']},updates:[{...update}]};};
createRoot(document.getElementById('root')).render(<main className="desktop-shell"><DetailPanel className="deck-dialog nubi-panel" title="프로젝트 위키" variant="modal" onClose={()=>{}}><div className="nubi-library"><WikiUpdate api={api}/><DeckDisclosure title="위키 문서" icon="bookmark"><p className="nubi-muted">기존 문서는 그대로 유지됩니다.</p></DeckDisclosure></div></DetailPanel></main>);
`);
await build({entryPoints:[path.join(directory,'fixture.jsx')],outfile:path.join(directory,'fixture.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[root+'/node_modules'],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,root+'/node_modules/'+name])),'@e2e/cx-design-system/styles.css':root+'/node_modules/@e2e/cx-design-system/dist/styles.css'},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp(path.resolve(root,'../../extensions/aipro-chat/public/icons'),path.join(directory,'icons'),{recursive:true});
await writeFile(path.join(directory,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(directory,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(directory+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,page;const errors=[],checks=[];
try{
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});
  page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [1280,440]){
    await page.setViewportSize({width,height:850});await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    const card=page.getByRole('region',{name:'위키 갱신',exact:true});await card.waitFor();
    await page.getByRole('button',{name:'이어서 갱신',exact:true}).waitFor();assert.match(await card.innerText(),/5\/11개 문서 완료/);
    assert.equal(await card.locator('details').getAttribute('open'),null,'error details are initially collapsed');
    await card.locator('summary').click();await page.getByText('모델 응답이 지연됐어요. 연결을 확인한 뒤 이어서 갱신해 주세요.',{exact:true}).waitFor();await card.locator('summary').click();
    assert.equal(await page.evaluate(()=>window.calls.some(call=>call.method==='resume')),false,'viewing never resumes');
    if(width===440)await page.evaluate(()=>document.documentElement.style.fontSize='20px');
    assert.equal(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'no horizontal clipping');
    const buttons=await card.getByRole('button').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,right:el.getBoundingClientRect().right,top:el.getBoundingClientRect().top})));
    assert(buttons.every(button=>button.x>=0&&button.right<=width),'all actions remain visible');
    assert(buttons.every(button=>Math.abs(button.top-buttons[0].top)<2),'actions share one row');
    await page.screenshot({path:path.join(output,'retained-'+width+'.png'),animations:'disabled'});
    await page.evaluate(()=>window.failResume=true);await page.getByRole('button',{name:'이어서 갱신',exact:true}).click();
    await page.getByText('원본이 바뀌었어요. 새 기준으로 갱신해 주세요. 보관한 작업은 유지됩니다.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.some(call=>call.method==='discard')),false);
    await page.evaluate(()=>window.failResume=false);await page.getByRole('button',{name:'이어서 갱신',exact:true}).click();
    await page.getByRole('heading',{name:'위키 갱신 중',exact:true}).waitFor();
    assert.equal(await page.getByRole('progressbar',{name:'갱신 진행'}).getAttribute('aria-valuenow'),'5');
    assert.deepEqual(await page.evaluate(()=>window.calls.filter(call=>call.method==='resume').at(-1)),{method:'resume',id:'fixture-update',fingerprint:'fixture-fingerprint'});
    await page.getByRole('button',{name:'위키 갱신 중지'}).click();await page.getByRole('button',{name:'이어서 갱신',exact:true}).waitFor();
    await page.getByRole('button',{name:'버리기',exact:true}).click();await page.getByText('갱신 결과를 버렸어요. 작업 공간은 그대로예요.',{exact:true}).waitFor();
    checks.push({width,enlargedText:width===440,resume:true,conflict:true,cancel:true,discard:true,noClipping:true});
  }
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'checks.json'),JSON.stringify({scope:'Actual React/CX components and fixture API, not live Windows/AI Pro.',checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
