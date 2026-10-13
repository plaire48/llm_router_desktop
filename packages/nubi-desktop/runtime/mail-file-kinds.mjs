export const LOCAL_MAIL_KINDS=Object.freeze({inbox:{label:'받은 메일',icon:'mail'},sent:{label:'보낸 메일',icon:'send'},notice:{label:'결재 문서',icon:'clipboardCheck'},processed:{label:'승인한 결재',icon:'check'},submitted:{label:'기안한 결재',icon:'file'},other:{label:'기타 문서',icon:'folder'}});
export const APPROVAL_KINDS=['notice','processed','submitted'];
const folders={AUTO_INBOX:'inbox',AUTO_OUTBOX:'sent',AUTO_NOTICE:'notice',AUTO_PROCESSED:'processed',AUTO_SUBMITTED:'submitted'};
export function mailFileKind(file){
 const parts=String(file).split(/[\\/]/).slice(0,-1);
 for(let i=parts.length-1;i>=0;i--){const kind=folders[parts[i].toUpperCase()];if(kind)return kind;}
 return 'other';
}
