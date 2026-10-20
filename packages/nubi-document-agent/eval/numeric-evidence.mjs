/** Numeric evidence only, not a semantic quality score. Formatting does not change value. */
export function containsNumber(text,value){return [...text.matchAll(/[-−]?\d+(?:,\d{3})*(?:\.\d+)?/g)].some(m=>Math.abs(Number(m[0].replaceAll(',','').replace('−','-'))-value)<1e-8);}
