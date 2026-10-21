// Shared presentation only. Canonical IDs still go to the existing host.
const LABELS=Object.freeze({none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Max'});
const OVERRIDES=Object.freeze({chatgpt:{low:'Light',max:'Ultra'},claude:{xhigh:'Xhigh'}});
export function reasoningLabel(provider,id){return id==null?'서버 기본':OVERRIDES[provider]?.[id]||LABELS[id]||id;}
export const REASONING_OPTIONS=Object.freeze(Object.fromEntries(Object.entries({aipro:['low','medium','high','xhigh','max'],chatgpt:['low','medium','high','xhigh','max'],claude:['low','medium','high','xhigh','max']}).map(([provider,ids])=>[provider,ids.map(id=>({id,label:reasoningLabel(provider,id)}))])));
export const REASONING_DEFAULTS=Object.freeze({aipro:'medium',chatgpt:'medium',claude:'medium'});
