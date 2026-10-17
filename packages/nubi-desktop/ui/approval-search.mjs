// The portal contract only accepts pageNum. Never send invented search parameters,
// and never report a filtered server page as a search of the whole list.
export const approvalKey=row=>row.id+'|'+row.lineId;
export const emptyApprovalDates=()=>({period:'all',from:'',to:''});
function dateMatches(value,filter,now){
 const time=value?new Date(value).getTime():NaN;
 if(filter.period==='all')return true;
 if(filter.period==='unknown')return !Number.isFinite(time);
 if(!Number.isFinite(time))return false;
 if(filter.period==='custom')return time>=new Date(filter.from+'T00:00:00').getTime()&&time<new Date(filter.to+'T23:59:59.999').getTime()+1;
 return time>=now-Number(filter.period)*86400000&&time<=now;
}
export function createApprovalSearch(api){
 const rows=[],keys=new Map(),titles=new Map();let next=1,total=0,complete=false,tail=Promise.resolve();
 async function title(row){
  const key=approvalKey(row);row=keys.get(key)||row;
  if(!row.titlePending)return row;
  if(!titles.has(key))titles.set(key,api('mail',{action:'approvalTitle',id:row.id,lineId:row.lineId}).then(value=>{Object.assign(row,{subject:value.subject,titlePending:false,titleFailed:false});return row;}).catch(error=>{titles.delete(key);throw error;}));
  return titles.get(key);
 }
 async function search({page=1,size=20,query='',submitted=emptyApprovalDates(),completed=emptyApprovalDates(),sort='server'},progress=()=>{},cancelled=()=>false){
  // Serialize list requests while allowing a newer view to supersede the old one.
  const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;
  const check=()=>{if(cancelled())throw Error('mail_cancelled');};
  try{
   check();const term=query.trim().toLocaleLowerCase(),global=!!term||submitted.period!=='all'||completed.period!=='all'||sort!=='server';
   while(!complete&&(global||rows.length<page*size)){
    check();const packet=await api('mail',{action:'approvals',page:next});check();
    const additions=packet.items.filter(row=>!keys.has(approvalKey(row)));
    if(packet.hasNext&&!additions.length)throw Error('mail_portal_format');
    for(const row of additions){const copy={...row};keys.set(approvalKey(row),copy);rows.push(copy);}
    total=Math.max(rows.length,packet.total||0);complete=!packet.hasNext;next++;
    if(complete)total=rows.length;
    progress({stage:'list',done:rows.length,total});
   }
   check();const now=Date.now();let matches=rows.filter(row=>dateMatches(row.submittedAt,submitted,now)&&dateMatches(row.completedAt,completed,now));
   let unavailable=0;
   if(term||sort.startsWith('subject')){
    const missing=matches.filter(row=>row.titlePending);let cursor=0,done=0,fatal=null;
    const workers=await Promise.allSettled(Array.from({length:Math.min(3,missing.length)},async()=>{
     while(!fatal&&cursor<missing.length){check();const row=missing[cursor++];try{await title(row);}catch(error){if(['mail_portal_login','mail_portal_approval_login','mail_cancelled'].includes(error.message)){fatal=error;throw error;}unavailable++;}check();progress({stage:'title',done:++done,total:missing.length});}
    }));
    const rejected=workers.find(result=>result.status==='rejected');if(rejected)throw rejected.reason;
   }
   check();if(term)matches=matches.filter(row=>!row.titlePending&&row.subject.toLocaleLowerCase().includes(term));
   if(sort!=='server'){
    const [field,direction]=sort.split('-'),sign=direction==='asc'?1:-1;
    matches.sort((a,b)=>{
     if(field==='subject')return sign*a.subject.localeCompare(b.subject,'ko',{numeric:true});
     const key=field==='completed'?'completedAt':'submittedAt',x=new Date(a[key]||'').getTime(),y=new Date(b[key]||'').getTime();
     if(!Number.isFinite(x)||!Number.isFinite(y))return Number.isFinite(x)?-1:Number.isFinite(y)?1:0;
     return sign*(x-y);
    });
   }
   const count=global?matches.length:total,totalPages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,totalPages),offset=(current-1)*size;
   return {items:matches.slice(offset,offset+size).map(row=>({...row})),page:current,total:count,totalPages,offset,unavailable};
  }finally{release();}
 }
 return {search,title};
}
