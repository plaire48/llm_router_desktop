const {checkedBrowserEndpoint,browserEndpointFile}=require('./browser-endpoint.cjs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const {WebSocket}=require('ws');
const {portalFetch}=require('./mail-portal-contract.cjs');

// Chrome 144+ exposes this discovery file after the person enables its own
// connection setting. Read endpoint metadata only, never profile/session data.
function chromePortFile({platform=process.platform,home=os.homedir(),localAppData=process.env.LOCALAPPDATA}={}){
 if(platform==='darwin')return path.join(home,'Library/Application Support/Google/Chrome/DevToolsActivePort');
 if(platform==='win32'&&localAppData)return path.join(localAppData,'Google/Chrome/User Data/DevToolsActivePort');
 if(platform==='linux')return path.join(home,'.config/google-chrome/DevToolsActivePort');
 throw Error('browser_connection_unavailable');
}
const restricted=value=>{try{const u=new URL(value);return !['http:','https:'].includes(u.protocol)||u.username||u.password||/^(?:epsso\.|accounts\.|login\.)/i.test(u.hostname)||/\/(?:loginapp|saml|oauth|authorize|sso)(?:\/|$)/i.test(u.pathname)||[...u.searchParams.keys(),...new URLSearchParams(u.hash.slice(1)).keys()].some(k=>/^(?:code|token|access_token|id_token|refresh_token|SAMLRequest|SAMLResponse)$/i.test(k));}catch{return true;}};
class ChromeDirectConnection{
 constructor({endpoint,portFile=chromePortFile(),timeout=15000,onTabs=()=>{},onEvent=()=>{},onDisconnect=()=>{}}={}){Object.assign(this,{endpoint,portFile,timeout,onTabs,onEvent,onDisconnect});this.pending=new Map();this.records=new Map();this.sessions=new Map();this.candidates=new Map();this.nextId=0;this.serial=0;this.attached=new Set();}
 async connect({signal,permissionTimeout=90000}={}){
  signal?.throwIfAborted();let endpoint;
  if(this.endpoint)endpoint=checkedBrowserEndpoint(await (typeof this.endpoint==='function'?this.endpoint({signal}):this.endpoint));
  else try{endpoint=await browserEndpointFile(typeof this.portFile==='function'?await this.portFile():this.portFile);}catch(error){throw Error(['browser_samsung_unavailable','browser_connection_unavailable'].includes(error.message)?error.message:'browser_connection_permission_required');}
  signal?.throwIfAborted();
  const socket=new WebSocket(endpoint,{maxPayload:140*1024*1024});this.socket=socket;
  socket.on('error',()=>{});socket.on('message',bytes=>this.receive(bytes));socket.on('close',()=>{if(this.socket!==socket)return;this.socket=null;this.rejectPending();this.onDisconnect();});
  try{
   await new Promise((resolve,reject)=>{
    const end=error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.removeListener('open',opened);socket.removeListener('error',failed);socket.removeListener('close',closed);error?reject(error):resolve();};
    const opened=()=>end(),failed=()=>end(Error('browser_connection_unavailable')),closed=()=>end(Error('browser_connection_denied')),abort=()=>{socket.terminate();end(Error('dock_cancelled'));},timer=setTimeout(()=>{socket.terminate();end(Error('browser_connection_permission_required'));},permissionTimeout);
    socket.once('open',opened);socket.once('error',failed);socket.once('close',closed);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   });
   this.version=await this.send('Browser.getVersion');
   const contexts=await this.send('Target.getBrowserContexts');this.privateContexts=new Set(contexts.browserContextIds||[]);
   await this.send('Target.setDiscoverTargets',{discover:true});return this.list();
  }catch(error){await this.close();throw error;}
 }
 send(method,params={},sessionId){
  const socket=this.socket;if(!socket||socket.readyState!==1)return Promise.reject(Error('external_browser_connection_required'));
  if(this.pending.size>=64)return Promise.reject(Error('external_browser_busy'));
  const id=++this.serial;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('external_browser_result_unconfirmed'));},this.timeout);this.pending.set(id,{resolve,reject,timer});try{socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}catch{clearTimeout(timer);this.pending.delete(id);reject(Error('external_browser_result_unconfirmed'));}});
 }
 receive(bytes){
  let value;try{value=JSON.parse(String(bytes));}catch{return;}
  if(value.id){const p=this.pending.get(value.id);if(!p)return;this.pending.delete(value.id);clearTimeout(p.timer);value.error?p.reject(Error('external_browser_request_failed')):p.resolve(value.result||{});return;}
  const {method,params={},sessionId}=value;
  if(method==='Target.targetDestroyed'){const record=[...this.records.values()].find(r=>r.targetId===params.targetId);if(record){this.mirror?.invalidate(record.id);this.sessions.delete(record.sessionId);this.records.delete(record.id);this.onTabs(this.inventory());}return;}
  if(method==='Target.targetInfoChanged'){
   const record=[...this.records.values()].find(r=>r.targetId===params.targetInfo?.targetId);if(record){if(record.url!==params.targetInfo.url){this.mirror?.invalidate(record.id);record.documentId=randomUUID();}Object.assign(record,{url:params.targetInfo.url,title:params.targetInfo.title});this.onTabs(this.inventory());}return;
  }
  if(method==='Target.targetCreated'&&[...this.records.values()].some(r=>r.targetId===params.targetInfo?.openerId)&&!restricted(params.targetInfo.url))void this.admit(params.targetInfo).then(()=>this.onTabs(this.inventory())).catch(()=>{});
  const record=this.sessions.get(sessionId);if(!record)return;
  if(method==='Target.attachedToTarget'&&params.sessionId){record.children.add(params.sessionId);this.sessions.set(params.sessionId,record);}
  if(method==='Target.detachedFromTarget'&&params.sessionId){record.children.delete(params.sessionId);this.sessions.delete(params.sessionId);}
  if(method==='Page.frameNavigated'&&!params.frame?.parentId&&sessionId===record.sessionId){this.mirror?.invalidate(record.id);record.documentId=params.frame.loaderId||randomUUID();record.url=params.frame.url;this.onTabs(this.inventory());}
  if(this.mirror?.frame({tabId:record.id},method,params))return;
  if(!/^(?:Log\.|Runtime\.(?:consoleAPICalled|exceptionThrown))/.test(method))this.onEvent({tabId:String(record.id),documentId:record.documentId,method,params,...(sessionId!==record.sessionId?{sessionId}:{})});
 }
 async list(){
  const {targetInfos=[]}=await this.send('Target.getTargets');this.candidates=new Map(targetInfos.filter(t=>t.type==='page'&&!this.privateContexts?.has(t.browserContextId)&&!restricted(t.url)).map(t=>[t.targetId,t]));
  return [...this.candidates.values()].slice(0,100).map(t=>({id:t.targetId,title:String(t.title||new URL(t.url).hostname).slice(0,250),origin:new URL(t.url).origin}));
 }
 async choose(id){
  if(typeof id!=='string'||!this.candidates.has(id))throw Error('browser_tab_missing');
  const {targetInfo}=await this.send('Target.getTargetInfo',{targetId:id});if(!targetInfo||restricted(targetInfo.url)||this.privateContexts?.has(targetInfo.browserContextId))throw Error('browser_auth_protected');
  const record=await this.admit(targetInfo);this.active=record.id;const {windowId}=await this.send('Browser.getWindowForTarget',{targetId:id});this.windowId=windowId;
  if(!this.mirror){const {createTabMirror}=await import('../browser-connector/mirror.js');const chrome={debugger:{attach:async({tabId})=>{this.record(tabId);},sendCommand:({tabId},method,params)=>this.target(this.record(tabId),method,params)}};
   this.mirror=createTabMirror({chrome,attached:this.attached,send:packet=>this.onFrame?.(packet),row:async(tabId,options)=>{const record=this.checked(tabId,options);return {tab:{id:record.id,url:record.url},record};}});
  }
  return this.inventory();
 }
 async admit(info){
  const found=[...this.records.values()].find(r=>r.targetId===info.targetId);if(found)return found;
  if(info.type!=='page'||this.privateContexts?.has(info.browserContextId))throw Error('browser_scope');if(this.records.size>=12)throw Error('browser_tab_limit');
  const {sessionId}=await this.send('Target.attachToTarget',{targetId:info.targetId,flatten:true});if(!sessionId)throw Error('external_browser_connection_failed');
  const record={id:++this.nextId,targetId:info.targetId,sessionId,children:new Set(),documentId:randomUUID(),url:info.url,title:info.title};this.records.set(record.id,record);this.sessions.set(sessionId,record);this.attached.add(record.id);
  try{await this.target(record,'Page.enable');const {frameTree}=await this.target(record,'Page.getFrameTree');if(frameTree?.frame?.loaderId)record.documentId=frameTree.frame.loaderId;return record;}
  catch(error){this.records.delete(record.id);this.sessions.delete(sessionId);await this.send('Target.detachFromTarget',{sessionId}).catch(()=>{});throw error;}
 }
 record(id){const record=this.records.get(Number(id));if(!record)throw Error('browser_tab_missing');return record;}
 checked(id,{documentId,allowPortal=false}={}){const record=this.record(id);if(documentId&&documentId!==record.documentId)throw Error('browser_document_changed');if(!allowPortal&&restricted(record.url))throw Error('browser_auth_protected');return record;}
 target(record,method,params={},child){if(child&&!record.children.has(child))return Promise.reject(Error('browser_scope'));return this.send(method,params,child||record.sessionId);}
 inventory(){return [...this.records.values()].map(r=>{const protectedPage=restricted(r.url);let url;try{url=new URL(r.url);}catch{}return {id:r.id,title:protectedPage?'로그인 확인':r.title||url?.hostname||'업무 탭',url:protectedPage?(url?.origin==='null'?'':url?.origin||'')+(url?.pathname||''):r.url,protected:protectedPage,active:r.id===this.active,documentId:r.documentId};});}
 async command(action,args={}){
  if(['mirrorStart','mirrorStop','mirrorAck','mirrorInput'].includes(action))return this.mirror.dispatch(action,args);
  if(action==='tabs')return this.inventory();
  if(action==='open'){
   const u=new URL(args.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('browser_url_invalid');
   const {targetId}=await this.send('Target.createTarget',{url:u.href,...(this.windowId?{windowId:this.windowId}:{})});const {targetInfo}=await this.send('Target.getTargetInfo',{targetId});const r=await this.admit(targetInfo);this.active=r.id;return {tabId:r.id,tabs:this.inventory()};
  }
  const record=this.checked(args.tabId,{documentId:args.documentId,allowPortal:['focus','detach','releaseTab','portalBind'].includes(action)});
  if(action==='focus'){await this.send('Target.activateTarget',{targetId:record.targetId});this.active=record.id;return {focused:true};}
  if(action==='detach')return {released:true,retainedForMirror:true};
  if(action==='releaseTab'){await this.mirror?.invalidate(record.id);await this.send('Target.detachFromTarget',{sessionId:record.sessionId});this.records.delete(record.id);this.sessions.delete(record.sessionId);this.attached.delete(record.id);return {released:true};}
  if(action==='portalBind'){const u=new URL(record.url),base=new URL(args.origin);if(u.hostname!==base.hostname||u.port!==base.port||!(u.origin===base.origin||base.protocol==='http:'&&u.protocol==='https:'))throw Error('mail_portal_login');this.portal={id:record.id,origin:u.origin};return {tabId:String(record.id),origin:u.origin};}
  if(action==='portalRead'){
   if(this.portal?.id!==record.id||this.portal.origin!==args.origin||new URL(record.url).origin!==args.origin)throw Error('mail_portal_login');const documentId=record.documentId;
   const {frameTree}=await this.target(record,'Page.getFrameTree'),world=await this.target(record,'Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'nubi-fixed-mail-reader'});
   const result=await this.target(record,'Runtime.callFunctionOn',{functionDeclaration:`async function(input,origin){return (${portalFetch.toString()})(input,{origin});}`,executionContextId:world.executionContextId,arguments:[{value:args.input},{value:args.origin}],awaitPromise:true,returnByValue:true});this.checked(record.id,{documentId});
   if(result.exceptionDetails)throw Error('mail_portal_request');return result.result?.value;
  }
  if(action==='capture'){
   const documentId=record.documentId,{cssLayoutViewport,layoutViewport}=await this.target(record,'Page.getLayoutMetrics'),v=cssLayoutViewport||layoutViewport,clip=args.clip||{x:0,y:0,width:v.clientWidth,height:v.clientHeight};
   if(!['x','y','width','height'].every(k=>Number.isFinite(clip[k]))||clip.x<0||clip.y<0||clip.width<=0||clip.height<=0||clip.x+clip.width>v.clientWidth||clip.y+clip.height>v.clientHeight)throw Error('browser_capture_bounds_invalid');
   const scale=Math.min(1,Math.max(320,Math.min(2560,Number(args.maxWidth)||1920))/clip.width,Math.sqrt(4000000/(clip.width*clip.height))),shot=await this.target(record,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{...clip,x:clip.x+v.pageX,y:clip.y+v.pageY,scale}});this.checked(record.id,{documentId});return {image:shot.data,url:record.url,title:record.title,tabId:String(record.id),documentId,viewport:{width:v.clientWidth,height:v.clientHeight},clip};
  }
  if(action!=='cdp')throw Error('browser_action_invalid');if(this.mirror?.interacting(record.id))throw Error('browser_user_interacting');const method=args.method;
  if(typeof method!=='string'||/^(?:Browser|Storage)\./.test(method)||/^Network\.(?:getAllCookies|getCookies|setCookie|setCookies|deleteCookies|clearBrowserCookies|setExtraHTTPHeaders|setAcceptedEncodings)$/.test(method)||/^Target\.(?:createTarget|closeTarget|activateTarget|attachToTarget|createBrowserContext)$/.test(method))throw Error('browser_scope');
  if(method==='Page.navigate'&&restricted(args.params?.url))throw Error('browser_url_invalid');const result=await this.target(record,method,args.params,args.sessionId);if(method!=='Page.navigate')this.checked(record.id,{documentId:args.documentId});return result;
 }
 rejectPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('external_browser_result_unconfirmed'));}this.pending.clear();}
 async close(){
  this.onDisconnect=()=>{};await this.mirror?.invalidate();
  for(const record of this.records.values())await this.send('Target.detachFromTarget',{sessionId:record.sessionId}).catch(()=>{});
  const socket=this.socket;this.socket=null;socket?.terminate();this.rejectPending();this.records.clear();this.sessions.clear();this.attached.clear();this.candidates.clear();
 }
}
module.exports={ChromeDirectConnection,chromePortFile};
