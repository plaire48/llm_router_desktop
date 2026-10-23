import {portalFetch} from './portal-contract.js';
import {createTabMirror} from './mirror.js';
import {createQuickConnector} from './quick-connector.js';
let socket=null,generation=null,windowId=null,sourceTab=null,portalTab=null,connecting=false;
let windowProof=null;
const tabs=new Map(),attached=new Set();
const restricted=value=>{try{const u=new URL(value);return !['http:','https:'].includes(u.protocol)||u.username||u.password||/^(?:epsso\.|accounts\.|login\.)/i.test(u.hostname)||/\/(?:loginapp|saml|oauth|authorize|sso)(?:\/|$)/i.test(u.pathname)||[...u.searchParams.keys(),...new URLSearchParams(u.hash.slice(1)).keys()].some(k=>/^(?:code|token|access_token|id_token|refresh_token|SAMLRequest|SAMLResponse)$/i.test(k));}catch{return true;}};
const send=value=>{if(socket?.readyState===1)socket.send(JSON.stringify(value));};
const mirror=createTabMirror({chrome,send,row,attached});
async function row(tabId,{documentId,allowPortal=false}={}){
 const id=Number(tabId),record=tabs.get(id);if(!record||!Number.isSafeInteger(id))throw Error('browser_tab_missing');
 const tab=await chrome.tabs.get(id);if(tab.incognito||tab.windowId!==windowId)throw Error('browser_tab_missing');
 if(!allowPortal&&restricted(tab.url))throw Error('browser_auth_protected');
 if(documentId&&documentId!==record.documentId)throw Error('browser_document_changed');return {tab,record};
}
async function inventory(){return (await Promise.all([...tabs].map(async([id,record])=>{try{const {tab}=await row(id,{allowPortal:true}),protectedPage=restricted(tab.url);let url=tab.url||'';if(protectedPage){try{const u=new URL(url);url=u.origin+u.pathname;}catch{url='about:blank';}}return {id,title:protectedPage?'로그인 확인':tab.title||'',url,protected:protectedPage,active:tab.active,documentId:record.documentId};}catch{tabs.delete(id);return null;}}))).filter(Boolean);}
async function endWindowProof(nonce){
 const proof=windowProof;if(!proof||proof.nonce!==nonce)return {ended:false};windowProof=null;clearTimeout(proof.timer);
 try{const tab=await chrome.tabs.get(proof.tabId);if(tab.windowId===proof.windowId&&tab.url===proof.url)await chrome.tabs.remove(proof.tabId);}catch{}
 // Restore only our temporary selection; never overwrite a user-selected tab.
 try{const active=await chrome.tabs.query({active:true,windowId:proof.windowId});if(!active.length||active[0].id===proof.previous){await chrome.tabs.update(proof.previous,{active:true});}}catch{}
 return {ended:true};
}
async function disconnect(){mirror.invalidate();if(windowProof)await endWindowProof(windowProof.nonce);const prior=socket;socket=null;generation=null;connecting=false;prior?.close();for(const id of attached)await chrome.debugger.detach({tabId:id}).catch(()=>{});attached.clear();tabs.clear();windowId=null;portalTab=null;sourceTab=null;}
async function dispatch(action,args){
 if(['mirrorStart','mirrorStop','mirrorAck','mirrorInput'].includes(action))return mirror.dispatch(action,args);
 if(action==='tabs')return inventory();
 if(action==='windowProofEnd')return endWindowProof(args.nonce);
 if(action==='windowProofStart'){
  if(windowProof||!generation||!Number.isSafeInteger(windowId))throw Error('dock_proof_busy');
  if(typeof args.nonce!=='string'||! /^[a-f0-9-]{36}$/.test(args.nonce))throw Error('dock_proof_invalid');
  const owner=generation,boundWindow=windowId,[previous]=await chrome.tabs.query({active:true,windowId});
  if(!previous)throw Error('dock_window_missing');
  const url=chrome.runtime.getURL('window-proof.html')+'#'+args.nonce;
  // Own extension page only. No website title, storage or credential is inspected.
  const tab=await chrome.tabs.create({windowId,active:true,url,openerTabId:previous.id,index:previous.index+1});
  if(owner!==generation){await chrome.tabs.remove(tab.id).catch(()=>{});throw Error('dock_connection_changed');}
  windowProof={nonce:args.nonce,tabId:tab.id,previous:previous.id,windowId:boundWindow,url,timer:setTimeout(()=>void endWindowProof(args.nonce),10000)};
  return {started:true};
 }
 if(action==='open'){
  const u=new URL(args.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('browser_url_invalid');
  const tab=await chrome.tabs.create({windowId,url:u.href,active:true});tabs.set(tab.id,{documentId:crypto.randomUUID()});
  // Open receipt and initial observation are separate. Do not report an empty
  // pendingUrl as a committed HTTP document.
  const until=Date.now()+5000;while(Date.now()<until){const current=await chrome.tabs.get(tab.id);if(/^https?:/.test(current.url||'')&&current.status==='complete')break;await new Promise(r=>setTimeout(r,100));}
  return {tabId:tab.id,tabs:await inventory()};
 }
 if(action==='portalBind'){
  const {tab}=await row(args.tabId,{allowPortal:true});const url=new URL(tab.url),base=new URL(args.origin);
  if(url.hostname!==base.hostname||url.port!==base.port||!(url.origin===base.origin||base.protocol==='http:'&&url.protocol==='https:'))throw Error('mail_portal_login');
  if(!await chrome.permissions.contains({origins:[url.origin+'/*']}))throw Error('external_browser_portal_permission_required');
  portalTab=tab.id;return {tabId:String(tab.id),origin:url.origin};
 }
 if(action==='portalRead'){
  if(Number(args.tabId)!==portalTab)throw Error('mail_portal_login');const {tab,record}=await row(portalTab,{allowPortal:true}),url=new URL(tab.url);
  if(url.origin!==args.origin||restricted(tab.url))throw Error('mail_portal_login');
  const documentId=record.documentId;
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:portalFetch,args:[args.input,{origin:args.origin}]});
  await row(tab.id,{documentId,allowPortal:true});if(result.length!==1)throw Error('mail_portal_request');return result[0].result;
 }
 const {tab,record}=await row(args.tabId,{documentId:args.documentId,allowPortal:['focus','detach','releaseTab'].includes(action)});
 if(action==='focus'){await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(windowId,{focused:true});return {focused:true};}
 if(action==='detach'){if(mirror.active(tab.id))return {released:true,retainedForMirror:true};if(attached.has(tab.id))await chrome.debugger.detach({tabId:tab.id}).catch(()=>{});attached.delete(tab.id);return {released:true};}
 if(action==='releaseTab'){mirror.invalidate(tab.id);if(attached.has(tab.id))await chrome.debugger.detach({tabId:tab.id}).catch(()=>{});attached.delete(tab.id);tabs.delete(tab.id);return {released:true};}
 if(action==='capture'){
  if(!attached.has(tab.id)){await chrome.debugger.attach({tabId:tab.id},'1.3');attached.add(tab.id);}
  const documentId=record.documentId,metrics=await chrome.debugger.sendCommand({tabId:tab.id},'Page.getLayoutMetrics',{}),viewport=metrics.cssLayoutViewport||metrics.layoutViewport;
  const clip=args.clip||{x:0,y:0,width:viewport.clientWidth,height:viewport.clientHeight};
  if(!['x','y','width','height'].every(k=>Number.isFinite(clip[k]))||clip.x<0||clip.y<0||clip.width<=0||clip.height<=0||clip.x+clip.width>viewport.clientWidth||clip.y+clip.height>viewport.clientHeight)throw Error('browser_capture_bounds_invalid');
  const maxWidth=Math.max(320,Math.min(2560,Number(args.maxWidth)||1920)),scale=Math.min(1,maxWidth/clip.width,Math.sqrt(4000000/(clip.width*clip.height)));
  const shot=await chrome.debugger.sendCommand({tabId:tab.id},'Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{...clip,x:clip.x+viewport.pageX,y:clip.y+viewport.pageY,scale}});
  await row(tab.id,{documentId});return {image:shot.data,url:tab.url,title:tab.title,tabId:String(tab.id),documentId,viewport:{width:viewport.clientWidth,height:viewport.clientHeight},clip};
 }
 if(action!=='cdp')throw Error('browser_action_invalid');
 if(mirror.interacting(tab.id))throw Error('browser_user_interacting');
 const method=args.method;
 if(typeof method!=='string'||/^(?:Browser|Storage)\./.test(method)||/^Network\.(?:getAllCookies|getCookies|setCookie|setCookies|deleteCookies|clearBrowserCookies|setExtraHTTPHeaders|setAcceptedEncodings)$/.test(method)||/^(?:Target\.(?:create|close|activate|attachTo)Target|Target\.createBrowserContext)$/.test(method))throw Error('browser_scope');
 if(method==='Page.navigate'&&(restricted(args.params?.url)||!/^https?:/.test(args.params?.url||'')))throw Error('browser_url_invalid');
 if(!attached.has(tab.id)){await chrome.debugger.attach({tabId:tab.id},'1.3');attached.add(tab.id);}
 const result=await chrome.debugger.sendCommand({tabId:tab.id,...(args.sessionId?{sessionId:args.sessionId}:{})},method,args.params||{});
 if(method!=='Page.navigate')await row(tab.id,{documentId:args.documentId});return result;
}
chrome.debugger.onEvent.addListener((source,method,params)=>{if(mirror.frame(source,method,params))return;if(!tabs.has(source.tabId)||!attached.has(source.tabId)||/^(?:Log\.|Runtime\.(?:consoleAPICalled|exceptionThrown))/.test(method))return;send({type:'cdp',tabId:String(source.tabId),documentId:tabs.get(source.tabId).documentId,method,params,...(source.sessionId?{sessionId:source.sessionId}:{})});});
chrome.debugger.onDetach.addListener(source=>{mirror.invalidate(source.tabId);attached.delete(source.tabId);send({type:'detached',tabId:String(source.tabId)});});
chrome.tabs.onUpdated.addListener((id,change)=>{const record=tabs.get(id);if(!record)return;if(change.status==='loading'||change.url){mirror.invalidate(id);record.documentId=crypto.randomUUID();}void inventory().then(values=>send({type:'tabs',tabs:values}));});
chrome.tabs.onRemoved.addListener(id=>{if(!tabs.has(id))return;mirror.invalidate(id);tabs.delete(id);attached.delete(id);if(portalTab===id)portalTab=null;void inventory().then(values=>send({type:'tabs',tabs:values}));});
chrome.tabs.onActivated.addListener(info=>{if(info.windowId===windowId&&tabs.has(info.tabId))void inventory().then(values=>send({type:'tabs',tabs:values}));});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||sender.tab||sender.url!==chrome.runtime.getURL('connect.html'))return;
 const run=async()=>{
  if(message.action==='status')return {connected:!!generation,connecting,sourceTab,mailReady:!!portalTab};
  if(message.action==='disconnect'){await disconnect();return {connected:false};}
  if(message.action==='mailPermission'){
   const {tab}=await row(sourceTab,{allowPortal:true}),u=new URL(tab.url);if(!['http:','https:'].includes(u.protocol))throw Error('mail_portal_login');
   if(!await chrome.permissions.request({origins:[u.origin+'/*']}))throw Error('external_browser_portal_permission_required');return {granted:true};
  }
  if(message.action!=='connect')throw Error('browser_action_invalid');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return connectTab(message.code,tab);
 };
 void run().then(reply,error=>reply({error:/^[a-z_]{3,80}$/.test(error.message)?error.message:'external_browser_request_failed'}));return true;
});

