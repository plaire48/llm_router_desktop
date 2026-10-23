// Stable categories include both portal folders and imported mail.
export const MAILBOX_TABS=Object.freeze([
 {key:'inbox',label:'받은 메일함',icon:'mail'},
 {key:'sent',label:'보낸 메일함',icon:'send'},
 {key:'draft',label:'임시 보관함',icon:'file'},
 {key:'spam',label:'스팸 메일함',icon:'alertCircle'},
]);
export function mailboxTabsFor(status){
 const hasObserved=isDesktopUia(status)||status?.localKinds?.includes('other');
 return hasObserved?[...MAILBOX_TABS,{key:'other',label:'별도 보관',icon:'file'}]:MAILBOX_TABS;
}
export function isDesktopUia(status){return (status?.connectionMethod||status?.desktop?.mode)==='desktop'&&status?.desktop?.transport==='uia';}
export function personalMailFolders(folders=[]){
 const seen=new Set();
 return folders.filter(folder=>{const id=String(folder?.id||'');if(folder?.mailbox!=='other'||!/^\d{1,15}$/.test(id)||seen.has(id))return false;seen.add(id);return true;});
}
export function mailboxSelection(value,folders=[]){
 if(personalMailFolders(folders).some(folder=>'folder:'+folder.id===value))return value;
 const key=String(value||'').startsWith('folder:')?folders?.find(folder=>'folder:'+folder.id===value)?.mailbox:String(value||'').replace(/^local:/,'');
 return key==='other'||MAILBOX_TABS.some(item=>item.key===key)?key:'inbox';
}
