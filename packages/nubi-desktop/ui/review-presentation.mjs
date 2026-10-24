const labels={revise:'결과를 보완하고 있어요',failed:'결과 검토를 마치지 못했어요',interrupted:'결과 검토가 중단됐어요',cancelled:'결과 검토가 중지됐어요'};
export function reviewPresentation(review,running=false){
 const active=running&&review.state==='running',allChecks=review.checks||[];
 const checks=allChecks.filter(check=>!check.requirementId?.startsWith('intent:'));
 const advisoryChecks=allChecks.filter(check=>check.requirementId?.startsWith('intent:'));
 const unresolved=checks.filter(check=>check.state!=='supported');
 const advisoryNextStep=review.normalized==='interpretation_only'&&!unresolved.length&&advisoryChecks.some(check=>check.state!=='supported')?review.nextStep:'';
 const nextStep=advisoryNextStep?'':review.nextStep;
 const supported=review.state==='ready'&&checks.length>0&&!unresolved.length&&!review.omittedHandoffs&&!review.omittedUnresolvedHandoffs&&!nextStep;
 const visible=active||review.state!=='ready'||allChecks.length>0||!!(review.nextStep||review.omittedHandoffs||review.omittedUnresolvedHandoffs||review.reason);
 const gap=unresolved.find(check=>check.state==='unknown'&&check.detail)?.detail||unresolved.find(check=>check.detail)?.detail;
 const omitted=review.omittedUnresolvedHandoffs||review.omittedHandoffs;
 const heading=active?'답변과 근거를 대조하고 있어요':supported?`확인한 근거 ${checks.length}개`:labels[review.state]&&review.state!=='revise'?labels[review.state]
  :gap||nextStep||(omitted?`확인하지 못한 분석 ${omitted}개`:unresolved.length?`실행 근거가 없는 항목 ${unresolved.length}개`:advisoryChecks.length?`추가 점검 ${advisoryChecks.length}개`:'검증 기록이 없어요');
 return {visible,supported,heading,checks,advisoryChecks,unresolved,nextStep,advisoryNextStep,tone:active?'active':review.state==='failed'?'warning':'neutral',icon:active?'search':review.state==='failed'?'alertCircle':'infoCircle'};
}
