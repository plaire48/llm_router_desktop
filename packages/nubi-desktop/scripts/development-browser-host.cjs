const {app,BrowserWindow}=require('electron');
const {fork}=require('node:child_process');
const {writeFile,mkdir}=require('node:fs/promises');
const path=require('node:path');
const {BrowserHost}=require('../electron-app/browser-host.cjs');
const {PlaywrightHost}=require('../electron-app/playwright-host.cjs');
(async()=>{
 await app.whenReady();const timeout=setTimeout(()=>{console.error('development_browser_timeout');app.exit(1);},60000);
 const window=new BrowserWindow({width:1100,height:760,show:true,webPreferences:{sandbox:true}});await window.loadURL('data:text/html,<h1>Nubi development browser verification</h1>');
 const host=new BrowserHost(window),bridge=new PlaywrightHost(host);host.bounds={x:0,y:50,width:1100,height:710};host.visible=true;
 const evidence=path.resolve(process.env.NUBI_HYBRID_CHECK==='1'?'verification/hybrid-browser-2026-10-16/electron':'verification/development-browser-2026-10-16/electron');await mkdir(evidence,{recursive:true});
 const worker=fork(path.resolve('tests/development-browser-worker.mjs'),[process.argv[2]],{execPath:process.argv[2],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined},stdio:['ignore','inherit','inherit','ipc']});
 let result;
 worker.on('message',async message=>{
  try{
   if(message.playwrightRequest){const {id,action,args}=message.playwrightRequest;try{worker.send({playwrightReply:{id,result:await bridge.request(action,args)}});}catch(error){worker.send({playwrightReply:{id,error:error.message}});}return;}
   if(message.developmentError)throw Error(JSON.stringify(message.developmentError));
   if(message.developmentResult){
    result=message.developmentResult;
    if(host.tabs.size!==1)throw Error('duplicate_preview_tab');
    const wc=host.tab(result.receipt.tabId).view.webContents;
    const actual=await wc.executeJavaScript('({input:document.querySelector("input").value,output:document.querySelector("output").textContent})');
    if(actual.input!=='누비 개발 검증'||actual.output!=='결과: 누비 개발 검증')throw Error('independent_dom_readback_failed');
    await writeFile(path.join(evidence,'preview.png'),(await wc.capturePage()).toPNG());
    await writeFile(path.join(evidence,'result.json'),JSON.stringify({...result,actual,tabs:host.tabs.size,platform:process.platform,windowsVerified:process.platform==='win32'},null,2));
    worker.send({finish:true});
   }
  }catch(error){console.error(error);worker.kill();app.exit(1);}
 });
 worker.on('exit',code=>{clearTimeout(timeout);bridge.dispose();host.dispose();window.destroy();if(code===0&&result)console.log('PASS: actual Electron BrowserHost, official MCP, BrowserSession and Pi approval continuation');app.exit(code===0&&result?0:1);});
})().catch(error=>{console.error(error);app.exit(1);});
