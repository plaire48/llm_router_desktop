const {randomUUID}=require('node:crypto');
const {connectTab}=require('./playwright-tab.cjs');
const {httpBrowserAddress}=require('../runtime/browser-address.cjs');
const {isSamlAddress}=require('./browser-auth-flow.cjs');
// A page in the middle of sign-in, or carrying a code or token, is never automated.
const protectedAddress=href=>{let url;try{url=new URL(href||'about:blank');}catch{return true;}return isSamlAddress(url.href)||/(?:^|[&#])(code|token|access_token|id_token|refresh_token)=/i.test(url.hash)||[...url.searchParams.keys()].some(key=>/^(code|token|access_token|id_token|refresh_token)$/i.test(key));};
// browser_open returns once the document is ready (at most 5s), so the first snapshot is not of an empty page.
const domReady=(contents,limit)=>new Promise(resolve=>{if(contents.isDestroyed()||!contents.isLoadingMainFrame()){resolve();return;}const timer=setTimeout(done,limit);function done(){clearTimeout(timer);contents.removeListener('dom-ready',done);contents.removeListener('did-fail-load',done);resolve();}contents.once('dom-ready',done);contents.once('did-fail-load',done);});
class PlaywrightHost{
 constructor(browserHost){this.host=browserHost;this.connections=new Map();this.knowledgeSessions=new Map();}
 row(tabId){if(typeof tabId!=='string'||!tabId)throw Error('browser_tab_required');const row=this.host.tab(tabId);const url=new URL(row.view.webContents.getURL()||'about:blank');if(protectedAddress(url.href)||row.authFlow?.active&&!row.authFlow.settled)throw Error('browser_auth_protected');if(row.authentication||row.companyLogin||row.session)throw Error('browser_auth_protected');if(!row.automationDocument){row.automationDocument=randomUUID();row.view.webContents.on('did-start-navigation',(_event,_url,inPlace,isMain)=>{if(isMain&&!inPlace)row.automationDocument=randomUUID();});}return row;}
 knowledgeScope(contents){const session=contents.session;if(!session?.cookies?.on)return undefined;let scope=this.knowledgeSessions.get(session);if(!scope){scope={id:randomUUID(),changed:()=>{scope.id=randomUUID();}};session.cookies.on('changed',scope.changed);this.knowledgeSessions.set(session,scope);}return scope.id;}
 async request(action,args={}){
  if(!['tabs','open','capture','check','release','attach'].includes(action))throw Error('browser_action_invalid');
  if(action==='tabs')return {tabs:[...this.host.tabs.values()].filter(row=>!row.authentication&&!row.companyLogin&&!row.session&&!row.view.webContents.isDestroyed()).filter(row=>{try{this.row(row.id);return true;}catch{return false;}}).map(row=>({tabId:row.id,documentId:this.row(row.id).automationDocument,title:row.title,url:row.url,active:this.host.active===row.id}))};
  if(action==='open'){const row=this.host.create(httpBrowserAddress(args.url));this.host.publish('opened');await domReady(row.view.webContents,5000);if(row.error)throw Error(row.error);return {tabId:row.id,documentId:this.row(row.id).automationDocument};}
  const row=this.row(args.tabId);
  if(args.documentId&&args.documentId!==row.automationDocument)throw Error('browser_document_changed');
  if(action==='capture'){const shot=await this.host.capture(row.id,{clip:args.clip,maxWidth:args.maxWidth});if(args.documentId&&args.documentId!==row.automationDocument)throw Error('browser_document_changed');return {...shot,documentId:row.automationDocument};}
  if(action==='check')return {tabId:row.id,documentId:row.automationDocument,knowledgeScope:this.knowledgeScope(row.view.webContents),origin:new URL(row.view.webContents.getURL()||'about:blank').origin};
  if(action==='release'){const pending=this.connections.get(row.id);const entry=await pending;if(entry&&entry.endpoint===args.endpoint){entry.close();if(this.connections.get(row.id)===pending)this.connections.delete(row.id);}return {released:true};}
  if(action!=='attach')throw Error('browser_action_invalid');
  const previous=this.connections.get(row.id);if(previous&&(await previous).closed)this.connections.delete(row.id);
  if(!this.connections.has(row.id)){
   const pending=connectTab(row).catch(error=>{if(this.connections.get(row.id)===pending)this.connections.delete(row.id);throw error;});this.connections.set(row.id,pending);
   row.view.webContents.once('destroyed',()=>{this.connections.delete(row.id);});
  }
  return {endpoint:(await this.connections.get(row.id)).endpoint};
 }
 dispose(){for(const [session,scope] of this.knowledgeSessions)session.cookies.removeListener('changed',scope.changed);this.knowledgeSessions.clear();for(const entry of this.connections.values())void entry.then(value=>value.close()).catch(()=>{});this.connections.clear();}
}
module.exports={PlaywrightHost};
