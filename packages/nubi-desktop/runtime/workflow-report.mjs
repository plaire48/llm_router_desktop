import {safeText} from './conversation-export.mjs';
import {secretLike} from './secret-like.mjs';
import {cleanModelText} from './model-text.mjs';
import {completionLabel} from './workflow-completion.mjs';
import {expandStepTools} from './workflow-tools.mjs';

function value(input){
 const raw=String(input??''),normalized=cleanModelText(raw),redacted=safeText(normalized);
 // Mask the whole field when a multi-line credential was detected.
 return secretLike(raw)||secretLike(normalized)||redacted.includes('[인증값 포함 내용 숨김]')?'[인증값 포함 내용 숨김]':redacted;
}
const text=(input,limit=Infinity)=>value(input).slice(0,limit).replace(/[\\`*_{}\[\]()#+!|<>]/g,char=>char==='<'?'&lt;':char==='>'?'&gt;':'\\'+char);
const code=input=>'`'+value(input).replace(/`/g,"'")+'`';
const status={running:'실행 중',waiting:'대기',unconfirmed:'미확정',complete:'완료',partial:'일부 완료',failed:'실패',cancelled:'중단',skipped:'건너뜀',pending:'미실행'};
function stepStatus(run,checkpoint){
 if(!checkpoint)return run.status==='complete'?'분기 미선택':'미실행';
 if(checkpoint.status==='running'&&['partial','failed','cancelled'].includes(run.status))return '미완료';
 return status[checkpoint.status]||'확인 필요';
}
export function workflowReport(run){
 const synthetic=run.mode==='dry-run',rows=[`# ${text(run.workflow.name)}`,
  `- 상태: ${status[run.status]||'확인 필요'}`,`- 방식: ${synthetic?'합성 시험 (dry-run)':'실제 실행'}`,
  ...(synthetic?['합성 fixture로 단계 순서와 검증 조건을 확인했습니다.']:[]),'<details>\n<summary>실행 정보</summary>\n',`- 실행: ${code(run.id)}`,
  `- 버전: ${code(run.version)}`,`- 정의 해시: ${code(run.hash)}`,`- 트리거: ${code(run.trigger?.kind||'manual')}`,
  ...(run.createdAt?[`- 시작: ${text(run.createdAt)}`]:[]),...(run.finishedAt?[`- 종료: ${text(run.finishedAt)}`]:[]),
  '</details>',...(run.warnings?.length?['## 확인할 근거',...run.warnings.map(warning=>'- '+code(warning))]:[])];
 if(Number.isFinite(run.workflow.metrics?.expectedMinutes))rows.push(`- 원본 예상 업무시간: ${run.workflow.metrics.expectedMinutes}분${run.workflow.metrics.partial?' (일부 단계 추정)':''}`);
 const elapsed=(Date.parse(run.finishedAt)-Date.parse(run.createdAt))/60000;if(!synthetic&&Number.isFinite(elapsed)&&elapsed>=0)rows.push(`- 실행 경과: ${Math.round(elapsed*100)/100}분`);
 if(run.workflow.notes?.length)rows.push('## 원본 참고',...run.workflow.notes.map(note=>text(note.content)));
 rows.push('## 단계');
 for(const [index,step] of run.workflow.steps.entries()){
  const checkpoint=run.steps[step.id];rows.push(`### ${index+1}. ${text(step.name||step.id)}`,`- 상태: ${stepStatus(run,checkpoint)}`);
  if(step.done_when)rows.push(`- 완료 조건: ${text(completionLabel(step.done_when))}`);
  if(step.action_summary)rows.push(`- 동작: ${text(step.action_summary)}`);
  if(checkpoint?.answer!==undefined){const label=step.outputs?.decision?.includes(checkpoint.answer)?{approve:'진행',stop:'중단'}[checkpoint.answer]:undefined;rows.push(`- 사람 답: ${label?label+' ('+text(checkpoint.answer)+')':text(checkpoint.answer)}`);}
  if(checkpoint?.receipts?.length)rows.push(`- ${synthetic?'합성 영수증':'영수증'}: ${checkpoint.receipts.map(code).join(', ')}`);
  if(checkpoint?.output?.summary)rows.push(`- 결과: ${text(checkpoint.output.summary,500)}`);
  if(checkpoint?.outputRef)rows.push(`- 결과 참조: ${code(checkpoint.outputRef.key)}`);
  if(checkpoint?.reason)rows.push(`- 사유: ${code(checkpoint.reason)}`);
  if(checkpoint?.cachedRunId)rows.push(`- 이전 실행: ${code(checkpoint.cachedRunId)}`);
  if(checkpoint?.cachedFrom)rows.push(`- 재사용한 완료 단계: ${code(checkpoint.cachedFrom)}`);
  if(step.kind==='agent'){
   const expanded=expandStepTools(step.tools),resolved=step.resolvedTools||expanded.tools;
   const added=resolved.filter(tool=>!step.tools.includes(tool)).map(tool=>expanded.added.find(row=>row.tool===tool)||{tool,because:'저장된 호스트 목록'});
   rows.push('<details>\n<summary>사용 도구</summary>\n',`작성자가 고른 도구: ${step.tools.map(code).join(', ')||'없음'}`,
    `호스트가 보탠 선행 도구: ${added.map(row=>`${code(row.tool)} (${row.because==='workflow_step'?'모든 에이전트 단계':code(row.because)})`).join(', ')||'없음'}`,'</details>');
  }
 }
 rows.push('## 미해결');
 const unresolved=run.workflow.steps.filter(step=>!['complete','skipped'].includes(run.steps[step.id]?.status));
 if(run.status==='complete')rows.push('없음');
 else{if(run.reason)rows.push(`- 중단 이유: ${code(run.reason)}`);for(const step of unresolved)rows.push(`- ${text(step.name||step.id)}: ${stepStatus(run,run.steps[step.id])}${run.steps[step.id]?.reason?' ('+code(run.steps[step.id].reason)+')':''}`);}
 return rows.join('\n\n')+'\n';
}
