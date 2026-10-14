const {randomUUID}=require('node:crypto');
const {connectTab}=require('./playwright-tab.cjs');
class PlaywrightHost{
 constructor(browserHost){this.host=browserHost;this.connections=new Map();}
 row(tabId){if(typeof tabId!=='string'||!tabId)throw Error('browser_tab_required');const row=this.host.tab(tabId);const url=new URL(row.view.webContents.getURL()||'about:blank');if(/(?:^|[&#])(code|token|access_token|id_token|refresh_token)=/i.test(url.hash))throw Error('browser_auth_protected');if([...url.searchParams.keys()].some(key=>/^(code|token|access_token|id_token|refresh_token)$/i.test(key)))throw Error('browser_auth_protected');if(row.authentication||row.companyLogin||row.session)throw Error('browser_auth_protected');if(!row.automationDocument){row.automationDocument=randomUUID();row.view.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMain)=>{if(isMain)row.automationDocument=randomUUID();});}return row;}
 async request(action,args={}){
  if(action==='tabs')return {tabs:[...this.host.tabs.values()].filter(row=>!row.authentication&&!row.companyLogin&&!row.session&&!row.view.webContents.isDestroyed()).filter(row=>{try{this.row(row.id);return true;}catch{return false;}}).map(row=>({tabId:row.id,documentId:this.row(row.id).automationDocument,title:row.title,url:row.url,active:this.host.active===row.id}))};
  if(action==='open'){if(typeof args.url!=='string'||!/^https?:\/\//.test(args.url))throw Error('browser_url_invalid');const row=this.host.create(args.url);this.host.publish('opened');return {tabId:row.id,documentId:this.row(row.id).automationDocument};}
  const row=this.row(args.tabId);
  if(args.documentId&&args.documentId!==row.automationDocument)throw Error('browser_document_changed');
  if(action==='capture'){const shot=await this.host.capture(row.id,{clip:args.clip,maxWidth:args.maxWidth});if(args.documentId&&args.documentId!==row.automationDocument)throw Error('browser_document_changed');return {...shot,documentId:row.automationDocument};}
  if(action==='check')return {tabId:row.id,documentId:row.automationDocument};
  if(action!=='attach')throw Error('browser_action_invalid');
  const previous=this.connections.get(row.id);if(previous&&(await previous).closed)this.connections.delete(row.id);
  if(!this.connections.has(row.id)){
   const pending=connectTab(row).catch(error=>{this.connections.delete(row.id);throw error;});this.connections.set(row.id,pending);
   row.view.webContents.once('destroyed',()=>{this.connections.delete(row.id);});
  }
  return {endpoint:(await this.connections.get(row.id)).endpoint};
 }
 dispose(){for(const entry of this.connections.values())void entry.then(value=>value.close()).catch(()=>{});this.connections.clear();}
}
module.exports={PlaywrightHost};
