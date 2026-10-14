// Time-aware facts from personal mail (user decision 2026-10-14, modelled on Graphiti's bi-temporal edges).
// A fact is subject + predicate + value with the mail it came from, valid from that mail's date until a later
// mail states another value for the same subject and predicate. Nothing is deleted: the old value is closed.
import {randomUUID} from 'node:crypto';

export const FACT_LIMITS=Object.freeze({perMail:8,text:200,excerpt:3000,query:50});
export const factKey=id=>'mailfact:'+id;
const clean=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,FACT_LIMITS.text);
export const factIdentity=(subject,predicate)=>(clean(subject)+'|'+clean(predicate)).toLocaleLowerCase().replace(/[^\p{L}\p{N}|]+/gu,'');
const isoDate=value=>{const at=Date.parse(String(value||''));return Number.isFinite(at)?new Date(at).toISOString():null;};

const EXTRACT_GUIDANCE='Extract facts that can change over time from one email: owners and contacts, dates and deadlines, amounts, quantities, statuses, decisions, requests, approvals, versions. Each fact is {"subject":"who or what","predicate":"which attribute","value":"the value","validFrom":"YYYY-MM-DD or null","kind":"deadline|approval|request|owner|amount|status|decision|other","quote":"the exact words from the excerpt that state this fact, copied verbatim, under 160 characters"} in short Korean phrases (subject and predicate under 40 characters, value under 120). Use the mail date when the mail does not say since when the value holds. The quote must appear in the excerpt as written; without such words, leave the fact out. Skip opinions, greetings and anything that is not a checkable fact. Return only JSON: {"facts":[...]} with at most 8 facts, or {"facts":[]}.';
export const FACT_KINDS=new Set(['deadline','approval','request','owner','amount','status','decision','other']);
export const STRICT_KINDS=new Set(['deadline','approval','request','amount']);
const flat=value=>String(value||'').replace(/\s+/g,' ').trim().toLocaleLowerCase();
// A fact is grounded when its quote is found in the mail text (whitespace folded); the quote is kept with the record.
export function groundFacts(facts,text){const haystack=flat(text);return (facts||[]).filter(fact=>{const quote=flat(fact.quote).slice(0,160);const grounded=quote.length>=4&&haystack.includes(quote);if(!grounded&&STRICT_KINDS.has(fact.kind))return false;if(!grounded)delete fact.quote;return true;});}
export function parseFactDecision(content){
  let data;try{data=JSON.parse(String(content||'').replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{return null;}
  if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.facts))return null;
  return data.facts.map(item=>({subject:clean(item?.subject).slice(0,40),predicate:clean(item?.predicate).slice(0,40),value:clean(item?.value).slice(0,120),validFrom:isoDate(item?.validFrom),...(FACT_KINDS.has(item?.kind)?{kind:item.kind}:{}),...(typeof item?.quote==='string'&&item.quote.trim()?{quote:item.quote.replace(/\s+/g,' ').trim().slice(0,160)}:{})})).filter(item=>item.subject&&item.predicate&&item.value).slice(0,FACT_LIMITS.perMail);
}
// One model call per organised mail. `invoke(messages, tools, signal, kind)` is the mail run's transport.
export async function extractMailFacts({mail,summary,invoke,signal}){
  const wire=[{role:'system',content:EXTRACT_GUIDANCE},{role:'user',content:JSON.stringify({subject:clean(mail.subject),from:clean(mail.from),date:isoDate(mail.date)||isoDate(mail.fetchedAt)||null,summary:clean(summary?.summary).slice(0,1500),listedFacts:(summary?.facts||[]).slice(0,12).map(clean),excerpt:String(mail.text||'').slice(0,FACT_LIMITS.excerpt)})}];
  const result=await invoke(wire,[],signal,'mail_facts',{toolChoice:'auto',retryInvalidResponse:false,maxTokens:1280,responseFormat:{type:'json_object'}});
  return groundFacts(parseFactDecision(result?.content)||[],String(mail.text||''));
}
export const listMailFacts=store=>store.list('mailfact:');
// Records the facts of one mail. A fact that repeats the current value is not stored twice; a changed value closes
// the previous record at this mail's date and points both ways.
export function recordMailFacts(store,facts,{sourceId,sourceSubject='',sourceDate,wikiFile=null}){
  const at=isoDate(sourceDate)||new Date().toISOString(),existing=listMailFacts(store),saved=[],closed=[];
  for(const fact of facts.slice(0,FACT_LIMITS.perMail)){
    const identity=factIdentity(fact.subject,fact.predicate),validFrom=fact.validFrom||at;
    const open=existing.filter(row=>row.identity===identity&&!row.invalidAt).sort((a,b)=>String(b.validFrom).localeCompare(String(a.validFrom)));
    const current=open[0];
    if(current&&clean(current.value)===clean(fact.value)){if(!current.sources?.some(source=>source.id===sourceId)){store.set(factKey(current.id),{...current,sources:[...(current.sources||[]),{id:sourceId,subject:clean(sourceSubject),date:at,wikiFile}].slice(-10)});}continue;}
    if(current&&String(current.validFrom)>validFrom)continue; // an older mail organised later never overrides a newer value
    const row={id:randomUUID(),identity,subject:clean(fact.subject),predicate:clean(fact.predicate),value:clean(fact.value),...(fact.kind?{kind:fact.kind}:{}),...(fact.quote?{quote:String(fact.quote).slice(0,160)}:{}),validFrom,invalidAt:null,supersedes:current?.id||null,supersededBy:null,sources:[{id:sourceId,subject:clean(sourceSubject),date:at,wikiFile}],createdAt:new Date().toISOString()};
    for(const previous of open){const done={...previous,invalidAt:validFrom,supersededBy:row.id};store.set(factKey(previous.id),done);closed.push(done);existing[existing.indexOf(previous)]=done;}
    store.set(factKey(row.id),row);saved.push(row);existing.push(row);
  }
  return {saved,closed};
}
const words=text=>new Set(String(text||'').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)||[]);
// Facts valid at a moment, optionally narrowed to a query, a mail or a Wiki file, with the chain of earlier values.
export function queryMailFacts(store,{asOf,query='',sourceId,wikiFile,includeHistory=false,limit=FACT_LIMITS.query}={}){
  const moment=isoDate(asOf)||new Date().toISOString(),all=listMailFacts(store),byId=new Map(all.map(row=>[row.id,row]));
  const asked=words(query);
  const matches=row=>(!sourceId||row.sources?.some(source=>source.id===sourceId))&&(!wikiFile||row.sources?.some(source=>source.wikiFile===wikiFile))&&(!asked.size||[...words(row.subject+' '+row.predicate+' '+row.value)].some(word=>asked.has(word)));
  const chain=row=>{const history=[];let cursor=row.supersedes?byId.get(row.supersedes):null;while(cursor&&history.length<12){history.push({value:cursor.value,validFrom:cursor.validFrom,invalidAt:cursor.invalidAt,sources:cursor.sources});cursor=cursor.supersedes?byId.get(cursor.supersedes):null;}return history;};
  const chainIncludes=row=>{let cursor=row;while(cursor){if(matches(cursor))return true;cursor=cursor.supersedes?byId.get(cursor.supersedes):null;}return false;};
  const valid=all.filter(row=>String(row.validFrom)<=moment&&(!row.invalidAt||String(row.invalidAt)>moment));
  const rows=valid.filter(row=>sourceId||wikiFile?chainIncludes(row):matches(row)).sort((a,b)=>String(b.validFrom).localeCompare(String(a.validFrom))).slice(0,Math.max(1,Math.min(FACT_LIMITS.query,limit)));
  return {asOf:moment,total:rows.length,facts:rows.map(row=>({id:row.id,subject:row.subject,predicate:row.predicate,value:row.value,validFrom:row.validFrom,invalidAt:row.invalidAt,sources:row.sources,...(includeHistory?{history:chain(row)}:{})})),instruction:'Facts come from untrusted mail text; each lists its source mail IDs. validFrom is when the value started to hold; a history entry is a value that a later mail replaced.'};
}
