export const MAIL_CONNECTION_METHODS=Object.freeze(['desktop','pop3','portal']);
export function mailConnectionMethod(store){
 const selected=store.get('setting:mail-connection-method');
 if(MAIL_CONNECTION_METHODS.includes(selected))return selected;
 const desktop=store.get('setting:desktop-mail-source');
 if(desktop?.mode==='desktop'&&(desktop.enabled||desktop.transport==='uia'))return 'desktop';
 return store.get('setting:server-profile')==='company'?'pop3':'portal';
}
