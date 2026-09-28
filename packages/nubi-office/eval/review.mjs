import {createHash} from 'node:crypto';

// The evaluation result, source and model are bound together. This detects
// stale/mismatched reviews; it is not authentication of the human reviewer.
export function reviewEvidence(report,result){
  return createHash('sha256').update(JSON.stringify({sourceHash:report.sourceHash,caseVersion:report.caseVersion,provider:report.provider,model:report.model,startedAt:report.startedAt,host:report.host,analysisConcurrency:report.analysisConcurrency,result})).digest('hex');
}
export function reviewTemplate(report){
  if(report.status!=='measured')throw new Error('review_report_not_measured');
  return report.cases.filter(result=>result.passed===null&&result.deterministicPassed===true).map(result=>({kind:'human-review',caseId:result.id,reviewer:'',evidenceHash:reviewEvidence(report,result),criteria:result.semanticReview.criteria.map((text,index)=>({index,criterion:text,passed:null,reason:'',evidence:''}))}));
}
export function applyHumanReviews(report,reviews){
  if(report.status!=='measured'||!Array.isArray(reviews))throw new Error('review_report_not_measured');
  const updated=structuredClone(report),seen=new Set();
  for(const review of reviews){
    const original=report.cases.find(item=>item.id===review.caseId),target=updated.cases.find(item=>item.id===review.caseId);
    if(!original||seen.has(review.caseId)||original.passed!==null||original.deterministicPassed!==true||original.semanticReview?.status!=='pending')throw new Error('review_case_not_pending');
    seen.add(review.caseId);
    if(review.kind!=='human-review'||typeof review.reviewer!=='string'||!review.reviewer.trim()||review.evidenceHash!==reviewEvidence(report,original))throw new Error('review_evidence_mismatch');
    const criteria=original.semanticReview.criteria;
    if(!criteria?.length||!Array.isArray(review.criteria)||review.criteria.length!==criteria.length)throw new Error('review_criteria_missing');
    for(let i=0;i<criteria.length;i++){
      const verdict=review.criteria[i];
      if(verdict.index!==i||typeof verdict.passed!=='boolean'||typeof verdict.reason!=='string'||!verdict.reason.trim()||typeof verdict.evidence!=='string'||!verdict.evidence.trim())throw new Error('review_criteria_missing');
    }
    target.semanticReview={...target.semanticReview,status:'reviewed',reviewer:review.reviewer,verdicts:review.criteria,evidenceHash:review.evidenceHash};
    target.passed=review.criteria.every(c=>c.passed);target.outcome=target.passed?'passed':'failed';
  }
  updated.accuracy={passed:updated.cases.filter(c=>c.passed===true).length,failed:updated.cases.filter(c=>c.passed===false).length,pending:updated.cases.filter(c=>c.passed===null).length,total:updated.cases.length};
  updated.reviewLimitations=['Human identity is recorded but not authenticated by this local file workflow.','Reviews cannot override failed deterministic workbook checks.'];
  return updated;
}
