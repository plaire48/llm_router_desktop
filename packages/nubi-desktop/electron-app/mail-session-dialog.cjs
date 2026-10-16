const {ORIGIN,LOGIN_URL}=require('./mail-portal-contract.cjs');
const states=new WeakMap();
function allowedOrigin(value){
 try{
  const url=new URL(value);if(url.username||url.password||!['http:','https:'].includes(url.protocol))return false;
  const origins=[ORIGIN,new URL(LOGIN_URL).origin,'https://www.samsung.net','https://samsung.net'];
  return origins.some(origin=>{const base=new URL(origin);return url.origin===base.origin||(base.protocol==='http:'&&url.protocol==='https:'&&url.host===base.host);});
 }catch{return false;}
}
function expiredSessionDialog({url,type,message}={}){
 if(type!=='alert'||!allowedOrigin(url)||typeof message!=='string'||message.length>2000)return false;
 const text=message.replace(/\s+/g,' ').trim();
 return /(?:사용자\s*)?세션[이가]?\s*만료/.test(text)&&/브라우저/.test(text)&&/종료|다시|로그인/.test(text);
}
function automaticExpiryConfirmation(dialog){
 if(!expiredSessionDialog(dialog))return false;
 try{return /^\/loginapp\/abnormal-logout\/?$/i.test(new URL(dialog.url).pathname);}catch{return false;}
}
function mailDialogOpen(contents){return !!states.get(contents)?.open;}
function mailDialogPending(contents){const state=states.get(contents);return !!(state?.open||state?.awaitingNavigation);}
// Only explicitly opened mail-login tabs install this listener. Page events do
// not enable Network/Runtime, inspect cookies, or expose dialogs to the agent.
function installMailSessionDialogs(contents,onChange=()=>{}){
 if(states.has(contents)||!contents.debugger||contents.debugger.isAttached())return;
 const state={open:false,awaitingNavigation:false,expired:false,automaticAttempted:false};
 try{contents.debugger.attach('1.3');}catch{return;}
 states.set(contents,state);
 const navigation=(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace){state.open=false;state.awaitingNavigation=false;state.expired=false;onChange();}};
 const message=(_event,method,params)=>{
  if(method==='Page.javascriptDialogClosed'){state.open=false;if(state.expired)state.awaitingNavigation=true;onChange();return;}
  if(method!=='Page.javascriptDialogOpening')return;
  state.open=true;state.expired=expiredSessionDialog(params);onChange();
  // Explicit user exception: accept the known expiry alert once in this login
  // tab. Never approve arbitrary confirms, credentials, prompts or retry loops.
  if(!state.automaticAttempted&&automaticExpiryConfirmation(params)){
   state.automaticAttempted=true;
   void contents.debugger.sendCommand('Page.handleJavaScriptDialog',{accept:true}).catch(()=>onChange());
  }
 };
 const detach=()=>{state.open=false;contents.debugger.removeListener('message',message);contents.removeListener('did-start-navigation',navigation);};
 contents.debugger.on('message',message);contents.debugger.once('detach',detach);
 contents.on('did-start-navigation',navigation);
 void contents.debugger.sendCommand('Page.enable').catch(()=>{try{contents.debugger.detach();}catch{detach();}});
}
function mailDialogGuide(contents){const state=states.get(contents);return state?.open?(state.expired?'expired':'confirmation'):'login';}
module.exports={expiredSessionDialog,automaticExpiryConfirmation,mailDialogPending,mailDialogOpen,mailDialogGuide,installMailSessionDialogs};
