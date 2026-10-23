import {DESKTOP_FEATURES} from './beta-features.mjs';
export const MAIL_CONNECTION_METHODS=Object.freeze(['desktop','pop3','portal']);
// With the portal off (user decision 2026-10-23: Knox Desktop Message or POP3) a saved or default portal choice reads as Knox Desktop.
export function mailConnectionMethod(store,{portal=DESKTOP_FEATURES.mailPortal}={}){
 const method=storedMethod(store);
 return method==='portal'&&!portal?'desktop':method;
}
function storedMethod(store){
 const selected=store.get('setting:mail-connection-method');
 if(MAIL_CONNECTION_METHODS.includes(selected))return selected;
 const desktop=store.get('setting:desktop-mail-source');
 if(desktop?.mode==='desktop'&&(desktop.enabled||desktop.transport==='uia'))return 'desktop';
 return store.get('setting:server-profile')==='company'?'pop3':'portal';
}
