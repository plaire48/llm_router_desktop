const {MailCredentialLogin}=require('./mail-credential-login.cjs');
const {loginRedirect}=require('./mail-session-recovery.cjs');
const {mailSessionFetch}=require('./mail-session-fetch.cjs');
const {ORIGIN,LOGIN_URL,portalOrigin,foldersOf,identityOf,portalFetch,portalFetchSource}=require('./mail-portal-contract.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MAIL_POLL_INTERVAL_MS=5*60*1000;
const loginLocation=value=>{try{return loginRedirect(new URL(value),LOGIN_URL);}catch{return false;}};
class MailPortal {
 // Login happens in the app's own browser tab (openPage/closePage) when the host offers one; the hidden window only
 // runs the read-only portal fetches on the same persistent session (user request 2026-10-14: no separate popup).
 constructor({BrowserWindow,invoke,parent,openPage=null,closePage=null,getPageContents=null,fetchSession=mailSessionFetch,onDisconnected=()=>{}}){this.onDisconnected=onDisconnected;this.fetchSession=fetchSession;this.BrowserWindow=BrowserWindow;this.invoke=invoke;this.parent=parent;this.openPage=openPage;this.closePage=closePage;this.getPageContents=getPageContents;this.page=null;this.state={connected:false,connecting:false,checking:false,folders:[],error:null};this.epoch=0;this.origin=ORIGIN;this.access=new AbortController();}
 status(){return {...this.state};}
 async identify(epoch=this.epoch){
  const read=async(...args)=>{if(epoch!==this.epoch)throw Error('mail_cancelled');const result=await this.read(...args);if(epoch!==this.epoch)throw Error('mail_cancelled');return result;};
  let identity;try{identity=identityOf(await read('identity'));}catch(error){if(!['mail_portal_identity','mail_portal_format','mail_portal_request','mail_portal_login'].includes(error.message))throw error;}
  const folders=foldersOf(await read('folders',{setCd:identity?.setCd||''}));
  if(!identity?.email||!identity?.userId){const sent=folders.find(folder=>folder.mailbox==='sent');if(sent){const list=await read('list',{folderId:sent.id,setCd:identity?.setCd||''});const row=list?.liteHeaderVOs?.[0];if(row&&/^\d{1,20}$/.test(String(row.mailSeq))){const summary=await read('summary',{folderId:sent.id,seq:String(row.mailSeq)}),from=summary?.from||{};const userId=identity?.userId||from.userID||from.epID;const email=identity?.email||(typeof from.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.email)?from.email:null);if(!identity&&(typeof userId==='string'||email))identity={id:typeof userId==='string'?userId:email,setCd:''};if(identity)identity={...identity,email,userId:typeof userId==='string'?userId:null};}}}
  if(!identity?.email){const inbox=folders.find(folder=>folder.mailbox==='inbox');if(inbox){const list=await read('list',{folderId:inbox.id,setCd:identity?.setCd||''}),row=list?.liteHeaderVOs?.[0];if(row&&/^\d{1,20}$/.test(String(row.mailSeq))){const message=await read('summary',{folderId:inbox.id,seq:String(row.mailSeq)}),received=message?.receivedAddress;
    const email=typeof received==='string'?received:received?.email||received?.address;if(typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){const recipients=[...(Array.isArray(message.toRecipients)?message.toRecipients:[]),...(Array.isArray(message.ccRecipients)?message.ccRecipients:[]),...(Array.isArray(message.bccRecipients)?message.bccRecipients:[])];const own=recipients.find(person=>(person?.email||person?.address||person?.emailAddress?.address||'').toLowerCase()===email.toLowerCase()),userId=identity?.userId||own?.userID||own?.epID;identity={...identity,id:identity?.id||email,email,userId:typeof userId==='string'?userId:null,setCd:identity?.setCd||''};}
   }}}
  if(!identity)throw Error('mail_portal_identity');identity={...identity,id:identity.userId||identity.email||identity.id};return {identity,folders};
 }
 restore(){
  if(this.restoring||this.restored||this.state.connecting)return this.restoring;
  this.restored=true;const epoch=this.epoch;
  const pending=this.restoreSession(epoch);this.restoring=pending;
  void pending.finally(()=>{if(this.restoring===pending)this.restoring=null;}).catch(()=>{});return pending;
 }
 async restoreSession(epoch){
  try{await this.windowForLogin(false,epoch);if(epoch!==this.epoch)return;
   const {identity,folders}=await this.identify(epoch);if(epoch!==this.epoch)return;
   await this.invoke('mail',{action:'portalConnect',identity:identity.id,email:identity.email,folders});if(epoch!==this.epoch)return;
   this.approvalCache=new Map();this.approvalCacheBytes=0;this.identity=identity;this.state={...this.state,connected:true,folders,error:null,connectionState:'connected',nextRetryAt:null};void this.sync().catch(()=>{});
  }catch(error){if(epoch!==this.epoch)return;await this.failSession(error,epoch);}

 }
 async windowForLogin(show=false,epoch=this.epoch){
  if(!this.window||this.window.isDestroyed()){
   this.window=new this.BrowserWindow({parent:this.parent,width:1050,height:780,show:false,title:'누비 메일 로그인',webPreferences:{partition:'persist:nubi-company',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
   // The session is shared with the in-app company login tabs: their copy buttons need clipboard-sanitized-write.
   this.window.webContents.session.setPermissionRequestHandler((_contents,permission,reply)=>reply(permission==='clipboard-sanitized-write'));
   // The background reader must never start or replay an SSO popup as a GET.
   // Interactive authentication belongs to BrowserHost, which preserves POST/opener.
   this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   const guard=(event,url)=>{const origin=portalOrigin(url,this.origin);if(!origin)event.preventDefault();else this.origin=origin;};
   this.window.webContents.on('will-redirect',guard);
   this.window.webContents.on('will-navigate',guard);
   this.window.on('closed',()=>{this.window=null;this.epoch++;this.state={...this.state,connected:false,connecting:false,error:null};clearTimeout(this.timer);void this.invoke('mail',{action:'disconnect'}).catch(()=>{});});
  }
  if(show){
   if(!this.openPage)throw Error('mail_portal_desktop_only');
   this.window.webContents.stop?.();await this.window.loadURL('about:blank');
  }else await this.window.loadURL('about:blank');
  if(epoch!==this.epoch)throw Error('mail_cancelled');
  if(show&&this.openPage&&!this.page){this.page=this.openPage(LOGIN_URL,{onClosed:()=>{if(this.page&&epoch===this.epoch)void this.disconnect().catch(()=>{});}});}
  return this.window;
 }
 closeLoginPage(){const page=this.page;this.page=null;if(page&&this.closePage){try{this.closePage(page.tabId);}catch{}}this.window?.hide();}
 async readContents(contents,operation,input={}){
  if(!contents||contents.isDestroyed?.())throw Error('mail_portal_login');
  const origin=portalOrigin(contents.getURL(),this.origin);if(!origin||loginLocation(contents.getURL()))throw Error('mail_portal_login');this.origin=origin;
  try{return await contents.executeJavaScript(`(${portalFetchSource(origin)})(${JSON.stringify({operation,...input})})`);}
  catch(error){throw Error(/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_portal_request');}
 }
 async read(operation,input={}){
  if(!this.window||this.window.isDestroyed())throw Error('mail_portal_login');
  if(this.page&&this.getPageContents){
   // Probe only the authenticated portal, never inject mail requests into the SSO provider.
   const rows=[...this.getPageContents(this.page.tabId)].filter(contents=>!contents.isDestroyed());
   // The single login tab can itself be abnormal-logout (not only a child
   // popup). Leave it open for user input; expired API probes returning 403
   // must not end that interactive login before it returns to the portal.
   const active=rows.at(-1);
   if(rows.some(contents=>contents.isLoadingMainFrame())||(active&&(!portalOrigin(active.getURL(),this.origin)||loginLocation(active.getURL()))))throw Error('mail_portal_login');
   for(const contents of rows.reverse()){
    if(contents.isDestroyed()||contents.isLoadingMainFrame())continue;
    const portal=portalOrigin(contents.getURL(),this.origin);
    if(portal){try{return await this.readContents(contents,operation,input);}catch(error){if(!['mail_portal_login','mail_portal_request','mail_portal_format'].includes(error.message))throw error;}}
   }
   // API probes use the same cookie jar without navigating another document into SSO.
   return this.readSession(operation,input);
  }
  return this.readSession(operation,input);
 }
 async readSession(operation,input={}){
  const session=this.window?.webContents.session;if(!session)throw Error('mail_portal_request');
  const epoch=this.epoch;
  const fetch=async(url,options)=>{
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   let response=await this.fetchSession(session,url,{...options,redirect:'manual'});
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   if(response.status>=300&&response.status<400){
    const original=new URL(url);let target;try{target=new URL(response.headers.get('location'),url);}catch{}
    const origin=target&&portalOrigin(target.href,this.origin);
    const upgrade=origin&&original.protocol==='http:'&&target.protocol==='https:'&&target.pathname===original.pathname&&target.search===original.search&&!target.hash;
    await response.body?.cancel();
    // Follow only an exact same-host HTTPS upgrade of this fixed read-only API.
    // Login redirects are never followed or replayed as GET/POST in the background.
    if(!upgrade)throw Error(loginRedirect(target,LOGIN_URL)?'mail_portal_login':'mail_portal_redirect');
    this.origin=origin;response=await this.fetchSession(session,target.href,{...options,redirect:'manual'});
    if(epoch!==this.epoch)throw Error('mail_cancelled');
    if(response.status>=300&&response.status<400){let next;try{next=new URL(response.headers.get('location'),target.href);}catch{}await response.body?.cancel();throw Error(loginRedirect(next,LOGIN_URL)?'mail_portal_login':'mail_portal_redirect');}
   }
   return response;
  };
  return portalFetch({operation,...input},{origin:this.origin,fetch,signal:this.access.signal});
 }
 async loginPageFailed(){
  if(!this.page||!this.getPageContents)return false;
  for(const contents of this.getPageContents(this.page.tabId)){
   if(contents.isDestroyed()||contents.isLoadingMainFrame())continue;
   // Return only a fixed boolean. Never collect the URL, login fields or page body.
   try{if(await contents.executeJavaScript(`(()=>{const text=(document.body?.innerText||'').slice(0,8000);return /Whitelabel Error Page/i.test(text)&&/no explicit mapping for \\/error/i.test(text);})()`))return true;}catch{}
  }
  return false;
 }
 async sessionReady(){
  await this.sessionClearing;
  if(this.state.error==='mail_portal_logout_failed')throw Error('mail_portal_logout_failed');
  if(this.state.connecting||this.state.checking)throw Error('mail_busy');
  if(this.restoring)await this.restoring;
  const epoch=this.epoch;this.restored=true;
  try{await this.windowForLogin(false,epoch);const {identity,folders}=await this.identify(epoch);
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   await this.invoke('mail',{action:'portalConnect',identity:identity.id,email:identity.email,folders});
   if(epoch!==this.epoch)throw Error('mail_cancelled');this.identity=identity;this.state={...this.state,connected:true,error:null,folders,connectionState:'connected',nextRetryAt:null};void this.sync().catch(()=>{});return this.status();
  }catch(error){if(epoch!==this.epoch)throw Error('mail_cancelled');if(this.state.connected)await this.failSession(error,epoch);return {...this.status(),requiresLogin:true};}
 }
 async connect(args={}){
  // A disconnect that lands while the previous session is still being cleared cancels this login too, instead of
  // the login taking a fresh epoch after the cancel and opening a late tab (tests: queued login while restore pends).
  const requested=this.epoch;await this.sessionClearing;if(this.epoch!==requested)throw Error('mail_cancelled');
  if(this.state.connecting||this.state.checking)throw Error('mail_busy');
  const epoch=++this.epoch;this.access.abort();this.access=new AbortController();this.restored=true;clearTimeout(this.timer);this.syncing=null;this.state={...this.state,connected:false,connecting:true,loginStage:'preparing',error:null};
  try{
   // Finish an invalidated restore before starting the interactive session. No overlapping SSO requests.
   this.window?.webContents.stop?.();await this.restoring;if(epoch!==this.epoch)throw Error('mail_cancelled');
   await this.windowForLogin(!args.credentials,epoch);this.state.loginStage='authenticating';
   if(args.credentials){
    const login=new MailCredentialLogin({BrowserWindow:this.BrowserWindow,session:this.window.webContents.session,signal:this.access.signal});
    await login.run(args.credentials);if(epoch!==this.epoch)throw Error('mail_cancelled');
   }
   this.state.loginStage=args.credentials?'verifying':'authenticating';let identity,folders;
   const deadline=Date.now()+5*60*1000;
   while(epoch===this.epoch&&Date.now()<deadline){
    try{({identity,folders}=await this.identify(epoch));break;}
    catch(error){if(await this.loginPageFailed())throw Error('mail_portal_sso');if(!['mail_portal_login','mail_portal_request','mail_portal_format','mail_portal_redirect'].includes(error.message))throw error;if(epoch!==this.epoch)break;await wait(2000);}
   }
   if(epoch!==this.epoch)throw Error('mail_cancelled');if(!identity||!folders)throw Error('mail_portal_timeout');
   if(this.page&&this.getPageContents){
    // Verify the shared session through the fixed mail API. The hidden window stays blank;
    // no second SSO navigation or manual visit to the mailbox page is needed.
    this.state.loginStage='verifying';
    folders=foldersOf(await this.readSession('folders',{setCd:identity.setCd}));
    if(epoch!==this.epoch)throw Error('mail_cancelled');
   }
   await this.invoke('mail',{action:'portalConnect',identity:identity.id,email:identity.email,folders,destination:args.destination});
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   this.approvalCache=new Map();this.approvalCacheBytes=0;this.identity=identity;this.state={connected:true,connecting:false,checking:false,loginStage:'connected',folders,error:null,connectionState:'connected',nextRetryAt:null};this.closeLoginPage();
   // Return after login; collection stays outside the UI's admission call.
   void this.sync().catch(()=>{});return this.status();
  }catch(error){if(epoch===this.epoch){this.closeLoginPage();this.state={...this.state,connecting:false,connected:false,loginStage:null,error:/^mail_/.test(error.message)?error.message:'mail_portal_request'};}throw Error(epoch!==this.epoch?'mail_cancelled':this.state.error);}
 }
 sync(input={}){
  if(this.syncing)return this.syncing;
  const pending=this.syncNow(input);this.syncing=pending;
  void pending.finally(()=>{if(this.syncing===pending)this.syncing=null;}).catch(()=>{});
  return pending;
 }
 async recheck(){
  if(!this.state.connected)throw Error('mail_portal_login');return this.sync({manual:true});
 }
 async syncNow({manual=false}={}){
  if(!this.state.connected)throw Error('mail_portal_login');if(this.state.checking)return this.status();
  const epoch=this.epoch;const settings=await this.invoke('mail',{action:'status'});if(epoch!==this.epoch)throw Error('mail_cancelled');if(settings?.requiresStorageSetup||settings?.storageMoving){clearTimeout(this.timer);return this.status();}if(settings?.watchPaused&&!manual)return this.status();clearTimeout(this.timer);this.state={...this.state,checking:true,error:null,completed:0,total:null};
  try{
   const folders=foldersOf(await this.read('folders',{setCd:this.identity.setCd}));if(epoch!==this.epoch)throw Error('mail_cancelled');this.state.folders=folders;
   await this.invoke('mail',{action:'portalFolders',folders});if(epoch!==this.epoch)throw Error('mail_cancelled');
   const known=new Set((await this.invoke('mail',{action:'portalKnown'})).uids);if(epoch!==this.epoch)throw Error('mail_cancelled');
   let completed=0,discovered=0;
   for(const folder of folders){let cursor=0;const seen=new Set();
    for(let page=0;page<200;page++){
     if(epoch!==this.epoch)throw Error('mail_cancelled');
     const result=await this.read('list',{folderId:folder.id,cursor,setCd:this.identity.setCd});if(epoch!==this.epoch)throw Error('mail_cancelled');if(!Array.isArray(result?.liteHeaderVOs))throw Error('mail_portal_format');
     const fresh=result.liteHeaderVOs.filter(item=>!seen.has(String(item.mailSeq)));
     if(!fresh.length)break;
     for(const item of fresh){const seq=String(item.mailSeq);if(!/^\d{1,20}$/.test(seq))throw Error('mail_portal_format');seen.add(seq);const uid=`portal:${folder.id}:${seq}`;discovered++;
      if(known.has(uid))continue;if(epoch!==this.epoch)throw Error('mail_cancelled');
      try{const metadata={...item,...await this.read('summary',{folderId:folder.id,seq})};if(epoch!==this.epoch)throw Error('mail_cancelled');const packet=await this.read('eml',{folderId:folder.id,seq});if(epoch!==this.epoch)throw Error('mail_cancelled');await this.invoke('mail',{action:'portalImport',uid,raw:packet.raw,size:packet.size,folder,metadata});if(epoch!==this.epoch)throw Error('mail_cancelled');known.add(uid);completed++;}
      catch(error){if(epoch!==this.epoch||['mail_portal_login','mail_cancelled','mail_portal_request','mail_portal_timeout','mail_portal_forbidden','mail_portal_unavailable','mail_portal_rate_limited','mail_portal_response','mail_portal_redirect','mail_tls_error'].includes(error.message))throw error;await this.invoke('mail',{action:'portalRejected',uid,error:error.message});}
      this.state={...this.state,completed,total:folders.reduce((sum,f)=>sum+(f.total||0),0)||null};
     }
     const next=Number(fresh.at(-1).mailSeq);if(!Number.isSafeInteger(next)||next===cursor)break;cursor=next;
     if(folder.total!==null&&seen.size>=folder.total)break;if(page===199)throw Error('mail_portal_page_limit');
    }
   }
   if(epoch!==this.epoch)throw Error('mail_cancelled');this.state={...this.state,checking:false,lastCheckedAt:new Date().toISOString(),discovered,error:null,connectionState:'connected',nextRetryAt:null};
   // Schedule after completion so a slow collection never overlaps the next check.
   this.timer=setTimeout(()=>void this.sync().catch(()=>{}),MAIL_POLL_INTERVAL_MS);this.timer.unref?.();return this.status();
  }catch(error){
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   await this.failSession(error,epoch);throw error;
  }
 }
 async failSession(error,epoch=this.epoch){
  if(epoch!==this.epoch||error.message==='mail_cancelled')return;
  if(this.sessionClearing)return this.sessionClearing;
  const code=/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_portal_request',current=epoch+1;
  const pending=(async()=>{
   await this.disconnect();if(current!==this.epoch)return;
   let failure=code;try{await this.clearPortalSession();}catch{failure='mail_portal_logout_failed';}
   if(current!==this.epoch)return;
   this.state={...this.state,error:failure,connectionState:'authentication_required',failureCode:code};
   this.onDisconnected({code:failure});
  })();this.sessionClearing=pending;
  try{await pending;}finally{if(this.sessionClearing===pending)this.sessionClearing=null;}
 }
 async clearPortalSession(){
  const session=this.window?.webContents.session;
  if(!session)return;
  // Chromium clears cookies at registrable-domain scope. Only Samsung portal domains, never GHES or AI domains.
  for(const origin of new Set([ORIGIN,'https://samsung.net','https://samsung.com'])){
   if(session.clearData)await session.clearData({dataTypes:['cookies'],origins:[origin]});
   else if(session.clearStorageData)await session.clearStorageData({origin,storages:['cookies']});
  }
 }
 async approvals({page=1}={}){
  if(!this.state.connected)throw Error('mail_portal_login');if(!this.identity?.userId)throw Error('mail_portal_identity');if(!Number.isSafeInteger(page)||page<1||page>10000)throw Error('mail_input_invalid');
  // A login page from the approval endpoint while mail is connected is its own code (user report 2026-10-15: the list
  // said '로그인하세요' after a normal login), so the screen can say which request was refused.
  const epoch=this.epoch;let result;try{result=await this.read('approvals',{page,userId:this.identity.userId});}catch(error){await this.failSession(error,epoch);throw Error(error.message==='mail_portal_login'?'mail_portal_approval_login':error.message);}
  if(epoch!==this.epoch)throw Error('mail_cancelled');if(!Array.isArray(result?.data))throw Error('mail_portal_format');
  this.approvalCache=new Map();this.approvalCacheBytes=0;const rows=result.data.slice(0,100).map(item=>({id:String(item.apId),lineId:String(item.aplnId),subject:String(item.subject||item.apTitle||'').slice(0,1000),submittedAt:item.sbmDt||null,completedAt:item.cplDt||null,status:String(item.apActStatsCd||'').slice(0,60)}));
  let next=0;await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{while(next<rows.length){const row=rows[next++];if(epoch!==this.epoch)throw Error('mail_cancelled');try{const item=await this.approvalItem(row);row.subject=String(item.subject||row.subject||'(제목 없음)').slice(0,1000);}catch(error){row.subject=row.subject||'(제목 확인 필요)';row.error=error.message;}}}));
  if(epoch!==this.epoch)throw Error('mail_cancelled');this.approvalPageSize=Math.max(this.approvalPageSize||0,rows.length);const total=Number.isSafeInteger(result.totalCount)?result.totalCount:rows.length;return {page,total,hasNext:rows.length>0&&page*this.approvalPageSize<total,items:rows};
 }
 async approvalItem({id,lineId}){
  if(!/^[\w-]{1,100}$/.test(id)||!/^[\w-]{1,100}$/.test(lineId))throw Error('mail_input_invalid');
  const key=id+'|'+lineId;if(this.approvalCache?.has(key))return this.approvalCache.get(key);
  const epoch=this.epoch;let result;try{result=await this.read('approvalItem',{ap:id,ln:lineId});}catch(error){await this.failSession(error,epoch);throw error;}if(epoch!==this.epoch)throw Error('mail_cancelled');
  const item=result?.[0];if(!item||typeof item!=='object')throw Error('mail_portal_format');this.approvalCache ||=new Map();const bytes=Buffer.byteLength(typeof item.result==='string'?item.result:'','utf8')+1024;if(this.approvalCache.size<100&&(this.approvalCacheBytes||0)+bytes<=8*1024*1024){this.approvalCache.set(key,item);this.approvalCacheBytes=(this.approvalCacheBytes||0)+bytes;}return item;
 }
 async approvalRead(args){
  if(!this.state.connected)throw Error('mail_portal_login');const epoch=this.epoch,item=await this.approvalItem(args);if(epoch!==this.epoch)throw Error('mail_cancelled');
  if(typeof item.result!=='string'||!item.result.trim()||item.result.length>10*1024*1024)throw Error('mail_portal_format');
  const bytes=[...item.result].some(char=>char.charCodeAt(0)>255)?Buffer.from(item.result,'utf8'):Buffer.from(item.result,'latin1');
  const parsed=await this.invoke('mail',{action:'portalDocument',raw:bytes.toString('base64')});if(epoch!==this.epoch)throw Error('mail_cancelled');return {id:args.id,subject:item.subject||parsed.mail.subject,...parsed};
 }
 async disconnect(){++this.epoch;this.access.abort();this.access=new AbortController();this.syncing=null;clearTimeout(this.timer);this.approvalCache?.clear();this.state={...this.state,connected:false,connecting:false,checking:false,loginStage:null,error:null,connectionState:'disconnected',nextRetryAt:null};this.restored=true;this.closeLoginPage();await this.invoke('mail',{action:'disconnect'});return this.status();}
 dispose(){++this.epoch;this.access.abort();clearTimeout(this.timer);this.closeLoginPage();this.window?.destroy();}
}
module.exports={MailPortal};
