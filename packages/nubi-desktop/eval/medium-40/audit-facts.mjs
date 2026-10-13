// Post-run audit only. The frozen v1 grade and raw report are never overwritten.
// Retain separators so "14:30, 301호" does not turn into "14:30301호".
const clean=value=>String(value??'').normalize('NFKC').toLowerCase()
 .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
 .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'')
 .replace(/(?<![\w.])(\d+)\.0+(?=%)/g,'$1')
 .replace(/[*_`]/g,'').replace(/[|]/g,' ')
 .replace(/(?<!\d)(\d{4})\s*년\s*(1[0-2]|0?[1-9])\s*월\s*(3[01]|[12]\d|0?[1-9])\s*일/gu,(_,y,m,d)=>`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`)
 .replace(/(?<=[가-힣]):/g,' ');
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function auditedFact(text,alternatives){
 const answer=clean(text);
 return alternatives.some(value=>{
  const fact=clean(value).replace(/\s/g,'');
  let body=[...fact].map(escape).join('\\s*');
  if(/^(성공|실패)\d+$/.test(fact))body=body.replace(/\\s\*(?=\d)/,'(?:은|는|이|가)?\\s*');
  const date=/^\d{4}-\d{2}-\d{2}$/.test(fact);
  return new RegExp((/^\d/.test(fact)?'(?<![\\d.])':'')+body+(/\d$/.test(fact)?date?'(?![\\d])':'(?![\\d.])':''),'u').test(answer);
 });
}
