const {mirrorMenu}=require('./browser-mirror-menu.cjs');

// Main owns this port. Call request only from its trusted Electron renderer
// route. It is deliberately absent from worker/model/browser-page RPC.
function createExternalBrowserContentPort({browser,router,window,Menu,clipboard}){
 const mirror=browser.mirror,sensitive=new Set();let protectedEpoch=0;
 const emit=value=>{if(!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('nubi:browser-mirror',value);};
 const previous=mirror.onEvent;
 const event=value=>{
  if(value.type==='frame'&&browser.tabs.get(value.tabId)?.authentication){sensitive.add(value.streamId);protectedEpoch++;}
  emit(value);
 };
 mirror.onEvent=event;
 const pause=()=>void mirror.stop();for(const name of ['hide','minimize'])window.on(name,pause);
 const report=(args,error)=>emit({type:'error',streamId:args.streamId,error:/^[a-z_]+$/.test(error.message)?error.message:'browser_mirror_changed'});
 let connecting=false,connectionAbort=null;
 const quickConnect=async({resolveProof,url,signal,replace=false,open}={})=>{
  if(connecting)throw Error('external_browser_busy');
  if(browser.status().connected&&!replace)return {connected:true};
  connecting=true;let owner;const controller=new AbortController();connectionAbort=controller;
  const aborted=()=>signal?.aborted||controller.signal.aborted;
  try{
   if(aborted())throw Error('dock_cancelled');
   if(replace)await browser.stop();
   const paired=await browser.pair({resolveProof,...(url?{url}: {})});owner=browser.quick;
   if(aborted())throw Error('dock_cancelled');
   const cancel=()=>{if(browser.quick===owner)void browser.stop();};signal?.addEventListener('abort',cancel,{once:true});controller.signal.addEventListener('abort',cancel,{once:true});
   try{
    await (open||((url)=>router.launch.open(url)))(paired.connectUrl);
    const until=Date.now()+25000;
    while(!browser.status().connected){if(aborted())throw Error('dock_cancelled');if(browser.quick!==owner)throw Error('external_browser_connection_changed');if(router.mode!=='external')throw Error('external_browser_disabled');if(Date.now()>until)throw Error('external_browser_extension_required');await new Promise(resolve=>setTimeout(resolve,100));}
    if(aborted())throw Error('dock_cancelled');
    if(browser.quick!==owner)throw Error('external_browser_connection_changed');
    router.externalFocus=true;router.notify?.({type:'external_browser_opened',state:router.configuration()});window.show?.();window.focus?.();
    return {connected:true};
   }finally{signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',cancel);}
  }catch(error){if(owner&&browser.quick===owner&&!browser.status().connected)await browser.stop();throw error;}
  finally{connecting=false;if(connectionAbort===controller)connectionAbort=null;}
 };
 browser.quickConnect=quickConnect;
 async function request(args={}){
  if(args.action==='stop'){
   // The viewer clears its canvas before sending stop. Internal invalidation
   // alone does not allow a screenshot of a stale authentication frame.
   sensitive.delete(args.streamId);return mirror.stop(args);
  }
  if(router.mode!=='external')throw Error('external_browser_disabled');
  if(args.action==='connect')return quickConnect();
  if(args.action==='start')return mirror.start(args);
  if(args.action==='ack')return mirror.ack(args);
  if(args.action==='input')return mirror.input(args);
  if(args.action==='paste')return mirror.input({...args,input:{kind:'text',text:clipboard.readText().slice(0,100000)}});
  if(args.action==='copy'||args.action==='cut'){const result=await mirror.input({...args,input:{kind:'command',command:args.action}});clipboard.writeText(result.text||'');return {copied:true};}
  if(args.action==='contextMenu')return mirrorMenu({mirror,args,Menu,clipboard,parent:window,onSettings:()=>emit({type:'settings'}),onError:error=>report(args,error),openPage:url=>browser.openPage(url)});
  throw Error('browser_action_invalid');
 }
 const assertCaptureAllowed=()=>{if(sensitive.size)throw Error('browser_auth_protected');};
 return {request,async capture(work){assertCaptureAllowed();const epoch=protectedEpoch,value=await work();assertCaptureAllowed();if(epoch!==protectedEpoch)throw Error('browser_auth_protected');return value;},dispose(){connectionAbort?.abort();if(browser.quickConnect===quickConnect)delete browser.quickConnect;for(const name of ['hide','minimize'])window.removeListener(name,pause);if(mirror.onEvent===event)mirror.onEvent=previous;void mirror.stop();}};
}
module.exports={createExternalBrowserContentPort};
