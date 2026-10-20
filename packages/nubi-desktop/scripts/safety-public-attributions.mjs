import {X509Certificate} from 'node:crypto';
// Classification records an attribution, not the trust or validity of a signature.
export function certificateIssuerContacts(bytes){
 const contacts=new Set();
 for(let i=0;i+4<bytes.length;i++){
  if(bytes[i]!==0x30||bytes[i+1]!==0x82)continue;
  const end=i+4+bytes.readUInt16BE(i+2);if(end>bytes.length)continue;
  try{const cert=new X509Certificate(bytes.subarray(i,end));
   for(const field of [cert.issuer,...(cert.ca?[cert.subject]:[])]){
    // A public CA identity needs an organization and common name. Leaf author
    // addresses and unrelated PNG text fields never enter this set.
    if(!/(?:^|\n)O=/.test(field)||!/(?:^|\n)CN=/.test(field))continue;
    for(const match of field.matchAll(/(?:^|\n)emailAddress=([^\n]+)/g))contacts.add(match[1].toLowerCase());
   }
  }catch{}
 }
 return contacts;
}
export function publicAttribution({file,text,index,value,projection,issuerContacts}){
 if(projection==='png-caBX'&&issuerContacts?.has(value.toLowerCase()))return 'certificate_issuer';
 const start=text.lastIndexOf('\n',index)+1,end=text.indexOf('\n',index),line=text.slice(start,end<0?undefined:end);
 const copyright=/(?:copyright|©|\(c\))/i.test(line);
 if(/(?:^|\/)(?:[^/]*licen[cs]e[^/]*|third[-_]party[-_]notices[^/]*|notice(?:\.txt)?)$/i.test(file)){
  if(copyright&&(/\b(?:19|20)\d{2}\b/.test(line)||/(?:MIT|Apache|permission is hereby granted|redistribution|license|licence)/i.test(text)))return 'copyright';
 }
 // esbuild retains third-party legal comments in JS. They are still notices,
 // not source configuration or example values. Do not remove or rewrite them.
 if(/\.[cm]?js$/i.test(file)){
  const open=Math.max(text.lastIndexOf('/*',index),text.lastIndexOf('(*',index));
  const closings=[text.indexOf('*/',open+2),text.indexOf('*)',open+2)].filter(i=>i>=0),close=Math.min(...closings);
  if(open>=0&&index<close&&close-open<4096){
   const block=text.slice(open,close);
   if(/(?:MIT|Apache|@license|licensed|licence)/i.test(block)&&/(?:copyright|©|\(c\))/i.test(block)&&(copyright||/@author/i.test(line)))return 'copyright';
  }
 }
}
