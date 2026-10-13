const clean=value=>typeof value==='string'?value.replace(/[\r\n\0]/g,' ').trim():'';
export function portalAddress(value){
 if(typeof value==='string'){const matches=value.match(/[^\s<>;,"()]+@[^\s<>;,"()]+/g)||[];return matches.length===1?matches[0].toLowerCase():'';}
 if(value&&typeof value==='object')return portalAddress(value.email||value.address||value.emailAddress?.address||value.emailAddress||value.receivedAddress);
 return '';
}
function recipients(value){
 const rows=Array.isArray(value)?value.slice(0,1000):[value];
 return rows.map(row=>{if(typeof row==='string')return clean(row);const email=portalAddress(row),name=clean(row?.name||row?.displayName);return email?name?`${name} <${email}>`:email:'';}).filter(Boolean).join(', ').slice(0,32000);
}
// These keys are the user's observed portal response fields. Never infer Bcc
// from a missing To match: only compare an explicitly received address with
// the actually provided recipient lists (or the retained MIME headers).
export function applyPortalMetadata(mail,metadata={}){
 const out={...mail};
 if(!metadata||typeof metadata!=='object')return out;
 const subject=clean(metadata.subject);if(subject)out.subject=subject.slice(0,1000);
 const local=metadata.localdate;
 if(typeof local==='string'||typeof local==='number'){const date=new Date(local);if(Number.isFinite(date.getTime())){out.date=date.toISOString();out.localdate=String(local).slice(0,100);}}
 for(const [key,target] of [['toRecipients','to'],['ccRecipients','cc'],['bccRecipients','bcc']]){
  if(Array.isArray(metadata[key])||typeof metadata[key]==='string'){const text=recipients(metadata[key]);if(text||!out[target])out[target]=text;
   const rows=Array.isArray(metadata[key])?metadata[key].slice(0,1000):[metadata[key]];
   out.recipientAddresses={...out.recipientAddresses,[target]:[...new Set(rows.map(portalAddress).filter(Boolean))]};
  }
 }
 const address=portalAddress(metadata.receivedAddress);if(address)out.receivedAddress=address;
 const sender=portalAddress(metadata.from);if(sender){const name=clean(metadata.from?.name||metadata.from?.displayName);out.from=name?`${name} <${sender}>`:sender;out.sender={name,address:sender};}
 return out;
}
