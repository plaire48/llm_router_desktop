const {MailPortal}=require('./mail-portal.cjs');
const {ORIGIN,LOGIN_URL,portalOrigin}=require('./mail-portal-contract.cjs');
const {approvalFailure}=require('./approval-failure.cjs');
const {loginRedirect}=require('./mail-session-recovery.cjs');

// Reuses the existing importer, collection scheduler, identity projection,
// deduplication, encrypted storage and approvals reader. Only the read transport
// changes. Browser credentials never leave the original browser.
class ExternalMailPortal extends MailPortal {
 constructor(options){super(options);this.browser=options.browser;this.binding=null;this.restored=true;}
 status(){return {...super.status(),browser:'external',sessionShared:!!this.binding};}
 restore(){return undefined;}
 async read(operation,input={}){
  if(!this.binding||this.binding.generation!==this.browser.generation)throw Error('mail_portal_login');
  const epoch=this.epoch,binding=this.binding;if(this.access.signal.aborted)throw Error('mail_cancelled');
  const result=await this.browser.command('portalRead',{tabId:binding.tabId,origin:binding.origin,input:{...input,operation,reportFailure:['approvals','approvalItem'].includes(operation)}});
  if(epoch!==this.epoch||this.binding!==binding||binding.generation!==this.browser.generation)throw Error('mail_cancelled');
  if(result?.__nubiPortalError)throw approvalFailure({message:result.__nubiPortalError,httpStatus:result.httpStatus},operation==='approvals'?'list':'document');return result;
 }
 readSession(operation,input){return this.read(operation,input);}
 async connect(args={}){
  if(this.state.connecting||this.state.checking)throw Error('mail_busy');
  if(!this.browser.status().connected)throw Error('external_browser_connection_required');
  const epoch=++this.epoch;this.access.abort();this.access=new AbortController();clearTimeout(this.timer);this.state={...this.state,connected:false,connecting:true,loginStage:'authenticating',error:null};
  try{
   let rows=await this.browser.command('tabs'),selected=rows.find(row=>row.active)||rows.find(row=>String(row.id)===this.browser.active),tabId;
   if(selected&&portalOrigin(selected.url))tabId=String(selected.id);
   else tabId=(await this.browser.openPage(LOGIN_URL)).tabId;
   const generation=this.browser.generation;let deadline=Date.now()+5*60*1000,identity,folders;
   while(true){
    if(epoch!==this.epoch||generation!==this.browser.generation)throw Error('mail_cancelled');
    rows=await this.browser.command('tabs');selected=rows.find(row=>String(row.id)===tabId);
    const origin=selected&&portalOrigin(selected.url),authenticating=selected&&(selected.protected||loginRedirect(new URL(selected.url),LOGIN_URL));
    if(authenticating)deadline=Date.now()+5*60*1000;
    if(origin&&!authenticating){
     try{const bound=await this.browser.command('portalBind',{tabId,origin:ORIGIN});this.binding={...bound,generation};this.state.loginStage='verifying';({identity,folders}=await this.identify(epoch));break;}
     catch(error){if(!['mail_portal_login','mail_portal_forbidden','mail_portal_request','mail_portal_format','mail_portal_redirect'].includes(error.message))throw error;this.state.loginStage='authenticating';}
    }
    if(!selected||Date.now()>=deadline)throw Error('mail_portal_login');
    await new Promise(resolve=>setTimeout(resolve,500));
   }
   if(epoch!==this.epoch||generation!==this.browser.generation)throw Error('mail_cancelled');
   await this.invoke('mail',{action:'portalConnect',identity:identity.id,email:identity.email,folders,destination:args.destination});
   if(epoch!==this.epoch)throw Error('mail_cancelled');
   this.approvalCache=new Map();this.approvalCacheBytes=0;this.approvalPending=new Map();this.identity=identity;this.state={...this.state,connected:true,connecting:false,loginStage:'connected',folders,error:null,connectionState:'connected'};
   void this.sync().catch(()=>{});return this.status();
  }catch(error){if(epoch===this.epoch){this.binding=null;this.state={...this.state,connected:false,connecting:false,loginStage:null,error:/^(?:mail|external_browser)_/.test(error.message)?error.message:'mail_portal_request'};}throw Error(epoch!==this.epoch?'mail_cancelled':this.state.error);}
 }
 async sessionReady(){return this.state.connected?this.status():{...this.status(),requiresLogin:true};}
 async clearPortalSession(){this.binding=null;}
 async disconnect(){this.binding=null;return super.disconnect();}
}
module.exports={ExternalMailPortal};
