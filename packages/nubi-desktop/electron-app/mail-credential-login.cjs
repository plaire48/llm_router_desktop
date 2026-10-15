const {LOGIN_URL,portalOrigin}=require('./mail-portal-contract.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function companyPage(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&/(^|\.)samsung\.(net|com)$/.test(u.hostname);}catch{return false;}}
// Self-contained code runs in the actual SSO document, not a recreated HTTP authentication endpoint.
function submitLogin({username,password}){
 if(location.protocol!=='https:'||!/(^|\.)samsung\.(net|com)$/.test(location.hostname))return 'secure_page_required';
 if(!/^\/loginapp\/login\/?$/i.test(location.pathname))return 'waiting';
 const passwords=[...document.querySelectorAll('input[type=password]')].filter(el=>!el.disabled&&el.getClientRects().length>0);
 if(passwords.length!==1)return 'form_required';
 const pass=passwords[0],form=pass.form;if(!form)return 'form_required';
 const action=new URL(form.action||location.href,location.href);
 if(action.protocol!=='https:'||action.origin!==location.origin||form.method.toLowerCase()!=='post')return 'secure_page_required';
 const inputs=[...form.querySelectorAll('input')].filter(el=>!el.disabled&&el.getClientRects().length>0&&['text','email','tel'].includes(el.type));
 const named=inputs.filter(el=>el.autocomplete==='username'||/^(?:user(?:name|id)?|login(?:id)?|id|email)$/i.test(el.name||el.id));
 const users=named.length?named:inputs;if(users.length!==1)return 'form_required';
 const submitters=[...form.querySelectorAll('button,input[type=submit]')].filter(el=>!el.disabled&&el.getClientRects().length>0&&el.type==='submit');
 if(submitters.length>1)return 'form_required';
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 for(const [input,value] of [[users[0],username],[pass,password]]){setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
 if(!form.checkValidity()){setter.call(pass,'');return 'form_required';}
 form.requestSubmit(submitters[0]);return 'submitted';
}
class MailCredentialLogin{
 constructor({BrowserWindow,session,signal}){this.BrowserWindow=BrowserWindow;this.session=session;this.signal=signal;this.windows=new Set();this.closed=false;}
 attach(window){
  this.windows.add(window);const wc=window.webContents;
  const guard=(event,url)=>{if(!companyPage(url)){event.preventDefault();this.failure='mail_portal_additional_auth';}};
  wc.on('will-navigate',guard);wc.on('will-redirect',guard);
  wc.setWindowOpenHandler(({url})=>companyPage(url)&&this.windows.size<4?{action:'allow',overrideBrowserWindowOptions:{show:false,webPreferences:{session:this.session,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}}}:{action:'deny'});
  wc.on('did-create-window',child=>this.attach(child));window.on('closed',()=>this.windows.delete(window));
 }
 async run(credentials){
  if(typeof credentials.username!=='string'||!credentials.username.trim()||credentials.username.length>320||typeof credentials.password!=='string'||!credentials.password||credentials.password.length>4096)throw Error('mail_input_invalid');
  if(this.signal.aborted){credentials.username='';credentials.password='';throw Error('mail_cancelled');}
  const window=new this.BrowserWindow({show:false,webPreferences:{session:this.session,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}});this.attach(window);
  const abort=()=>this.dispose();this.signal.addEventListener('abort',abort,{once:true});let submitted=false;
  const timeout=setTimeout(()=>{this.failure='mail_portal_timeout';this.dispose();},90000);
  try{
   await window.loadURL(LOGIN_URL);const deadline=Date.now()+90000;
   while(!this.closed&&!this.signal.aborted&&Date.now()<deadline){
    if(this.failure)throw Error(this.failure);
    for(const item of [...this.windows].reverse()){
     const wc=item.webContents;if(item.isDestroyed()||wc.isLoadingMainFrame())continue;
     const url=wc.getURL();if(portalOrigin(url)&&new URL(url).pathname.startsWith('/portalapp/home'))return;
     if(!companyPage(url))throw Error('mail_portal_additional_auth');
     if(!submitted&&/\/loginapp\/login\/?(?:[?#]|$)/i.test(url)){
      const state=await wc.executeJavaScript(`(${submitLogin.toString()})(${JSON.stringify(credentials)})`);
      if(state==='submitted'){submitted=true;credentials.username='';credentials.password='';}
      else if(state!=='waiting')throw Error(state==='secure_page_required'?'mail_portal_secure_login':'mail_portal_login_form');
     }
    }
    await pause(400);
   }
   throw Error(this.failure||(this.signal.aborted||this.closed?'mail_cancelled':submitted?'mail_portal_additional_auth':'mail_portal_login_form'));
  }catch(error){throw Error(this.signal.aborted?'mail_cancelled':this.failure||(/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_portal_request'));}
  finally{clearTimeout(timeout);credentials.username='';credentials.password='';this.signal.removeEventListener('abort',abort);this.dispose();}
 }
 dispose(){this.closed=true;for(const window of this.windows)if(!window.isDestroyed())window.destroy();this.windows.clear();}
}
module.exports={MailCredentialLogin,submitLogin,companyPage};
