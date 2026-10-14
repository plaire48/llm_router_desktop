// Shared by the Personal Wiki graph and retrieval. Links are evidence-backed
// navigation hints, never assertions that one event caused another.
const DAY=86400000;
const clean=value=>String(value||'').normalize('NFKC').trim();
const messageIds=value=>[...new Set([].concat(value||[]).flatMap(v=>clean(v).match(/<[^<>]+>|[^\s<>]+/g)||[]).map(v=>v.replace(/^<|>$/g,'')))];
const subject=value=>clean(value).toLowerCase().replace(/^(?:\s*(?:(?:re|fw|fwd|답장|전달|회신|답변)\s*:|\[(?:외부|광고|external)\]))+\s*/gi,'');
const STOP=new Set('메일 mail email re fw fwd 안내 공지 요청 회신 전달 확인 변경 결과 관련 대한 이번 있습니다 감사합니다 안녕하세요 일정 회의 승인 검토 처리 완료 업무 the and for with from this that please update request'.split(' '));
const tokens=value=>new Set((clean(value).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]+/gu)||[]).filter(v=>!STOP.has(v)&&!/^\d+$/.test(v)).slice(0,80));
const addresses=value=>new Set(([].concat(value||[]).join(' ').toLowerCase().match(/[^\s<>,;"()]+@[^\s<>,;"()]+/g)||[]));
const overlap=(a,b)=>{const values=b instanceof Set?b:new Set(b);return [...a].filter(v=>values.has(v));};
function record(raw){
 const title=subject(raw.subject||raw.title),people=addresses([raw.from,...[].concat(raw.to||[]),...[].concat(raw.cc||[])]);
 return {...raw,id:raw.id||raw.path,titleKey:title,terms:tokens(title),people,stamp:Date.parse(raw.date),messageIds:messageIds(raw.messageId),parents:messageIds(raw.inReplyTo),refs:messageIds(raw.references)};
}
function pair(a,b){
 if(a.id===b.id||String(a.account||'')!==String(b.account||''))return null;
 let kind,label,reasons=[],confidence='candidate';
 if(overlap(a.messageIds,b.parents).length){kind='reply';label='회신';confidence='header';reasons=['In-Reply-To가 원문 Message-ID와 일치'];}
 else if(overlap(b.messageIds,a.parents).length)return pair(b,a);
 else if(overlap(a.messageIds,b.refs).length){kind='reference';label='이전 대화 참조';confidence='header';reasons=['References가 원문 Message-ID와 일치'];}
 else if(overlap(b.messageIds,a.refs).length)return pair(b,a);
 else if(a.thread&&a.thread===b.thread&&!String(a.thread).startsWith('subject:')){kind='thread';label='같은 대화';confidence='header';reasons=['같은 대화 식별자'];}
 else {
  if(!Number.isFinite(a.stamp)||!Number.isFinite(b.stamp)||Math.abs(a.stamp-b.stamp)>120*DAY)return null;
  const bracket=s=>[...s.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1]);
  const aa=bracket(a.titleKey),bb=bracket(b.titleKey);if(aa.length&&bb.length&&!aa.some(v=>bb.includes(v)))return null;
  const shared=overlap(a.terms,b.terms),people=overlap(a.people,b.people),same=a.titleKey&&a.titleKey===b.titleKey;
  // Generic subjects, dates, mail type and a common recipient are insufficient.
  if(same&&a.terms.size>=1&&people.length){kind='same_topic';label='같은 주제 후보';reasons=['같은 제목','참여자 일치'];}
  else if(shared.length>=2&&shared.length/Math.max(a.terms.size,b.terms.size)>=0.5&&(people.length||shared.length>=3)){
   kind='similar_topic';label='비슷한 주제';reasons=[`공통 주제: ${shared.slice(0,3).join(', ')}`,...(people.length?['참여자 일치']:[])];
  }else return null;
 }
 // Header links retain real reply direction even with invalid or skewed dates.
 if((confidence!=='header'||kind==='thread')&&a.stamp>b.stamp)[a,b]=[b,a];
 const chronological=Number.isFinite(a.stamp)&&Number.isFinite(b.stamp)&&a.stamp<b.stamp;
 return {from:a.id,to:b.id,kind,label,confidence,reasons,...(chronological?{chronology:{earlier:a.id,later:b.id,days:Math.round((b.stamp-a.stamp)/DAY*10)/10}}:{}),evidence:[{id:a.id,hash:a.sourceHash||a.hash||null,date:a.date||null},{id:b.id,hash:b.sourceHash||b.hash||null,date:b.date||null}]};
}
function mailRelations(input,{focusId,maxNeighbors=8}={}){
 const rows=input.map(record).filter(r=>r.id),byId=new Map(),byTerm=new Map(),byThread=new Map();
 const put=(map,key,row)=>{const list=map.get(key)||[];list.push(row);map.set(key,list);};
 for(const row of rows){for(const id of [...row.messageIds,...row.parents,...row.refs])put(byId,id,row);for(const term of row.terms)put(byTerm,term,row);if(row.thread)put(byThread,row.thread,row);}
 const edges=new Map();let truncated=false;
 for(const row of focusId?rows.filter(r=>r.id===focusId):rows){
  const candidates=new Map();
  const add=values=>{if(values?.length>160)truncated=true;for(const r of (values||[]).slice(-160)){if(candidates.size<512||candidates.has(r.id))candidates.set(r.id,r);else truncated=true;}};
  for(const id of [...row.messageIds,...row.parents,...row.refs])add(byId.get(id));
  if(row.thread)add(byThread.get(row.thread));
  for(const term of row.terms)add(byTerm.get(term));
  const found=[...candidates.values()].map(other=>pair(row,other)).filter(Boolean).sort((a,b)=>(a.confidence==='header'?0:1)-(b.confidence==='header'?0:1)||(a.chronology?.days??Infinity)-(b.chronology?.days??Infinity)||a.to.localeCompare(b.to));
  if(found.length>maxNeighbors)truncated=true;
  for(const edge of found.slice(0,maxNeighbors)){const key=[edge.from,edge.to].sort().join('\n');if(!edges.has(key))edges.set(key,edge);}
 }
 return {edges:[...edges.values()],truncated};
}
module.exports={mailRelations};
