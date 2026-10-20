// Evaluation-only representation repair. A negative verdict never gains proof.
// The original raw response and the repaired representation are stored separately.
import {parseSearchReview} from './wiki-search-model.mjs';
export function normalizeReviewCitations(content,packet){
 let value;try{value=JSON.parse(content);}catch{throw Error('search_review_invalid');}
 let changed=0;
 for(const row of Array.isArray(value?.judgements)?value.judgements:[])for(const claim of Array.isArray(row?.claims)?row.claims:[]){
  if(claim&&['unsupported','unverifiable'].includes(claim.verdict)&&!Object.hasOwn(claim,'citations')){claim.citations=[];changed++;}
 }
 const normalized=JSON.stringify(value),judgements=parseSearchReview(normalized,packet,{invalidCitation:'unverifiable'});
 return {changed,normalized,judgements};
}
