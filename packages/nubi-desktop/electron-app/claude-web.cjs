// Claude usage as the person sees it on claude.ai: the user signs in (SSO) inside the app browser tab, and the
// organizations and usage endpoints are read with that session from a hidden window on the same partition.
// Nothing is copied out of the session: no cookie, no token (user decision 2026-10-14; the endpoint is claude.ai's
// own web API and may change).
const ORIGIN='https://claude.ai';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function webRead(input){
 const origin='https://claude.ai';if(location.origin!==origin)throw Error('claude_web_login');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const get=async route=>{const response=await fetch(route,{credentials:'same-origin',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});if([401,403].includes(response.status))throw Error('claude_web_login');if(!response.ok)throw Error('claude_web_request');const text=await response.text();if(text.length>512*1024)throw Error('claude_web_limit');if(/^\s*<!doctype|^\s*<html/i.test(text))throw Error('claude_web_login');try{return JSON.parse(text);}catch{throw Error('claude_web_format');}};
  if(input.operation==='organizations')return get('/api/organizations');
  if(input.operation==='usage')return get('/api/organizations/'+encodeURIComponent(input.organization)+'/usage');
  throw Error('claude_web_action');
 }catch(error){if(error.name==='AbortError')throw Error('claude_web_timeout');if(/^claude_web_/.test(error.message))throw error;throw Error('claude_web_request');}finally{clearTimeout(timer);}
}
class ClaudeWeb{
 constructor({BrowserWindow,parent,openPage=null,closePage=null}){this.BrowserWindow=BrowserWindow;this.parent=parent;this.openPage=openPage;this.closePage=closePage;this.page=null;this.epoch=0;this.state={connected:false,connecting:false,organization:null,usage:null,readAt:null,error:null};}
 status(){return {...this.state};}
 window(){
  if(!this.hidden||this.hidden.isDestroyed()){
   this.hidden=new this.BrowserWindow({parent:this.parent,width:1000,height:760,show:false,title:'Claude 사용량',webPreferences:{partition:'persist:nubi-claude-web',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
   this.hidden.webContents.session.setPermissionRequestHandler((_contents,_permission,reply)=>reply(false));
   this.hidden.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   this.hidden.on('closed',()=>{this.hidden=null;});
   this.loaded=this.hidden.loadURL(ORIGIN+'/').catch(()=>{});
  }
  return this.hidden;
 }
 async read(operation,input={}){const window=this.window();await this.loaded;if(!window||window.isDestroyed())throw Error('claude_web_login');return window.webContents.executeJavaScript(`(${webRead.toString()})(${JSON.stringify({operation,...input})})`);}
 pickOrganization(list){if(!Array.isArray(list))throw Error('claude_web_format');const rows=list.filter(row=>row&&typeof row.uuid==='string');if(!rows.length)throw Error('claude_web_organization');const chosen=rows.find(row=>/enterprise|team/i.test(String(row.rate_limit_tier||row.billing_type||'')))||rows.find(row=>Array.isArray(row.capabilities)&&row.capabilities.includes('chat'))||rows[0];return {id:chosen.uuid,name:typeof chosen.name==='string'?chosen.name.slice(0,120):null,tier:typeof chosen.rate_limit_tier==='string'?chosen.rate_limit_tier:null};}
 closeLoginPage(){const page=this.page;this.page=null;if(page&&this.closePage){try{this.closePage(page.tabId);}catch{}}}
 async refresh(){
  const organizations=await this.read('organizations'),organization=this.pickOrganization(organizations),usage=await this.read('usage',{organization:organization.id});
  if(!usage||typeof usage!=='object')throw Error('claude_web_format');
  this.state={connected:true,connecting:false,organization,usage,readAt:new Date().toISOString(),error:null};return this.status();
 }
 async connect(){
  if(this.state.connecting)throw Error('claude_web_busy');const epoch=++this.epoch;this.state={...this.state,connecting:true,error:null};
  try{
   try{return await this.refresh();}catch(error){if(error.message!=='claude_web_login')throw error;}
   if(!this.openPage)throw Error('claude_web_login');
   this.page=this.openPage(ORIGIN+'/login',{onClosed:()=>{if(this.page&&epoch===this.epoch){this.page=null;if(this.state.connecting)this.epoch++;}}});
   const deadline=Date.now()+5*60*1000;
   while(epoch===this.epoch&&Date.now()<deadline){try{const status=await this.refresh();this.closeLoginPage();return status;}catch(error){if(!['claude_web_login','claude_web_request','claude_web_format'].includes(error.message))throw error;await wait(2500);}}
   throw Error(epoch!==this.epoch?'claude_web_cancelled':'claude_web_timeout');
  }catch(error){this.closeLoginPage();if(epoch===this.epoch)this.state={...this.state,connecting:false,error:/^claude_web_/.test(error.message)?error.message:'claude_web_request'};throw Error(epoch!==this.epoch?'claude_web_cancelled':this.state.error);}
 }
 async disconnect(){++this.epoch;this.closeLoginPage();try{await this.hidden?.webContents.session.clearStorageData();}catch{}this.state={connected:false,connecting:false,organization:null,usage:null,readAt:null,error:null};return this.status();}
 dispose(){++this.epoch;this.closeLoginPage();this.hidden?.destroy();}
}
module.exports={ClaudeWeb,webRead};
