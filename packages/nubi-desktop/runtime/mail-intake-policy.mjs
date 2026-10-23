// Shared by every intake adapter. These are collection rules, not search filters.
export const MAIL_INTAKE_VERSION=1;
export const MAIL_INTAKE_MAILBOXES=Object.freeze(['inbox','sent','other','notice','processed','submitted','draft','spam','queue','trash']);
export const DEFAULT_MAIL_INTAKE=Object.freeze({version:MAIL_INTAKE_VERSION,period:'all',from:'',to:'',mailboxes:['inbox','sent','other','notice','processed','submitted'],includeSenders:[],includeSubjects:[],excludeSenders:[],excludeSubjects:[],retainOriginals:true});
const invalid=()=>{throw Error('mail_intake_invalid');};
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const address=value=>/^@(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(value)||/^[^\s@<>]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(value);
function values(input,{addresses=false}={}){
 if(!Array.isArray(input)||input.length>50)invalid();
 return [...new Set(input.map(value=>{if(typeof value!=='string'||!value.trim()||value.length>200)invalid();const clean=value.normalize('NFKC').trim().toLowerCase();if(addresses&&!address(clean))invalid();return clean;}))];
}
export function normalizeMailIntake(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))invalid();const policy={...DEFAULT_MAIL_INTAKE,...input,version:MAIL_INTAKE_VERSION};
 if(!['all','30','90','365','custom'].includes(policy.period)||typeof policy.retainOriginals!=='boolean')invalid();
 if(policy.period==='custom'&&(!day(policy.from)||policy.to&&!day(policy.to)||policy.to&&policy.from>policy.to))invalid();
 if(!Array.isArray(policy.mailboxes)||!policy.mailboxes.length||policy.mailboxes.some(value=>!MAIL_INTAKE_MAILBOXES.includes(value)))invalid();
 return {version:MAIL_INTAKE_VERSION,period:policy.period,from:policy.period==='custom'?policy.from:'',to:policy.period==='custom'?policy.to:'',mailboxes:[...new Set(policy.mailboxes)],...Object.fromEntries(['includeSenders','includeSubjects','excludeSenders','excludeSubjects'].map(key=>[key,values(policy[key],{addresses:key.endsWith('Senders')})])),retainOriginals:policy.retainOriginals};
}
export function mailIntakeDecision(policy,mail,row={},at=new Date()){
 const no=reason=>({include:false,reason}),subject=String(mail.subject||'').normalize('NFKC').toLowerCase(),sender=String(mail.from||'').normalize('NFKC').toLowerCase();
 const addresses=sender.match(/[^\s<>;,"()]+@[^\s<>;,"()]+/g)||[];
 const matches=value=>addresses.some(item=>value.startsWith('@')?item.endsWith(value):item===value);
 if(policy.excludeSenders.some(matches))return no('excluded_sender');
 if(policy.excludeSubjects.some(value=>subject.includes(value)))return no('excluded_subject');
 const mailbox=MAIL_INTAKE_MAILBOXES.includes(row.mailbox)?row.mailbox:'other';
 if(!policy.mailboxes.includes(mailbox))return no('mailbox');
 if(policy.includeSenders.length&&!policy.includeSenders.some(matches))return no('sender');
 if(policy.includeSubjects.length&&!policy.includeSubjects.some(value=>subject.includes(value)))return no('subject');
 if(policy.period!=='all'){
  const stamp=Date.parse(mail.date);if(!Number.isFinite(stamp))return no('date_unknown');
  const start=policy.period==='custom'?new Date(policy.from+'T00:00:00').getTime():at.getTime()-Number(policy.period)*86400000;
  const end=policy.period==='custom'&&policy.to?new Date(policy.to+'T00:00:00').setDate(new Date(policy.to+'T00:00:00').getDate()+1):Infinity;
  if(stamp<start||stamp>=end)return no('period');
 }
 return {include:true,reason:null};
}
