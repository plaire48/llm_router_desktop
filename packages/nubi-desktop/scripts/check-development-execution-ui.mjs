// Component interaction evidence. Runtime PTY/approval is tested separately.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const directory=path.resolve('verification/development-execution-2026-10-16/ui');
await mkdir(directory,{recursive:true});
await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SetupActions} from './ui/SetupActions.jsx';
import '@e2e/cx-design-system/styles.css';import './electron-app/workbench.css';
import './design/workspace-identity.css';import './design/workspace-typography.css';import './design/workspace-density.css';
window.decisions=[];window.always=0;window.stops=0;
const proposal={id:'input',taskId:'task',kind:'input',state:'proposed',profile:'bash',workspace:'/project',title:'프로젝트 이름 입력',reason:'현재 프로젝트 이름 질문에 답합니다.',effects:'이름을 한 번 전달합니다.',script:'Nubi\\n',inputTarget:{cwd:'/project',command:'npx project-generator'}};
function App(){const [action,setAction]=useState(proposal);return <div className="desktop-shell"><main className="nubi-workbench" style={{padding:16}}><SetupActions actions={[action]} profiles={[{id:'bash',label:'Bash'}]} processes={[{id:'process',state:'running',profile:'bash',cwd:'/project',script:'npx project-generator',output:'Configured Nubi',exitCode:null}]} onAlways={()=>window.always++} onStop={()=>window.stops++} onDecision={(value,decision)=>{window.decisions.push({id:value.id,decision});setAction({...value,state:decision==='approve'?'started':'rejected',resultProcessId:decision==='approve'?'process':undefined});}}/></main></div>;}
createRoot(document.getElementById('root')).render(<App/>);`},outfile:path.join(directory,'app.js'),bundle:true,format:'esm',platform:'browser',
  nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile(path.join(directory,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><title>Development input approval fixture</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(request,response)=>{
  try{const file=path.resolve(directory,'.'+new URL(request.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(directory+path.sep))throw Error();response.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'text/html; charset=utf-8');response.end(await readFile(file));}
  catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const errors=[],checks=[];let browser;
try{
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [1280,440])for(const zoom of [1,1.25]){
    await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(zoom=>{document.documentElement.style.fontSize=zoom*100+'%';},zoom);
    await page.getByRole('button',{name:'입력 승인',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.getByRole('button',{name:/항상 허용/}).count(),0);
    assert.match(await page.locator('.nubi-setup-summary').innerText(),/npx project-generator/);
    assert.match(await page.locator('.nubi-setup-summary').innerText(),/"Nubi\\n"/);
    assert.equal(await page.getByRole('figure',{name:'보낼 입력',exact:true}).locator('.nubi-terminal-prompt').innerText(),'›');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(directory,`input-${width}-${zoom}.png`),fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'입력 승인',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.decisions),[{id:'input',decision:'approve'}]);
    assert.equal(await page.getByRole('button',{name:'입력 승인',exact:true}).count(),0);
    const record=page.locator('.nubi-command-record');await record.locator('summary').click();
    await record.getByText('Configured Nubi',{exact:true}).waitFor();
    assert.match(await record.innerText(),/"Nubi\\n"/);assert.match(await record.innerText(),/Configured Nubi/);
    await page.getByRole('button',{name:'명령 중지',exact:true}).click();assert.equal(await page.evaluate(()=>window.stops),1);
    checks.push({width,zoom,approvedOnce:true,inputEscapesVisible:true,recordPreserved:true,overflow:false});
  }
  assert.deepEqual(errors,[]);await writeFile(path.join(directory,'result.json'),JSON.stringify({kind:'component-browser-fixture',checks,errors},null,2));
  console.log(`PASS: ${checks.length} input approval/record layouts`);
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
