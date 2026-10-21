import {LOCAL_MAIL_KINDS} from './mail-file-kinds.mjs';
export const clean=value=>String(value||'').normalize('NFKC').trim();
export const lower=value=>clean(value).toLocaleLowerCase();
export const list=(value,max=30)=>Array.isArray(value)?[...new Set(value.map(clean).filter(Boolean))].slice(0,max):[];
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))?value:'';
export const one=(value,allowed,fallback)=>allowed.includes(value)?value:fallback;
export function mailFilters(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('mail_input_invalid');
  const filters={subject:clean(value.subject).slice(0,500),roles:list(value.roles).filter(role=>['to','cc','bcc','sent','unknown'].includes(role)),mailbox:typeof value.mailbox==='string'&&/^folder:\d{1,15}$/.test(value.mailbox||'')?value.mailbox:one(value.mailbox,['all','mail','inbox','sent','draft','spam','trash','other',...Object.keys(LOCAL_MAIL_KINDS).map(kind=>'local:'+kind)],'all'),period:one(value.period,['all','7','30','custom','unknown'],'all'),from:day(value.from),to:day(value.to),dateField:one(value.dateField,['date','fetchedAt'],'date'),senders:list(value.senders).map(v=>v.slice(0,200)),attachment:one(value.attachment,['all','with','without'],'all'),types:list(value.types).filter(v=>['pdf','word','excel','powerpoint','other'].includes(v)),filename:clean(value.filename).slice(0,200),locations:list(value.locations).filter(v=>['subject','metadata','body','attachment','knowledge'].includes(v)),states:list(value.states).filter(v=>['queued','saved','attention'].includes(v)),pinned:value.pinned===true,tags:list(value.tags,20).map(v=>v.slice(0,50)),confirmed:one(value.confirmed,['all','yes','no'],'all')};
  if(value.period==='custom'&&((value.from&&!filters.from)||(value.to&&!filters.to)||(filters.from&&filters.to&&filters.from>filters.to)))throw Error('mail_input_invalid');
  return filters;
}
