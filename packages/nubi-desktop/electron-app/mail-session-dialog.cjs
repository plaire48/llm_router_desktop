const {ORIGIN,LOGIN_URL}=require('./mail-portal-contract.cjs');
const states=new WeakMap();
function allowedOrigin(value){
 try{
  const url=new URL(value);if(url.username||url.password||!['http:','https:'].includes(url.protocol))return false;
  const origins=[ORIGIN,new URL(LOGIN_URL).origin,'http://www.samsung.net','http://samsung.net'];
  return origins.some(origin=>{const base=new URL(origin);return url.origin===base.origin||(base.protocol==='http:'&&url.protocol==='https:'&&url.host===base.host);});
 }catch{return false;}
}
function expiredSessionDialog({url,type,message}={}){
 if(!['alert','confirm'].includes(type)||!allowedOrigin(url)||typeof message!=='string'||message.length>2000)return false;
 const text=message.replace(/\s+/g,' ').trim();
 return (/(?:사용자\s*)?세션[이가]?\s*(?:만료|종료되)/.test(text)&&/브라우저|로그인/.test(text))||/브라우저(?:에서|를)?\s*로그인.*다시\s*시도/.test(text);
}
function automaticExpiryConfirmation(dialog){return expiredSessionDialog(dialog);}
function mailDialogOpen(contents){return !!states.get(contents)?.open;}
function mailDialogPending(contents){const state=states.get(contents);return !!(state?.open||state?.awaitingNavigation);}
// Only explicitly opened mail-login tabs install this listener. Page events do
// not enable Network/Runtime, inspect cookies, or expose dialogs to the agent.
function installMailSessionDialogs(contents,onChange=()=>{}){
 if(states.has(contents))return states.get(contents).ready;
 if(!contents.debugger)return Promise.resolve();
 const owned=!contents.debugger.isAttached();
 const state={open:false,awaitingNavigation:false,expired:false,automaticAttempted:false,automaticCount:0,automatic:false};
 try{if(owned)contents.debugger.attach('1.3');}catch{return Promise.resolve();}
 states.set(contents,state);
 const navigation=(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace){state.open=false;state.awaitingNavigation=false;state.expired=false;state.automaticAttempted=false;state.automatic=false;onChange();}};
 const message=(_event,method,params)=>{
  if(method==='Page.javascriptDialogClosed'){state.open=false;if(state.expired)state.awaitingNavigation=true;onChange();return;}
  if(method!=='Page.javascriptDialogOpening')return;
  state.open=true;state.expired=expiredSessionDialog(params);state.automatic=false;onChange();
  // The portal can show this alert on home, login or logout. Accept once per
  // document, at most three times per login tab; never approve other dialogs.
  if(!state.automaticAttempted&&state.automaticCount<3&&automaticExpiryConfirmation(params)){
   state.automaticAttempted=true;state.automaticCount++;state.automatic=true;onChange();
   void contents.debugger.sendCommand('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{state.automatic=false;onChange();});
  }
 };
 const detach=()=>{state.open=false;state.awaitingNavigation=false;state.automatic=false;contents.debugger.removeListener('message',message);contents.removeListener('did-start-navigation',navigation);};
 contents.debugger.on('message',message);contents.debugger.once('detach',detach);
 contents.on('did-start-navigation',navigation);
 state.ready=contents.debugger.sendCommand('Page.enable').catch(()=>{if(owned){try{contents.debugger.detach();}catch{detach();}}else detach();});
 return state.ready;
}
function mailDialogGuide(contents){const state=states.get(contents);return state?.automatic&&(state.open||state.awaitingNavigation)?'advancing':state?.open?(state.expired?'expired':'confirmation'):'login';}
module.exports={expiredSessionDialog,automaticExpiryConfirmation,mailDialogPending,mailDialogOpen,mailDialogGuide,installMailSessionDialogs};
