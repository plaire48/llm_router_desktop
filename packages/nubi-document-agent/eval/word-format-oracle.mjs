const array=x=>x===undefined?[]:Array.isArray(x)?x:[x];
const find=(x,key)=>!x||typeof x!=='object'?[]:Object.entries(x).flatMap(([k,v])=>k===key?array(v):array(v).flatMap(n=>find(n,key)));
const text=x=>find(x,'w:t').map(v=>typeof v==='object'?String(v['#text']??''):String(v)).join('');
/** Explicit direct color only. Inheritance/theme resolution requires a separate oracle. */
export function hasDirectTextColor(document,needle,color){
 const matches=find(document,'w:p').filter(p=>text(p)===needle);if(matches.length!==1)return false;
 const runs=find(matches[0],'w:r').filter(r=>text(r).trim());return runs.length>0&&runs.every(r=>r['w:rPr']?.['w:color']?.['@_w:val']===color);
}
