const aborted=signal=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
function pause(ms,signal) {
  return new Promise((resolve,reject)=>{
    aborted(signal);
    const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});
  });
}

// Audit indexing can lag behind a confirmed membership save. Retry reads only;
// never infer an audit date or actor from the browser or a Role notice issue.
export async function refreshTeamHistory(load,users,{expected,refresh=false,signal,wait=pause}={}) {
  for(let attempt=0;attempt<3;attempt++) {
    aborted(signal);
    const result=await load(users,{refresh:refresh&&attempt===0,signal});
    aborted(signal);
    const event=expected&&result.items.find(item=>item.userId===expected.userId);
    const waiting=Boolean(expected&&result.available!==false&&(!event||expected.after&&Date.parse(event.date)<=Date.parse(expected.after)||expected.notBefore&&Date.parse(event.date)<Date.parse(expected.notBefore)));
    if(!waiting||attempt===2)return {...result,waiting};
    await wait((attempt+1)*1000,signal);
  }
}

// The receipt contains the original confirmed-save time. An issue creation or
// update timestamp must never substitute for a team-change timestamp.
export function mergeTeamHistory(auditItems,confirmedItems) {
  const latest=new Map(auditItems.map(item=>[item.userId,item]));
  for(const item of confirmedItems){
    const previous=latest.get(item.userId);
    const confirmed=previous&&['save','receipt'].includes(previous.source);
    if(confirmed&&Date.parse(previous.date)>=Date.parse(item.date))continue;
    if(previous&&!confirmed&&Date.parse(previous.date)>=Date.parse(item.startedAt))continue;
    latest.set(item.userId,item);
  }
  return [...latest.values()];
}

export function createRestoredTeamHistory({audit,receipts}) {
  return async(users,options={})=>{
    const [auditResult,receiptResult]=await Promise.allSettled([audit(users,options),receipts(users,options)]);
    options.signal?.throwIfAborted();
    if(auditResult.status==='rejected'&&receiptResult.status==='rejected')throw auditResult.reason;
    const audited=auditResult.status==='fulfilled'?auditResult.value:{items:[],available:false};
    const recorded=receiptResult.status==='fulfilled'?receiptResult.value:{items:[],limited:false};
    return {...audited,items:mergeTeamHistory(audited.items,recorded.items),limited:Boolean(audited.limited||recorded.limited),
      receiptUnavailable:receiptResult.status==='rejected'};
  };
}
