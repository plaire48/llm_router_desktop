// Host observations only. Stage percentages are never promoted to an overall
// completion estimate: plans can grow and generation can return to review.
export const wikiProgressSteps=['자료 읽기','구성 정리','작성 검토','저장 확인'];
const labels={selecting_scope:'분석 범위 선택',syncing:'코드 동기화',preparing_runtime:'실행기 확인',preparing_skills:'준비 파일 연결',scanning:'파일 목록 확인',reading:'파일 읽기',snapshot:'분석 준비',snapshot_git:'분석 기준 준비',planning:'구성 분석',replanning:'구성 다시 분석',generating:'문서 작성',reviewing:'내용 검토',finalizing:'문서 검토',publishing:'저장 확인'};
const gitSteps={repository:'분석 저장소 준비',sources:'분석 파일 복사',index:'파일 변경 확인',commit:'분석 기준 저장',history:'분석 이력 복사',worktree:'분석 공간 연결',verify:'분석 기준 확인'};
const countStages=new Set(['reading','snapshot','snapshot_git','generating','reviewing','publishing']);
const fileStages=new Set(['reading','snapshot','snapshot_git','publishing']);
export function wikiProgress(job={}){
 job||={};
 const stage=job.stage||'scanning',saved=['completed','existing','applied'].includes(job.state);
 const step=saved?4:stage==='publishing'?3:['generating','reviewing','finalizing'].includes(stage)?2:['planning','replanning'].includes(stage)?1:0;
 const label=stage==='snapshot_git'?(gitSteps[job.gitStep]||labels[stage]):labels[stage]||'준비';
 const total=countStages.has(stage)&&Number.isSafeInteger(job.total)&&job.total>0?job.total:null;
 const completed=total!==null&&Number.isSafeInteger(job.completed)&&job.completed>=0?Math.min(total,job.completed):null;
 const percent=completed===null?null:Math.floor(100*completed/total),remaining=completed===null?null:total-completed;
 const unit=fileStages.has(stage)?'개 파일':'개 문서';
 const quantity=completed!==null?`${completed.toLocaleString()}/${total.toLocaleString()}${unit}`:stage==='scanning'&&Number.isSafeInteger(job.completed)&&job.completed>0?`파일 ${job.completed.toLocaleString()}개 확인`:null;
 const remainingLabel=remaining===null?null:remaining>0?`${remaining.toLocaleString()}${unit} 남음 (${100-percent}%)`:`${label} 처리 완료`;
 const nextLabel=saved?'위키에서 바로 볼 수 있어요.':stage==='publishing'?'저장 결과 확인 후 위키에서 볼 수 있어요.':step===2?'내용 검토와 저장 확인 후 완료됩니다.':step===1?'구성을 확정하면 작성할 문서 수를 보여드려요.':'자료를 읽은 뒤 구성과 작성할 문서 수를 확인합니다.';
 return {step,label,quantity,remainingLabel,nextLabel,completed,total,percent,remaining,saved,
  phase:`${job.id||''}:${stage}:${job.gitStep||''}:${job.stageStartedAt||''}:${job.scope?.rounds?.done??''}`,
  summary:[label,completed!==null?`${completed.toLocaleString()}/${total.toLocaleString()}개`:quantity].filter(Boolean).join(' ')};
}
export function wikiUpdateProgress(update={}){
 const events=(update.events||[]).filter(event=>event.type==='progress'),last=events.at(-1);
 let first=events.length-1;while(first>0&&events[first-1].stage===last.stage)first--;
 return wikiProgress({...update,stage:last?.stage||update.stage,completed:last?.completed,total:last?.total,stageStartedAt:events[first]?.at||update.startedAt});
}
