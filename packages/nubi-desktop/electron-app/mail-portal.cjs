const {ORIGIN,LOGIN_URL,foldersOf,identityOf,portalFetchSource}=require('./mail-portal-contract.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class MailPortal {
 // Login happens in the app's own browser tab (openPage/closePage) when the host offers one; the hidden window only
 // runs the read-only portal fetches on the same persistent session (user request 2026-10-14: no separate popup).
 constructor({BrowserWindow,invoke,parent,openPage=null,closePage=null,getPageContents=null}){this.BrowserWindow=BrowserWindow;this.invoke=invoke;this.parent=parent;this.openPage=openPage;this.closePage=closePage;this.getPageContents=getPageContents;this.page=null;this.state={connected:false,connecting:false,checking:false,folders:[],error:null};this.epoch=0;}
 status(){return {...this.state};}
 async identify(){
  let identity;try{identity=identityOf(await this.read('identity'));}catch(error){if(!['mail_portal_identity','mail_portal_format','mail_portal_request','mail_portal_login'].includes(error.message))throw error;}
  const folders=foldersOf(await this.read('folders',{setCd:identity?.setCd||''}));
  if(!identity?.email||!identity?.userId){const sent=folders.find(folder=>folder.mailbox==='sent');if(sent){const list=await this.read('list',{folderId:sent.id,setCd:identity?.setCd||''});const row=list?.liteHeaderVOs?.[0];if(row&&/^\d{1,20}$/.test(String(row.mailSeq))){const summary=await this.read('summary',{folderId:sent.id,seq:String(row.mailSeq)}),from=summary?.from||{};const userId=identity?.userId||from.userID||from.epID;const email=identity?.email||(typeof from.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.email)?from.email:null);if(!identity&&(typeof userId==='string'||email))identity={id:typeof userId==='string'?userId:email,setCd:''};if(identity)identity={...identity,email,userId:typeof userId==='string'?userId:null};}}}
  if(!identity?.email){const inbox=folders.find(folder=>folder.mailbox==='inbox');if(inbox){const list=await this.read('list',{folderId:inbox.id,setCd:identity?.setCd||''}),row=list?.liteHeaderVOs?.[0];if(row&&/^\d{1,20}$/.test(String(row.mailSeq))){const message=await this.read('summary',{folderId:inbox.id,seq:String(row.mailSeq)}),received=message?.receivedAddress;
    const email=typeof received==='string'?received:received?.email||received?.address;if(typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){const recipients=[...(Array.isArray(message.toRecipients)?message.toRecipients:[]),...(Array.isArray(message.ccRecipients)?message.ccRecipients:[]),...(Array.isArray(message.bccRecipients)?message.bccRecipients:[])];const own=recipients.find(person=>(person?.email||person?.address||person?.emailAddress?.address||'').toLowerCase()===email.toLowerCase()),userId=identity?.userId||own?.userID||own?.epID;identity={...identity,id:identity?.id||email,email,userId:typeof userId==='string'?userId:null,setCd:identity?.setCd||''};}
   }}}
  if(!identity)throw Error('mail_portal_identity');identity={...identity,id:identity.userId||identity.email||identity.id};return {identity,folders};
 }
 async restore(){
  if(this.restored)return;this.restored=true;const epoch=this.epoch;
  try{await this.windowForLogin();const {identity,folders}=await this.identify();if(epoch!==this.epoch)return;
   await this.invoke('mail',{action:'portalConnect',identity:identity.id,email:identity.email,folders});if(epoch!==this.epoch)return;
   this.approvalCache=new Map();this.approvalCacheBytes=0;this.identity=identity;this.state={...this.state,connected:true,folders,error:null};void this.sync().catch(()=>{});
  }catch{} // Not logged in: show the login action, never force a browser popup.
 }
 async windowForLogin(show=false){
  if(!this.window||this.window.isDestroyed()){
   this.window=new this.BrowserWindow({parent:this.parent,width:1050,height:780,show:false,title:'누비 메일 로그인',webPreferences:{partition:'persist:nubi-company',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
   // The session is shared with the in-app company login tabs: their copy buttons need clipboard-sanitized-write.
   this.window.webContents.session.setPermissionRequestHandler((_contents,permission,reply)=>reply(permission==='clipboard-sanitized-write'));
   // The background reader must never start or replay an SSO popup as a GET.
   // Interactive authentication belongs to BrowserHost, which preserves POST/opener.
   this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   this.window.webContents.on('will-redirect',(event,url)=>{try{if(new URL(url).origin!==ORIGIN)event.preventDefault();}catch{event.preventDefault();}});
   this.window.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==ORIGIN)event.preventDefault();}catch{event.preventDefault();}});
   this.window.on('closed',()=>{this.window=null;this.epoch++;this.state={...this.state,connected:false,connecting:false,error:null};clearTimeout(this.timer);void this.invoke('mail',{action:'disconnect'}).catch(()=>{});});
  }
  if(show){
   if(!this.openPage)throw Error('mail_portal_desktop_only');
   this.window.webContents.stop?.();await this.window.loadURL('about:blank');
  }else await this.window.loadURL(ORIGIN);
  if(show&&this.openPage&&!this.page){const epoch=this.epoch;this.page=this.openPage(LOGIN_URL,{onClosed:()=>{if(this.page&&epoch===this.epoch){const closed=this.page;this.page=null;if(this.state.connecting)this.epoch++;try{this.closePage?.(closed.tabId);}catch{}}}});}
  return this.window;
 }
 closeLoginPage(){const page=this.page;this.page=null;if(page&&this.closePage){try{this.closePage(page.tabId);}catch{}}this.window?.hide();}
 async readContents(contents,operation,input={}){
  if(!contents||contents.isDestroyed?.())throw Error('mail_portal_login');
  try{return await contents.executeJavaScript(`(${portalFetchSource()})(${JSON.stringify({operation,...input})})`);}
  catch(error){throw Error(/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_portal_request');}
 }
 async read(operation,input={}){
  if(!this.window||this.window.isDestroyed())throw Error('mail_portal_login');
  if(this.page&&this.getPageContents){
   // Probe only the authenticated portal, never inject mail requests into the SSO provider.
   let failure;
   for(const contents of [...this.getPageContents(this.page.tabId)].reverse()){
    if(contents.isDestroyed()||contents.isLoadingMainFrame())continue;
    let portal=false;try{portal=new URL(contents.getURL()).origin===ORIGIN;}catch{}
    if(portal){try{return await this.readContents(contents,operation,input);}catch(error){if(!['mail_portal_login','mail_portal_request','mail_portal_format'].includes(error.message))throw error;failure=error;}}
   }
   throw failure||Error('mail_portal_login');
  }
  return this.readContents(this.window.webContents,operation,input);
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
 async connect(args={}){
  if(this.state.connecting||this.state.checking)throw Error('mail_busy');
  const epoch=++this.epoch;this.state={...this.state,connecting:true,error:null};
  try{
   await this.windowForLogin(true);let identity,folders;
   const deadline=Date.now()+5*60*1000;
   while(epoch===this.epoch&&Date.now()<deadline){
    try{({identity,folders}=await this.identify());break;}
    catch(error){if(await this.loginPageFailed())throw Error('mail_portal_sso');if(!['mail_portal_login','mail_portal_request','mail_portal_format'].includes(error.message))throw error;await wait(2000);}
   }
   if(epoch!==this.epoch)throw Error('mail_cancelled');if(!identity||!folders)throw Error('mail_portal_timeout');
   if(this.page&&this.getPageContents){
    // Start the background document only after interactive authentication succeeds.
    // Verify the shared session before closing the login tab or claiming a connection.
    await this.window.loadURL(ORIGIN);
    folders=foldersOf(await this.readContents(this.window.webContents,'folders',{setCd:identity.setCd}));
    if(epoch!==this.epoch)throw Error('mail_cancelled');
   }
   await this.invoke('mail',{action:'portalConnect',identity:identity.id,email:identity.email,folders,destination:args.destination});
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   this.approvalCache=new Map();this.approvalCacheBytes=0;this.identity=identity;this.state={connected:true,connecting:false,checking:false,folders,error:null};this.closeLoginPage();
   // Return after login; collection stays outside the UI's admission call.
   void this.sync().catch(()=>{});return this.status();
  }catch(error){this.closeLoginPage();if(epoch===this.epoch)this.state={...this.state,connecting:false,connected:false,error:/^mail_/.test(error.message)?error.message:'mail_portal_request'};throw Error(epoch!==this.epoch?'mail_cancelled':this.state.error);}
 }
 sync(input={}){
  if(this.syncing)return this.syncing;
  const pending=this.syncNow(input);this.syncing=pending;
  void pending.finally(()=>{if(this.syncing===pending)this.syncing=null;}).catch(()=>{});
  return pending;
 }
 async syncNow({manual=false}={}){
  if(!this.state.connected)throw Error('mail_portal_login');if(this.state.checking)return this.status();
  const epoch=this.epoch;const settings=await this.invoke('mail',{action:'status'});if(epoch!==this.epoch)throw Error('mail_cancelled');if(settings?.watchPaused&&!manual)return this.status();clearTimeout(this.timer);this.state={...this.state,checking:true,error:null,completed:0,total:null};
  try{
   const folders=foldersOf(await this.read('folders',{setCd:this.identity.setCd}));this.state.folders=folders;
   await this.invoke('mail',{action:'portalFolders',folders});
   const known=new Set((await this.invoke('mail',{action:'portalKnown'})).uids);
   let completed=0,discovered=0;
   for(const folder of folders){let cursor=0;const seen=new Set();
    for(let page=0;page<200;page++){
     if(epoch!==this.epoch)throw Error('mail_cancelled');
     const result=await this.read('list',{folderId:folder.id,cursor,setCd:this.identity.setCd});if(!Array.isArray(result?.liteHeaderVOs))throw Error('mail_portal_format');
     const fresh=result.liteHeaderVOs.filter(item=>!seen.has(String(item.mailSeq)));
     if(!fresh.length)break;
     for(const item of fresh){const seq=String(item.mailSeq);if(!/^\d{1,20}$/.test(seq))throw Error('mail_portal_format');seen.add(seq);const uid=`portal:${folder.id}:${seq}`;discovered++;
      if(known.has(uid))continue;if(epoch!==this.epoch)throw Error('mail_cancelled');
      try{const metadata={...item,...await this.read('summary',{folderId:folder.id,seq})};const packet=await this.read('eml',{folderId:folder.id,seq});if(epoch!==this.epoch)throw Error('mail_cancelled');await this.invoke('mail',{action:'portalImport',uid,raw:packet.raw,size:packet.size,folder,metadata});known.add(uid);completed++;}
      catch(error){if(epoch!==this.epoch||['mail_portal_login','mail_cancelled','mail_portal_request','mail_portal_timeout'].includes(error.message))throw error;await this.invoke('mail',{action:'portalRejected',uid,error:error.message});}
      this.state={...this.state,completed,total:folders.reduce((sum,f)=>sum+(f.total||0),0)||null};
     }
     const next=Number(fresh.at(-1).mailSeq);if(!Number.isSafeInteger(next)||next===cursor)break;cursor=next;
     if(folder.total!==null&&seen.size>=folder.total)break;if(page===199)throw Error('mail_portal_page_limit');
    }
   }
   if(epoch!==this.epoch)throw Error('mail_cancelled');this.state={...this.state,checking:false,lastCheckedAt:new Date().toISOString(),discovered};
   this.timer=setTimeout(()=>void this.sync().catch(()=>{}),5*60*1000);this.timer.unref?.();return this.status();
  }catch(error){if(epoch===this.epoch)this.state={...this.state,checking:false,error:/^mail_/.test(error.message)?error.message:'mail_portal_request',connected:error.message==='mail_portal_login'?false:this.state.connected};if(epoch===this.epoch&&this.state.connected){this.timer=setTimeout(()=>void this.sync().catch(()=>{}),5*60*1000);this.timer.unref?.();}if(error.message==='mail_portal_login')await this.invoke('mail',{action:'disconnect'}).catch(()=>{});throw error;}
 }
 async approvals({page=1}={}){
  if(!this.state.connected)throw Error('mail_portal_login');if(!this.identity?.userId)throw Error('mail_portal_identity');if(!Number.isSafeInteger(page)||page<1||page>10000)throw Error('mail_input_invalid');
  const epoch=this.epoch,result=await this.read('approvals',{page,userId:this.identity.userId});if(!Array.isArray(result?.data))throw Error('mail_portal_format');
  this.approvalCache=new Map();this.approvalCacheBytes=0;const rows=result.data.slice(0,100).map(item=>({id:String(item.apId),lineId:String(item.aplnId),subject:String(item.subject||item.apTitle||'').slice(0,1000),submittedAt:item.sbmDt||null,completedAt:item.cplDt||null,status:String(item.apActStatsCd||'').slice(0,60)}));
  let next=0;await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{while(next<rows.length){const row=rows[next++];if(epoch!==this.epoch)throw Error('mail_cancelled');try{const item=await this.approvalItem(row);row.subject=String(item.subject||row.subject||'(제목 없음)').slice(0,1000);}catch(error){row.subject=row.subject||'(제목 확인 필요)';row.error=error.message;}}}));
  if(epoch!==this.epoch)throw Error('mail_cancelled');this.approvalPageSize=Math.max(this.approvalPageSize||0,rows.length);const total=Number.isSafeInteger(result.totalCount)?result.totalCount:rows.length;return {page,total,hasNext:rows.length>0&&page*this.approvalPageSize<total,items:rows};
 }
 async approvalItem({id,lineId}){
  if(!/^[\w-]{1,100}$/.test(id)||!/^[\w-]{1,100}$/.test(lineId))throw Error('mail_input_invalid');
  const key=id+'|'+lineId;if(this.approvalCache?.has(key))return this.approvalCache.get(key);
  const epoch=this.epoch,result=await this.read('approvalItem',{ap:id,ln:lineId});if(epoch!==this.epoch)throw Error('mail_cancelled');
  const item=result?.[0];if(!item||typeof item!=='object')throw Error('mail_portal_format');this.approvalCache ||=new Map();const bytes=Buffer.byteLength(typeof item.result==='string'?item.result:'','utf8')+1024;if(this.approvalCache.size<100&&(this.approvalCacheBytes||0)+bytes<=8*1024*1024){this.approvalCache.set(key,item);this.approvalCacheBytes=(this.approvalCacheBytes||0)+bytes;}return item;
 }
 async approvalRead(args){
  if(!this.state.connected)throw Error('mail_portal_login');const item=await this.approvalItem(args);
  if(typeof item.result!=='string'||!item.result.trim()||item.result.length>10*1024*1024)throw Error('mail_portal_format');
  const bytes=[...item.result].some(char=>char.charCodeAt(0)>255)?Buffer.from(item.result,'utf8'):Buffer.from(item.result,'latin1');
  const epoch=this.epoch,parsed=await this.invoke('mail',{action:'portalDocument',raw:bytes.toString('base64')});if(epoch!==this.epoch)throw Error('mail_cancelled');return {id:args.id,subject:item.subject||parsed.mail.subject,...parsed};
 }
 async disconnect(){++this.epoch;this.syncing=null;clearTimeout(this.timer);this.approvalCache?.clear();this.state={...this.state,connected:false,connecting:false,checking:false,error:null};this.closeLoginPage();await this.invoke('mail',{action:'disconnect'});return this.status();}
 dispose(){++this.epoch;clearTimeout(this.timer);this.closeLoginPage();this.window?.destroy();}
}
module.exports={MailPortal};
