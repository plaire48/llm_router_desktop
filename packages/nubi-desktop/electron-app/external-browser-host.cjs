const {EventEmitter}=require('node:events');
const {randomBytes,randomUUID,timingSafeEqual}=require('node:crypto');
const {WebSocketServer}=require('ws');
const {PlaywrightHost}=require('./playwright-host.cjs');
const {httpBrowserAddress}=require('../runtime/browser-address.cjs');

// A user-paired extension transports the existing tab-scoped Playwright host.
// No remote-debugging port, second agent loop or browser profile import.
class ExternalBrowserHost {
 constructor({onChange=()=>{},timeout=15000}={}){this.onChange=onChange;this.timeout=timeout;this.tabs=new Map();this.pending=new Map();this.active=null;this.generation=null;this.playwright=new PlaywrightHost(this);}
 status(){return {mode:'external',connected:!!this.peer&&this.ready===true,automation:!!this.peer&&this.ready===true,windowEmbedded:false,windowId:this.windowId??null,active:this.active,tabs:[...this.tabs.values()].map(row=>({id:row.id,title:row.title,url:row.url,documentId:row.automationDocument,external:true})),pairing:!!this.ticket&&Date.now()<this.expiresAt};}
 publish(){const state=this.status(),encoded=JSON.stringify(state);if(encoded===this.lastPublished)return;this.lastPublished=encoded;this.onChange(state);}
 async pair(){
  if(this.peer)throw Error('external_browser_already_connected');
  await this.stop();this.ticket=randomBytes(32).toString('hex');this.expiresAt=Date.now()+300000;
  const ticket=this.ticket;
  this.server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:140*1024*1024,verifyClient:({origin,req})=>{
   const supplied=req.url?.slice(1)||'';
   return /^chrome-extension:\/\/[a-p]{32}$/.test(origin||'')&&Date.now()<this.expiresAt&&this.ticket===ticket&&supplied.length===ticket.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(ticket));
  }});
  await new Promise((resolve,reject)=>{this.server.once('listening',resolve);this.server.once('error',reject);});
  this.server.on('error',()=>{});
  this.server.on('connection',socket=>{
   // Consume the ticket at upgrade. A second extension cannot replace a peer.
   if(!this.ticket){socket.close();return;}this.ticket=null;this.peer=socket;this.generation=randomUUID();
   const owner=this.generation,helloTimer=setTimeout(()=>socket.terminate(),5000);let ready=false;
   socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(helloTimer);if(this.generation===owner)this.disconnected();});
   socket.on('message',bytes=>{
    if(this.generation!==owner)return;
    // Large MIME replies are expected only for an issued fixed mail read.
    // Do not parse equally large unsolicited DOM/events in Electron main.
    if(bytes.length>2*1024*1024){
     const responseId=bytes.subarray(0,100).toString().match(/^\{"id":"([a-f0-9-]{36})",/)?.[1],waiting=this.pending.get(responseId);
     const limit=waiting?.action==='portalRead'?140*1024*1024:waiting?.action==='capture'||waiting?.action==='cdp'&&waiting.method==='Page.captureScreenshot'?34*1024*1024:0;
     if(bytes.length>limit){socket.terminate();return;}
    }
    let packet;try{packet=JSON.parse(String(bytes));}catch{socket.terminate();return;}
    if(!ready){
     if(packet.type!=='hello'||packet.version!==1||!Number.isSafeInteger(packet.windowId)||!Array.isArray(packet.tabs)||packet.tabs.length!==1){socket.terminate();return;}
     ready=true;this.ready=true;clearTimeout(helloTimer);this.windowId=packet.windowId;this.browserVersion=String(packet.browserVersion||'').slice(0,200);this.updateTabs(packet.tabs);socket.send(JSON.stringify({type:'ready',generation:owner}));this.publish();return;
    }
    if(packet.type==='tabs'){this.updateTabs(packet.tabs);return;}
    if(packet.type==='detached'){this.tabs.get(String(packet.tabId))?.view.webContents.debugger.disconnected();return;}
    if(packet.type==='cdp'){const row=this.tabs.get(String(packet.tabId));if(row&&packet.documentId===row.automationDocument)row.view.webContents.debugger.emit('message',null,packet.method,packet.params,packet.sessionId);return;}
    const item=this.pending.get(packet.id);if(!item||item.generation!==owner)return;this.pending.delete(packet.id);clearTimeout(item.timer);
    packet.error?item.reject(Error(/^[a-z_]{3,80}$/.test(packet.error)?packet.error:'external_browser_request_failed')):item.resolve(packet.result);
   });
  });
  this.expiry=setTimeout(()=>{if(this.ticket===ticket)void this.stop();},300000);this.expiry.unref?.();
  this.heartbeat=setInterval(()=>{if(this.peer?.readyState===1)this.peer.send(JSON.stringify({type:'heartbeat'}));},20000);this.heartbeat.unref?.();
  this.publish();return {code:`ws://127.0.0.1:${this.server.address().port}/${ticket}`,expiresAt:this.expiresAt};
 }
 updateTabs(values){
  if(!Array.isArray(values)||values.length>32){this.peer?.terminate();return;}
  const present=new Set();
  for(const value of values){
   if(!value||!Number.isSafeInteger(value.id)||typeof value.url!=='string'||value.url.length>32768||typeof value.documentId!=='string'||value.documentId.length>100)continue;
   const id=String(value.id);present.add(id);let row=this.tabs.get(id);
   if(!row){
    row={id,view:{webContents:new EventEmitter()}};const contents=row.view.webContents,debuggerPort=new EventEmitter();let attached=false;
    debuggerPort.isAttached=()=>attached;debuggerPort.attach=()=>{if(attached)throw Error('browser_debugger_busy');attached=true;};
    debuggerPort.detach=()=>{if(!attached)return;attached=false;void this.command('detach',{tabId:id}).catch(()=>{});debuggerPort.emit('detach');};
    debuggerPort.disconnected=()=>{attached=false;debuggerPort.emit('detach');};
    debuggerPort.sendCommand=(method,params={},sessionId)=>this.command('cdp',{tabId:id,documentId:row.automationDocument,method,params,...(sessionId?{sessionId}:{})});
    contents.debugger=debuggerPort;contents.isDestroyed=()=>!this.tabs.has(id);contents.getURL=()=>row.url;contents.getTitle=()=>row.title;contents.getUserAgent=()=>this.browserVersion;contents.getBrowserVersion=()=>this.browserVersion.match(/Chrom(?:e|ium)\/([\d.]+)/)?.[1];
    this.tabs.set(id,row);
   }
   Object.assign(row,{title:String(value.title||'외부 브라우저').slice(0,500),url:value.url,authentication:value.protected===true,automationDocument:value.documentId});if(value.active)this.active=id;
  }
  for(const [id,row] of this.tabs)if(!present.has(id)){this.tabs.delete(id);row.view.webContents.emit('destroyed');}
  if(!this.tabs.has(this.active))this.active=this.tabs.keys().next().value||null;this.publish();
 }
 tab(id){const row=this.tabs.get(id);if(!row)throw Error('browser_tab_missing');return row;}
 command(action,args={}){
  if(!this.peer||!this.ready||this.peer.readyState!==1)return Promise.reject(Error('external_browser_connection_required'));
  if(this.pending.size>=32)return Promise.reject(Error('external_browser_busy'));
  const id=randomUUID(),generation=this.generation;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('external_browser_result_unconfirmed'));},action==='portalRead'?40000:this.timeout);
   this.pending.set(id,{resolve,reject,timer,generation,action,method:args.method});
   try{this.peer.send(JSON.stringify({type:'request',id,action,args,generation}));}catch{clearTimeout(timer);this.pending.delete(id);reject(Error('external_browser_result_unconfirmed'));}
  });
 }
 async request(action,args={}){
  if(!this.peer)throw Error('external_browser_connection_required');
  // Refresh metadata before trusting a cached document or reporting a target.
  this.updateTabs(await this.command('tabs'));
  if(action==='open'){
   const opened=await this.openPage(args.url);return this.playwright.request('check',{tabId:opened.tabId});
  }
  if(action==='capture'){
   const row=this.playwright.row(args.tabId);if(args.documentId!==row.automationDocument)throw Error('browser_document_changed');
   const shot=await this.command('capture',{...args,documentId:row.automationDocument}),bytes=Buffer.from(shot?.image||'','base64');
   if(args.documentId!==row.automationDocument||bytes.length<24||bytes.length>24*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('browser_capture_unavailable');
   return {...shot,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }
  return this.playwright.request(action,args);
 }
 async openPage(url){const opened=await this.command('open',{url:httpBrowserAddress(url)});this.updateTabs(opened.tabs);return {opened:true,external:true,automation:true,tabId:String(opened.tabId),userInteractionRequired:true};}
 async focus(tabId=this.active){await this.command('focus',{tabId});return this.status();}
 disconnected(){
  this.peer=null;this.ready=false;this.generation=null;this.windowId=null;this.playwright.dispose();
  for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error('external_browser_result_unconfirmed'));}this.pending.clear();
  for(const row of this.tabs.values())row.view.webContents.emit('destroyed');this.tabs.clear();this.active=null;this.publish();
 }
 async stop(){clearTimeout(this.expiry);clearInterval(this.heartbeat);this.ticket=null;this.peer?.terminate();this.disconnected();const server=this.server;this.server=null;if(server)await new Promise(resolve=>server.close(resolve));}
 dispose(){void this.stop();}
}
module.exports={ExternalBrowserHost};
