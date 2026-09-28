// Present only observed state. Retry counts and unverified drafts are not completion.
export function taskView(run, {input, approval, stopping = false} = {}) {
  const host=({word:'Word',powerpoint:'PowerPoint'})[run?.host]||'Excel';
  const steps = run?.plan?.steps || [], completed = steps.filter(step => step.state === 'done').length;
  const current = steps.find(step => step.state !== 'done');
  const active = run?.state === 'running' || !run;
  let state = run?.state || 'starting', label = '작업 준비 중', hint = '', action = '';
  if (active && stopping) {state = 'stopping'; label = '중지 요청 중'; hint = `이미 반영된 내용은 ${host}에서 확인할 수 있습니다.`;}
  else if (active && (approval?.payload?.kind === 'recovery' || run?.phase === 'awaiting_recovery' || run?.recovery?.state === 'paused')) {state = 'awaiting_recovery'; label = '자동 재시도 멈춤'; hint = '계속할지 확인해 주세요.'; action = '복구 방법 확인';}
  else if (active && run?.recovery?.state === 'waiting') {state = 'retry_wait'; label = '재요청 대기'; hint = '대기 후 상태를 다시 확인합니다.';}
  else if (active && input?.sending) {state = 'awaiting_receipt'; label = '답변 전달 확인 중'; hint = '보낸 답변의 수신 여부를 확인하고 있습니다.';}
  else if (active && (approval || run?.phase === 'awaiting_approval')) {state = 'awaiting_approval'; label = '반영 전 확인 대기'; hint = '대상과 변경 내용을 확인해 주세요.'; action = '반영 내용 확인';}
  else if (active && (input || run?.phase === 'awaiting_input')) {state = 'awaiting_input'; label = '답변 대기'; hint = '질문에 답하면 같은 작업을 이어갑니다.'; action = '답변 입력';}
  else if (run?.state === 'running') {label = '진행 중'; hint = current?.title || run.activity?.findLast(event => event.state === 'running')?.title || '실행 결과를 확인하고 있습니다.';}
  else if (run?.state === 'done') label = '작업 완료';
  else if (run?.state === 'failed') {label = '확인 필요'; hint = `진행 기록과 ${host}의 반영 결과를 확인해 주세요.`;}
  else if (run?.state === 'cancelled') label = '작업 중지';
  else if (run?.state === 'awaiting_user') {label = '답변 대기'; action = '답변 입력';}
  else if (run?.state === 'unsupported') {label = '지원 범위 확인 필요'; hint = '아래 안내를 확인해 주세요.';}
  const waiting = ['awaiting_input', 'awaiting_receipt', 'awaiting_approval', 'awaiting_recovery', 'awaiting_user', 'retry_wait', 'stopping'].includes(state);
  let summary = '';
  if (run?.state === 'done') summary = run.kind === 'document'||run.kind==='office'&&run.task?.save ? (run.artifact?.saved ? '문서 검토와 파일 저장을 마쳤습니다.' : '파일 저장 확인이 필요합니다.') : run.registeredTemplate?.saved ? '양식 사본과 분석 명세 확인을 마쳤습니다.' : run.writes ? '변경 결과와 요청 조건을 확인했습니다.' : run.kind==='office'?'분석을 마쳤습니다. 문서를 변경하지 않았습니다.':'분석을 마쳤습니다. 셀을 변경하지 않았습니다.';
  if (['failed', 'cancelled'].includes(run?.state)) summary = `${completed}개 단계의 완료가 확인됐습니다.${current ? ` 남은 단계: ${current.title}` : ''}`;
  return {state, label, hint, action, waiting, working: active && !waiting, completed, total: steps.length, summary,
    icon: state === 'done' ? 'check' : ['failed','unsupported','awaiting_recovery'].includes(state) ? 'alertCircle' : state === 'cancelled' || state === 'stopping' ? 'minus' : state === 'awaiting_input' || state === 'awaiting_user' ? 'message' : 'clock',
    planStatus: waiting ? 'awaiting_user' : ['failed', 'cancelled', 'unsupported'].includes(state) ? 'paused' : run?.state,
    tone: state === 'done' ? 'success' : state === 'failed' ? 'danger' : waiting ? 'warning' : active ? 'active' : 'neutral'};
}

// Session state fences stale tool events. Stopping a spinner never invents a receipt.
export function activityView(event, run, view=taskView(run), now=Date.now()) {
  let status=event.state;
  if (['running','waiting'].includes(status)) {
    if (run.state!=='running') status=run.state==='awaiting_user'?'waiting':'unconfirmed';
    else if (view.waiting) status='waiting';
  }
  const label=({running:'진행 중',done:'완료',error:'실행 실패',waiting:'대기 중',recovered:'복구 확인',cancelled:'중지',unconfirmed:'결과 미확인'})[status]||'기록';
  const end=Number.isFinite(event.endedAt)?event.endedAt:status==='running'&&view.working?now:null;
  const seconds=end!==null&&Number.isFinite(event.startedAt)&&end>=event.startedAt?Math.floor((end-event.startedAt)/1000):null;
  return {status,label,seconds};
}

export function recentActivity(activity = [], limit = 5) {
  const visible = activity.filter(event => !(event.kind === 'model' && event.state === 'done'));
  const recent = visible.filter((event, index) => index >= visible.length - limit || ['running', 'waiting'].includes(event.state));
  const ids = new Set(recent.map(event => event.id));
  return {recent, previous: visible.filter(event => !ids.has(event.id))};
}

export function reviewWorkerView(run,key='reviewWorkers'){
  const nodes=run?.[key]?.nodes;
  if(!Array.isArray(nodes)||!nodes.length)return null;
  const visible=nodes.map(node=>{
    let state=node.state;
    if(['running','waiting','pending','blocked'].includes(state)&&run.state!=='running')state='unconfirmed';
    else if(state==='running'&&taskView(run).waiting)state='waiting';
    return {...node,state,dependencies:(node.dependsOn||[]).map(id=>nodes.find(candidate=>candidate.taskId===id)?.title||id)};
  });
  const count=phase=>{const group=visible.filter(node=>node.phase===phase);return `${group.filter(node=>node.state==='done').length}/${group.length}`;};
  const attention=visible.filter(node=>['waiting','error'].includes(node.state)).length;
  const blocked=visible.filter(node=>node.state==='blocked').length;
  const delegationSummary=[`분석 ${count('delegation')}`,attention?`확인 필요 ${attention}`:null,blocked?`대기 ${blocked}`:null].filter(Boolean).join(' / ');
  return {summary:key==='delegationWorkers'?delegationSummary:`구간 검토 ${count('partition')} / 통합 검토 ${count('reduction')}`,nodes:visible,
    active:visible.filter(node=>['running','error','waiting'].includes(node.state))};
}