async function connectTab(code,tab){
  if(connecting||socket)throw Error('external_browser_busy');
  if(typeof code!=='string'||!/^ws:\/\/127\.0\.0\.1:\d{1,5}\/[a-f0-9]{64}$/.test(code))throw Error('external_browser_code_invalid');
  if(!tab||tab.incognito||!/^https?:\/\//.test(tab.url||''))throw Error('browser_auth_protected');
  sourceTab=tab.id;windowId=tab.windowId;tabs.set(tab.id,{documentId:crypto.randomUUID()});connecting=true;
  await new Promise((resolve,reject)=>{
   const ws=new WebSocket(code);socket=ws;const timer=setTimeout(()=>{ws.close();reject(Error('external_browser_timeout'));},5000);
   ws.onopen=async()=>{ws.send(JSON.stringify({type:'hello',version:1,windowId,browserVersion:navigator.userAgent,tabs:await inventory()}));};
   ws.onerror=()=>{clearTimeout(timer);reject(Error('external_browser_connection_failed'));};
   ws.onclose=()=>{clearTimeout(timer);if(socket===ws)void disconnect();reject(Error('external_browser_connection_failed'));};
   ws.onmessage=async event=>{let packet;try{packet=JSON.parse(event.data);}catch{return;}
    if(packet.type==='ready'){generation=packet.generation;connecting=false;clearTimeout(timer);resolve();return;}
    if(packet.type==='heartbeat'){send({type:'heartbeat'});return;}
    if(packet.type!=='request'||packet.generation!==generation)return;const owner=generation;
    try{const result=await dispatch(packet.action,packet.args||{});if(owner===generation)send({id:packet.id,result});}catch(error){if(owner===generation)send({id:packet.id,error:/^[a-z_]{3,80}$/.test(error.message)?error.message:'external_browser_request_failed'});}
   };
  });return {connected:true};

}
createQuickConnector({chrome,connect:connectTab,connected:()=>!!socket||connecting});
