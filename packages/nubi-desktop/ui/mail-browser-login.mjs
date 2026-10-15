// One explicit login gesture reuses the session or opens the original portal tab.
// No username/password is accepted or sent through the conversation UI.
export async function openMailBrowserLogin(api,{onBrowserOpen=()=>{},isActive=()=>true}={}){
 const session=await api('mail',{action:'portalSession'});
 if(!isActive())throw Error('mail_cancelled');
 if(session.connected)return session;
 await onBrowserOpen();
 if(!isActive())throw Error('mail_cancelled');
 return api('mail',{action:'portalLogin'});
}
