/** Evaluation host policy: each selected model must cover every rendered page. */
export function summarizeImageReviews(reviews,pages,providers){
 const coverage=providers.map(provider=>new Set(reviews.filter(r=>r.provider===provider).flatMap(r=>r.result.reviewedPages)));
 const reviewed=pages.filter(page=>coverage.every(set=>set.has(page))),allReviewed=reviewed.length===pages.length&&providers.length>0;
 return{reviewed,allReviewed,allFacts:allReviewed&&reviews.every(r=>r.result.factsPassed),visual:allReviewed&&reviews.every(r=>r.result.visualPassed),findings:reviews.flatMap(r=>r.result.findings)};
}
export function unobservedVisualFindings(review,pages,domain){return domain==='powerpoint'?review.findings.filter(f=>{const slide=/^\/slides\/(\d+)(?:\/|$)/.exec(f.path);return f.kind!=='facts'&&slide&&!pages.includes(Number(slide[1])+1);}):[];}
