const {app,BrowserWindow}=require('electron');
const {fork}=require('node:child_process');
const {createServer}=require('node:http');
const {writeFile,mkdir}=require('node:fs/promises');
const {captureImage}=require('../electron-app/capture-image.cjs');
const path=require('node:path');
const {BrowserHost}=require('../electron-app/browser-host.cjs');
const {PlaywrightHost}=require('../electron-app/playwright-host.cjs');
(async()=>{
 await app.whenReady();console.log('app-ready');setTimeout(()=>{console.error('test_timeout');app.exit(1);},45000).unref();
 let sessionReused=false;const fixture=createServer((_req,res)=>{if(_req.url==='/next'&&_req.headers.cookie?.includes('nubi_fixture=ready'))sessionReused=true;res.setHeader('set-cookie','nubi_fixture=ready; SameSite=Lax; Path=/');res.setHeader('content-type','text/html;charset=utf-8');res.end('<h1>누비 인앱 검사</h1><label>검색<input aria-label="검색"></label><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">찾기</button><output></output>');});await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 const window=new BrowserWindow({width:1000,height:700,show:true,webPreferences:{sandbox:true}});await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<body style="background:rgb(49,130,246);color:white"><h1>누비 화면 캡처 검사</h1></body>'));
 await mkdir(path.join(__dirname,'../verification/capture-tools-2026-10-15'),{recursive:true});
 const captureStart=performance.now();const [vw,vh]=window.getContentSize();
 const windowCapture=captureImage(await window.webContents.capturePage(),{clip:{x:0,y:0,width:400,height:200},maxWidth:200},{width:vw,height:vh});
 if(windowCapture.width!==200||windowCapture.height!==100)throw Error('window_capture_size_failed');
 const windowPixels=require('electron').nativeImage.createFromBuffer(Buffer.from(windowCapture.image,'base64'));
 const center=windowPixels.getBitmap();if(!center.some(value=>value!==0))throw Error('window_capture_blank');
 await writeFile(path.join(__dirname,'../verification/capture-tools-2026-10-15/window-crop.png'),windowPixels.toPNG());
 const windowCaptureMs=Math.round(performance.now()-captureStart);
 const host=new BrowserHost(window),bridge=new PlaywrightHost(host);host.bounds={x:50,y:70,width:900,height:600};host.visible=true;
 const worker=fork(path.join(__dirname,'../tests/playwright-worker.mjs'),[],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','inherit','inherit','ipc']});
 const pending=new Map();let nextId=0;
 const ready=new Promise(resolve=>worker.on('message',async message=>{if(message.ready)resolve();if(message.playwrightRequest){const {id,action,args}=message.playwrightRequest;try{worker.send({playwrightReply:{id,result:await bridge.request(action,args)}});}catch(error){worker.send({playwrightReply:{id,error:error.message}});}}const waiter=pending.get(message.testId);if(waiter){pending.delete(message.testId);message.error?waiter.reject(Error(message.error)):waiter.resolve(message.result);}}));
 const rpc=(call,close=false)=>new Promise((resolve,reject)=>{const testId=String(++nextId);pending.set(testId,{resolve,reject});worker.send({testId,call,close});});
 const timings={windowCapture:windowCaptureMs},timed=async(name,fn)=>{const start=performance.now();console.log(name+' start');const result=await fn();console.log(name+' done');timings[name]=Math.round(performance.now()-start);return result;};
 let mcp;
 try{
  mcp=await timed('connect',async()=>{await ready;return {callTool:call=>rpc(call),listTools:()=>rpc({name:'__list'}),close:async()=>{await rpc(null,true);worker.disconnect();}};});
  const listed=await mcp.listTools();
  const opened=await timed('open',()=>mcp.callTool({name:'browser_open',arguments:{url:`127.0.0.1:${fixture.address().port}`}}));
  const initial=JSON.parse(opened.content[0].text);if(!initial.snapshot?.includes('textbox'))throw Error('open_snapshot_missing');
  const {tabId}=initial;let documentId;
  // An actual Chromium right click must route to the native menu; do not touch the user's clipboard.
  const {Menu}=require('electron'),originalMenu=Menu.buildFromTemplate;let contextItems;
  Menu.buildFromTemplate=items=>{contextItems=items;return {popup(){}};};
  try{
   const wc=host.tab(tabId).view.webContents;
   const point=await wc.executeJavaScript('(()=>{const r=document.querySelector("input").getBoundingClientRect();return {x:Math.round(r.x+5),y:Math.round(r.y+5)};})()');
   const got=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('context_menu_missing')),3000);wc.once('context-menu',()=>{clearTimeout(timer);resolve();});});
   wc.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});wc.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point});await got;
   if(!contextItems?.some(item=>item.label==='붙여넣기')||!contextItems.some(item=>item.label==='복사'))throw Error('context_edit_actions_missing');
  }finally{Menu.buildFromTemplate=originalMenu;}
  const call=(name,args={})=>mcp.callTool({name,arguments:{tabId,documentId,...args}});
  const snapshot=await timed('snapshotCold',()=>call('browser_snapshot'));console.log(JSON.stringify(snapshot));
  documentId=JSON.parse(snapshot.content[0].text).documentId;
  const text=snapshot.content.map(c=>c.text||'').join('\n');const input=/textbox "검색"[^\n]*?\[ref=([^\]]+)/.exec(text)?.[1],button=/button "찾기" \[ref=([^\]]+)/.exec(text)?.[1];
  if(!input||!button)throw Error('snapshot_refs_missing');
  const captured=await timed('captureRegion',()=>call('browser_capture',{clip:{x:0,y:0,width:450,height:240},maxWidth:256}));
  if(captured.structuredContent.width!==256||!captured.content.some(part=>part.type==='image'))throw Error('capture_region_failed');
  const {nativeImage}=require('electron');const pixels=nativeImage.createFromBuffer(Buffer.from(captured.content.find(part=>part.type==='image').data,'base64'));if(pixels.getSize().width!==256)throw Error('capture_size_failed');
  await writeFile(path.join(__dirname,'../verification/capture-tools-2026-10-15/crop.png'),pixels.toPNG());
  const typed=await timed('type',()=>call('browser_type',{element:'검색',target:input,text:'인앱 연결 확인'}));if(typed.isError)throw Error(JSON.stringify(typed));
  const clicked=await timed('click',()=>call('browser_click',{element:'찾기',target:button}));if(clicked.isError)throw Error(JSON.stringify(clicked));
  // The action reply carries the new page state inline (2026-10-15), so the model needs no second snapshot turn.
  if(!clicked.content.some(c=>c.text?.includes('Snapshot after the action')&&c.text.includes('인앱 연결 확인')))throw Error('inline_snapshot_missing');
  if(clicked.content.some(c=>c.text?.includes('Ran Playwright code')))throw Error('codegen_present');
  const warm=await timed('snapshotWarm',()=>call('browser_snapshot'));
  if(!warm.content.some(c=>c.text?.includes('인앱 연결 확인')))throw Error('readback_missing');
  await writeFile(path.join(__dirname,'../verification/playwright-mcp-2026-10-15/in-app.png'),(await host.tab(tabId).view.webContents.capturePage()).toPNG());
  const auth=host.create('about:blank',{authentication:true});let protectedAuth=false;try{await call('browser_snapshot',{tabId:auth.id});}catch(error){protectedAuth=error.message==='browser_auth_protected';}
  if(!protectedAuth)throw Error('auth_scope_failed');
  const second=await bridge.request('open',{url:`http://127.0.0.1:${fixture.address().port}`});await host.tab(second.tabId).view.webContents.executeJavaScript('document.title="Second tab"');
  await call('browser_type',{target:input,text:'첫 탭 유지'});
  if(await host.tab(second.tabId).view.webContents.executeJavaScript('document.querySelector("input").value')!=='')throw Error('tab_scope_failed');
  const navigation=await timed('navigate',()=>call('browser_navigate',{url:`http://127.0.0.1:${fixture.address().port}/next`}));if(navigation.isError)throw Error(JSON.stringify(navigation));
  documentId=JSON.parse(navigation.content[0].text).documentId;
  await host.tab(tabId).view.webContents.reload();
  let staleBlocked=false;try{await call('browser_type',{target:input,text:'stale'});}catch(error){staleBlocked=error.message==='browser_document_changed';}
  if(!staleBlocked)throw Error('stale_document_not_blocked');
  if(!sessionReused)throw Error('session_not_reused');
  await rpc({name:'__reconnect'});const reconnected=await call('browser_snapshot');if(reconnected.isError)throw Error('reconnect_failed');
  // Drop the live capability socket, then stall one Electron attach. Recovery must
  // happen before any action is dispatched and must retain the same page/session.
  const liveConnection=await bridge.connections.get(tabId);liveConnection.close();
  await new Promise(resolve=>setTimeout(resolve,50));
  const debug=host.tab(tabId).view.webContents.debugger,sendCommand=debug.sendCommand.bind(debug);let stalledAttaches=0;
  debug.sendCommand=(method,...args)=>method==='Target.getTargetInfo'&&stalledAttaches++===0?new Promise(()=>{}):sendCommand(method,...args);
  try{
   const recovered=await timed('cdpRecovery',()=>call('browser_snapshot'));
   if(recovered.isError||!recovered.content.some(part=>part.text?.includes('textbox')))throw Error('cdp_stall_recovery_failed');
   const reused=await call('browser_snapshot');
   if(reused.isError)throw Error('recovered_client_not_reused');
   if(stalledAttaches!==2)throw Error('cdp_retry_not_bounded');
   const recoveredText=reused.content.map(part=>part.text||'').join('\n');
   const recoveredButton=/button "찾기" \[ref=([^\]]+)/.exec(recoveredText)?.[1];
   const wc=host.tab(tabId).view.webContents;
   await wc.executeJavaScript('window.clickCount=0;document.querySelector("button").addEventListener("click",()=>window.clickCount++)');
   const current=JSON.parse(reused.content[0].text);
   const once=await call('browser_click',{documentId:current.documentId,target:recoveredButton});
   if(once.isError||await wc.executeJavaScript('window.clickCount')!==1)throw Error('recovery_action_replayed');
  }finally{debug.sendCommand=sendCommand;}
  // A not-yet-running local server keeps an in-app error tab and can recover in place.
  const pendingServer=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Server ready</h1>');});
  await new Promise(resolve=>pendingServer.listen(0,'127.0.0.1',resolve));const delayedPort=pendingServer.address().port;await new Promise(resolve=>pendingServer.close(resolve));
  let refused=false;try{await bridge.request('open',{url:`localhost:${delayedPort}`});}catch(error){refused=error.message==='browser_connection_refused';}
  if(!refused)throw Error('local_server_failure_not_reported');
  const failedTab=host.active;await new Promise(resolve=>pendingServer.listen(delayedPort,'127.0.0.1',resolve));
  try{const wc=host.tab(failedTab).view.webContents;await host.request({action:'reload',id:failedTab});let recovered=false;for(let i=0;i<50;i++){if(!host.tab(failedTab).error&&await wc.executeJavaScript('document.body?.textContent').catch(()=>null)==='Server ready'){recovered=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}if(!recovered){console.log('recovery',JSON.stringify({error:host.tab(failedTab).error,url:wc.getURL(),body:await wc.executeJavaScript('document.body?.textContent')}));throw Error('local_server_retry_failed');}}finally{pendingServer.closeAllConnections();await new Promise(resolve=>pendingServer.close(resolve));}
  if(BrowserWindow.getAllWindows().length!==1)throw Error('extra_browser_window');
  const result={passed:true,windowCapture:{width:windowCapture.width,height:windowCapture.height},workerIpc:true,contextMenu:true,initialSnapshot:true,localServerRecovery:true,cdpStallRecovery:true,sessionReused,reconnected:true,staleBlocked,tools:listed.tools.map(t=>t.name),timings,protectedAuth};console.log(JSON.stringify(result));await writeFile(path.join(__dirname,'../verification/playwright-mcp-2026-10-15/result.json'),JSON.stringify(result,null,2));
 }finally{await mcp?.close();bridge.dispose();host.dispose();window.destroy();fixture.close();app.quit();}
})().catch(error=>{console.error(error);app.exit(1);});
