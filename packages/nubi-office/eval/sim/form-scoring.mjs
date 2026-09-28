// Deterministic grading of a proposed field mapping against the answer key.
// Labels are not graded here: wording is a semantic judgement for a reviewer.
const key=address=>String(address||'').replaceAll('$','').toUpperCase();

export function scoreMapping(proposed,gold){
  const answers=new Map(gold.map(item=>[key(item.address),item])),matched=new Set(),unexpected=[],wrongType=[],wrongRequired=[];
  for(const item of Array.isArray(proposed)?proposed:[]){
    const address=key(item?.address),answer=answers.get(address);
    if(!answer||matched.has(address)){unexpected.push(address);continue;}
    matched.add(address);
    if(item.valueType!==answer.valueType)wrongType.push({address,expected:answer.valueType,actual:item.valueType});
    if(item.required!==answer.required)wrongRequired.push({address,expected:answer.required,actual:item.required});
  }
  const count=Array.isArray(proposed)?proposed.length:0,missing=gold.map(item=>key(item.address)).filter(address=>!matched.has(address));
  const precision=count?matched.size/count:0,recall=gold.length?matched.size/gold.length:0,exact=!missing.length&&!unexpected.length&&!wrongType.length;
  return{proposed:count,gold:gold.length,matched:matched.size,precision,recall,f1:precision+recall?2*precision*recall/(precision+recall):0,missing,unexpected,wrongType,wrongRequired,exact,strict:exact&&!wrongRequired.length};
}
