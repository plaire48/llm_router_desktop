// Empirical repeatability of this fixed suite, not a population probability.
// Unrun/error trials stay in the planned denominator; diagnostic windows are separate.
export function reliabilitySummary(results,plannedTrials) {
  const trials=Math.max(1,plannedTrials),groups=new Map();
  for(const row of results){
    if(row.reducedWindow)continue;
    const key=JSON.stringify([row.suite,row.split,row.id]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const cases=[...groups.values()].map(rows=>{
    const first=rows[0],byTrial=new Map();
    for(const row of rows){
      if(!Number.isInteger(row.trial)||row.trial<1||row.trial>trials)continue;
      // A duplicate trial is invalid evidence, never a second success.
      byTrial.set(row.trial,byTrial.has(row.trial)?null:row);
    }
    const observed=[...byTrial.values()],passed=observed.filter(row=>row?.outcome==='passed'&&!row.falseCompletion).length;
    return {id:first.id,suite:first.suite,split:first.split,planned:trials,
      executed:observed.filter(row=>row&&row.outcome!=='not_run').length,passed,
      allPassed:trials>=2&&passed===trials};
  });
  const times=results.filter(row=>!row.reducedWindow&&row.outcome!=='not_run'&&Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0).map(row=>row.elapsedMs).sort((a,b)=>a-b);
  const percentile=fraction=>times.length?times[Math.max(0,Math.ceil(times.length*fraction)-1)]:null;
  return {plannedTrials:trials,repeatedCases:trials>=2?cases.length:0,allPassedCases:cases.filter(row=>row.allPassed).length,
    allPassedRate:trials>=2&&cases.length?cases.filter(row=>row.allPassed).length/cases.length:null,
    cases,latency:{samples:times.length,p50Ms:percentile(.5),p95Ms:percentile(.95)}};
}
