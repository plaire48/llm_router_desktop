// One explicit login gesture reuses the session or opens the original portal tab.
// No username/password is accepted or sent through the conversation UI.
export async function openMailBrowserLogin(api){
 const session=await api('mail',{action:'portalSession'});
 if(session.connected)return session;
 return api('mail',{action:'portalLogin'});
}
