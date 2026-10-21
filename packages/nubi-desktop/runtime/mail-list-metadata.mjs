// The metadata allowlist deliberately excludes body/HTML, attachment text and
// credentials. Source hashes bind this navigation projection to the original.
export function mailListMetadata(mail={}){
 const keys=['subject','from','to','cc','bcc','date','messageId','inReplyTo','references','sender','receivedAddress','recipientAddresses'];
 return {...Object.fromEntries(keys.filter(key=>mail[key]!==undefined).map(key=>[key,mail[key]])),attachments:(mail.attachments||[]).filter(part=>!['inline','body'].includes(part.presentation)).map(({filename,contentType,contentState})=>({filename,contentType,contentState}))};
}
