const {approvalStep,approvalFailure}=require('./approval-failure.cjs');
const {mailDialogPending,mailDialogGuide}=require('./mail-session-dialog.cjs');
const {loginRedirect}=require('./mail-session-recovery.cjs');
const {mailSessionFetch}=require('./mail-session-fetch.cjs');
const {readMailPage}=require('./mail-page-execution.cjs');
const {ORIGIN,LOGIN_URL,portalOrigin,foldersOf,identityOf,portalFetch,portalFetchSource}=require('./mail-portal-contract.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MAIL_POLL_INTERVAL_MS=5*60*1000;
// Portal login waits as in 1.2.9 (사용자 지시 2026-10-23): the person signs in and answers the portal's own dialogs (확인 or
// X) while the app waits quietly. Five minutes after the login started it stops with 연결이 안 됐습니다 and never retries on
// its own; the person starts another login (사용자 지시 2026-10-21: 알아서 여러 번 하지 말 것).
const LOGIN_DEADLINE_MS=5*60*1000;
const loginLocation=value=>{try{return loginRedirect(new URL(value),LOGIN_URL);}catch{return false;}};
const homeLocation=value=>{try{const url=new URL(value),home=new URL(LOGIN_URL);return !url.username&&!url.password&&url.hostname===home.hostname&&url.port===home.port&&(url.origin===home.origin||home.protocol==='http:'&&url.protocol==='https:')&&!loginLocation(value);}catch{return false;}};
class MailPortal {
 // Login happens in the app's own browser tab (openPage/closePage) when the host offers one; the hidden window only
 // runs the read-only portal fetches on the same persistent session (user request 2026-10-14: no separate popup).
 constructor({BrowserWindow,invoke,parent,openPage=null,closePage=null,getPageContents=null,fetchSession=mailSessionFetch,onDisconnected=()=>{}}){this.onDisconnected=onDisconnected;this.fetchSession=fetchSession;this.BrowserWindow=BrowserWindow;this.invoke=invoke;this.parent=parent;this.openPage=openPage;this.closePage=closePage;this.getPageContents=getPageContents;this.page=null;this.state={connected:false,connecting:false,checking:false,folders:[],error:null};this.epoch=0;this.origin=ORIGIN;this.access=new AbortController();}
 status(){return {...this.state,fallback:this.state.fallback??null};}
 async identify(epoch=this.epoch){
  const read=async(...args)=>{if(epoch!==this.epoch)throw Error('mail_cancelled');const result=await this.read(...args);if(epoch!==this.epoch)throw Error('mail_cancelled');return result;};
  // Match the supplied userscript: portal session identity wins over the mail account ID.
  // Independent read-only probes run together; three slow fallbacks must not add up serially.
  const profiles=await Promise.allSettled(['identityPortal','identity','identityPolicy'].map(async operation=>identityOf(await read(operation))));
  if(epoch!==this.epoch)throw Error('mail_cancelled');
  const mail=profiles[1].status==='fulfilled'?profiles[1].value:null;
  if(profiles[1].status==='rejected'&&!['mail_portal_identity','mail_portal_format','mail_portal_request','mail_portal_login'].includes(profiles[1].reason.message))throw profiles[1].reason;
  let identity=mail;
  for(const profile of profiles.filter(result=>result.status==='fulfilled').map(result=>result.value)){
   if(mail?.email&&profile.email&&mail.email.toLowerCase()!==profile.email.toLowerCase())continue;
   if(!identity||profile.userId){identity={...profile,email:mail?.email||profile.email,setCd:mail?.setCd||profile.setCd||''};if(profile.userId)break;}
  }
  const folders=foldersOf(await read('folders',{setCd:identity?.setCd||''}));
  if(!identity?.email||!identity?.userId){
   const sent=folders.find(folder=>folder.mailbox==='sent')||folders.find(folder=>folder.id==='2'&&folder.mailbox==='other');
   if(sent){const list=await read('list',{folderId:sent.id,setCd:identity?.setCd||''}),row=list?.liteHeaderVOs?.[0];
    if(row&&/^\d{1,20}$/.test(String(row.mailSeq))){const summary=await read('summary',{folderId:sent.id,seq:String(row.mailSeq)});let from;try{from=identityOf(summary?.from);}catch{}
     if(from&&(!identity?.email||!from.email||identity.email.toLowerCase()===from.email.toLowerCase()))identity={...identity,id:identity?.id||from.id,email:identity?.email||from.email,userId:identity?.userId||from.userId,setCd:identity?.setCd||''};
    }
   }
  }
  if(!identity?.email||!identity?.userId){const inbox=folders.find(folder=>folder.mailbox==='inbox');if(inbox){const list=await read('list',{folderId:inbox.id,setCd:identity?.setCd||''}),row=list?.liteHeaderVOs?.[0];if(row&&/^\d{1,20}$/.test(String(row.mailSeq))){const message=await read('summary',{folderId:inbox.id,seq:String(row.mailSeq)}),received=message?.receivedAddress;
    const email=typeof received==='string'?received:received?.email||received?.address;if(typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&(!identity?.email||identity.email.toLowerCase()===email.toLowerCase())){const recipients=[...(Array.isArray(message.toRecipients)?message.toRecipients:[]),...(Array.isArray(message.ccRecipients)?message.ccRecipients:[]),...(Array.isArray(message.bccRecipients)?message.bccRecipients:[])];const own=recipients.find(person=>(person?.email||person?.address||person?.emailAddress?.address||'').toLowerCase()===email.toLowerCase()),userId=identity?.userId||own?.userID||own?.epID;identity={...identity,id:identity?.id||email,email,userId:typeof userId==='string'?userId.trim():Number.isSafeInteger(userId)?String(userId):null,setCd:identity?.setCd||''};}
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
   this.approvalCache=new Map();this.approvalCacheBytes=0;this.approvalPending=new Map();this.identity=identity;this.state={...this.state,connected:true,folders,error:null,connectionState:'connected',nextRetryAt:null};void this.sync().catch(()=>{});
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
  if(show&&this.openPage&&!this.page){this.page=this.openPage(LOGIN_URL,{mailLogin:true,onClosed:()=>{if(this.page&&epoch===this.epoch)void this.disconnect().catch(()=>{});}});}
  return this.window;
 }
 closeLoginPage(){const page=this.page;this.page=null;if(page&&this.closePage){try{this.closePage(page.tabId);}catch{}}this.window?.hide();}
 async readContents(contents,operation,input={}){
  if(!contents||contents.isDestroyed?.()||mailDialogPending(contents))throw Error('mail_portal_login');
  const origin=portalOrigin(contents.getURL(),this.origin);if(!origin||loginLocation(contents.getURL()))throw Error('mail_portal_login');this.origin=origin;
  try{const result=await readMailPage(contents,`(${portalFetchSource(origin)})(${JSON.stringify({...input,operation,reportFailure:['approvals','approvalItem'].includes(operation)})})`,{signal:this.access.signal});if(result?.__nubiPortalError)throw approvalFailure({message:result.__nubiPortalError,httpStatus:result.httpStatus},operation==='approvals'?'list':'document');return result;}
  catch(error){if(error.approvalFailure)throw error;throw Error(/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_portal_request');}
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
   if(rows.some(contents=>contents.isLoadingMainFrame()||mailDialogPending(contents))||(active&&(!portalOrigin(active.getURL(),this.origin)&&!homeLocation(active.getURL())||loginLocation(active.getURL()))))throw Error('mail_portal_login');
   for(const contents of rows.reverse()){
    if(contents.isDestroyed()||contents.isLoadingMainFrame()||mailDialogPending(contents))continue;
    const portal=portalOrigin(contents.getURL(),this.origin);
    if(portal){try{return await this.readContents(contents,operation,input);}catch(error){if(error.approvalFailure||!['mail_portal_login','mail_portal_request','mail_portal_format'].includes(error.message))throw error;}}
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
   if(contents.isDestroyed()||contents.isLoadingMainFrame()||mailDialogPending(contents))continue;
   // Return only a fixed boolean. Never collect the URL, login fields or page body.
   try{if(await readMailPage(contents,`(()=>{const text=(document.body?.innerText||'').slice(0,8000);return /Whitelabel Error Page/i.test(text)&&/no explicit mapping for \\/error/i.test(text);})()`,{signal:this.access.signal,timeout:2000}))return true;}catch{}
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
   await this.windowForLogin(true,epoch);this.state.loginStage='authenticating';let identity,folders;
   const deadline=Date.now()+(this.loginDeadlineMs??LOGIN_DEADLINE_MS);let authFailures=0;
   while(epoch===this.epoch){
    if(Date.now()>=deadline)throw Error('mail_portal_login_timeout');
    const loginContents=()=>this.page&&this.getPageContents?this.getPageContents(this.page.tabId):[];
    const rows=loginContents();
    if(rows.some(mailDialogPending)){
     this.state.loginStage=rows.some(contents=>mailDialogGuide(contents)==='advancing')?'advancing':'confirmation';
     await wait(250);
     continue;
    }
    if(epoch!==this.epoch)break;
    // Credentials and confirmation are human input, not network inactivity.
    const active=rows.filter(contents=>!contents.isDestroyed()).at(-1);
    if(active&&loginLocation(active.getURL())){
     this.state.loginStage='authenticating';
     await wait(250);continue;
    }
    this.state.loginStage='authenticating';
    try{
     ({identity,folders}=await this.identify(epoch));
     if(loginContents().some(mailDialogPending))continue;
     if(this.page&&this.getPageContents){
      // Both the visible portal and the shared session must be authenticated.
      // Propagation delays belong to the same login attempt, not a fatal close.
      this.state.loginStage='verifying';
      folders=foldersOf(await this.readSession('folders',{setCd:identity.setCd}));
      if(epoch!==this.epoch)throw Error('mail_cancelled');
      if(loginContents().some(mailDialogPending))continue;
     }
     break;
    }
    catch(error){
     if(loginContents().some(mailDialogPending)){await wait(250);continue;}
     if(await this.loginPageFailed())throw Error('mail_portal_sso');
     // A dialog may have opened while the read-only error-page check awaited.
     if(loginContents().some(mailDialogPending)){await wait(250);continue;}
     if(!['mail_portal_login','mail_portal_forbidden','mail_portal_request','mail_portal_format','mail_portal_redirect'].includes(error.message))throw error;
     if(epoch!==this.epoch)break;
     // Not signed in yet: keep waiting for the person, checking less often (up to every 10 seconds) until the deadline.
     const authenticationPending=['mail_portal_login','mail_portal_forbidden'].includes(error.message);
     if(authenticationPending){this.state.loginStage='authenticating';authFailures++;}
     const pause=authenticationPending?Math.min(10000,2000*authFailures):2000;
     // Slow down unauthenticated probes, but react promptly to navigation,
     // native alerts and explicit cancellation instead of sleeping uninterruptibly.
     for(let elapsed=0;elapsed<pause&&epoch===this.epoch&&Date.now()<deadline;elapsed+=250){
      await wait(250);
      const current=loginContents();
      if(current.some(mailDialogPending)||current.some(contents=>contents.isLoadingMainFrame?.()))break;
     }
    }
   }
   if(epoch!==this.epoch)throw Error('mail_cancelled');if(!identity||!folders)throw Error('mail_portal_login_timeout');
   await this.invoke('mail',{action:'portalConnect',identity:identity.id,email:identity.email,folders,destination:args.destination});
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   this.approvalCache=new Map();this.approvalCacheBytes=0;this.approvalPending=new Map();this.identity=identity;this.state={connected:true,connecting:false,checking:false,loginStage:'connected',folders,error:null,connectionState:'connected',nextRetryAt:null,fallback:null};this.closeLoginPage();
   // Return after login; collection stays outside the UI's admission call.
   void this.sync().catch(()=>{});return this.status();
  }catch(error){if(epoch===this.epoch){this.closeLoginPage();this.state={...this.state,connecting:false,connected:false,loginStage:null,error:/^mail_/.test(error.message)?error.message:'mail_portal_request',fallback:error.message==='mail_cancelled'?null:'pop3'};}throw Error(epoch!==this.epoch?'mail_cancelled':this.state.error);}
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
   this.state={...this.state,error:failure,connectionState:'authentication_required',failureCode:code,fallback:'pop3'};
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
  return approvalStep('list',async()=>{
   if(!this.state.connected)throw approvalFailure(Error('mail_portal_login'),'identity');
   if(!this.identity?.userId){
    const current=this.epoch;const previous=this.identity;
    const result=await approvalStep('identity',()=>this.identify(current));
    if(current!==this.epoch)throw Error('mail_cancelled');
    if(previous?.email&&result.identity.email&&previous.email.toLowerCase()!==result.identity.email.toLowerCase())throw approvalFailure(Error('mail_portal_identity'),'identity');
    this.identity=result.identity;
    if(!this.identity.userId)throw approvalFailure(Error('mail_portal_identity'),'identity');
   }
   if(!Number.isSafeInteger(page)||page<1||page>10000)throw Error('mail_input_invalid');
   const epoch=this.epoch;let result;
   try{result=await this.read('approvals',{page,userId:this.identity.userId});}catch(error){if(error.message==='mail_portal_login'){await this.failSession(error,epoch);const failure=approvalFailure(error,'list');failure.message='mail_portal_approval_login';failure.approvalFailure.code=failure.message;throw failure;}throw error;}
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   if(!Array.isArray(result?.data))throw Error('mail_portal_format');
   const rows=result.data.map(item=>{
    const id=String(item?.apId??''),lineId=String(item?.aplnId??'');
    if(!/^[\w-]{1,100}$/.test(id)||!/^[\w-]{1,100}$/.test(lineId))throw Error('mail_portal_format');
    return {id,lineId,subject:String(item.subject||item.apTitle||'').slice(0,1000),submittedAt:item.sbmDt||null,completedAt:item.cplDt||null,status:String(item.apActStatsCd||'').slice(0,60)};
   });
   // Reset this page's cache; titles and body share the same read-only item request.
   this.approvalCache=new Map();this.approvalCacheBytes=0;this.approvalPending=new Map();
   for(const row of rows){row.titlePending=!row.subject;if(!row.subject)row.subject='결재 문서';}
   const total=typeof result.totalCount==='string'&&/^\d+$/.test(result.totalCount)?Number(result.totalCount):result.totalCount;
   if(total!==undefined&&(!Number.isSafeInteger(total)||total<0))throw Error('mail_portal_format');
   this.approvalPageSize=Math.max(this.approvalPageSize||0,rows.length);
   return {page,total:total??rows.length,hasNext:rows.length>0&&page*this.approvalPageSize<(total??rows.length),items:rows};
  });
 }
 async approvalTitle({id,lineId}){
  const item=await this.approvalItem({id,lineId});
  return {id,lineId,subject:String(item.subject||'(제목 없음)').slice(0,1000)};
 }
 async approvalItem({id,lineId}){
  return approvalStep('document',async()=>{
   if(!this.state.connected)throw Error('mail_portal_login');
   if(!/^[\w-]{1,100}$/.test(id)||!/^[\w-]{1,100}$/.test(lineId))throw Error('mail_input_invalid');
   const key=id+'|'+lineId;if(this.approvalCache?.has(key))return this.approvalCache.get(key);
   this.approvalPending ||=new Map();const pending=this.approvalPending;
   if(pending.has(key))return pending.get(key);
   this.approvalCache ||=new Map();const cache=this.approvalCache,epoch=this.epoch;
   const request=(async()=>{
    let result;try{result=await this.read('approvalItem',{ap:id,ln:lineId});}catch(error){if(error.message==='mail_portal_login')await this.failSession(error,epoch);throw error;}
    if(epoch!==this.epoch)throw Error('mail_cancelled');
    if(!Array.isArray(result)||result.length!==1||!result[0]||typeof result[0]!=='object'||Array.isArray(result[0]))throw Error('mail_portal_format');
    const item=result[0],bytes=Buffer.byteLength(typeof item.result==='string'?item.result:'','utf8')+1024;
    if(this.approvalCache===cache&&typeof item.result==='string'&&item.result.trim()&&cache.size<100&&(this.approvalCacheBytes||0)+bytes<=8*1024*1024){cache.set(key,item);this.approvalCacheBytes=(this.approvalCacheBytes||0)+bytes;}
    return item;
   })();pending.set(key,request);
   try{return await request;}finally{if(pending.get(key)===request)pending.delete(key);}
  });
 }
 async approvalRead(args){
  const epoch=this.epoch,item=await this.approvalItem(args);
  return approvalStep('parse',async()=>{
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   if(typeof item.result!=='string')throw Error('mail_portal_format');
   if(!item.result.trim())throw Error('mail_approval_empty');
   if(item.result.length>10*1024*1024)throw Error('mail_size_limit');
   // Same byte reconstruction as the supplied userscript's strToBytes.
   let encoding='latin1';for(let i=0;i<item.result.length;i++){if(item.result.charCodeAt(i)>255){encoding='utf8';break;}}
   const bytes=Buffer.from(item.result,encoding);
   const parsed=await this.invoke('mail',{action:'portalDocument',raw:bytes.toString('base64')});
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   if(!parsed?.mail||typeof parsed.mail.text!=='string')throw Error('mail_approval_parse');
   return {...parsed,id:args.id,lineId:args.lineId,subject:item.subject||parsed.mail.subject};
  }).catch(error=>{this.approvalCache?.delete(args.id+'|'+args.lineId);throw error;});
 }
 async disconnect(){++this.epoch;this.access.abort();this.access=new AbortController();this.syncing=null;clearTimeout(this.timer);this.approvalCache?.clear();this.state={...this.state,connected:false,connecting:false,checking:false,loginStage:null,error:null,connectionState:'disconnected',nextRetryAt:null};this.restored=true;this.closeLoginPage();await this.invoke('mail',{action:'disconnect'});return this.status();}
 dispose(){++this.epoch;this.access.abort();clearTimeout(this.timer);this.closeLoginPage();this.window?.destroy();}
}
module.exports={MailPortal};
