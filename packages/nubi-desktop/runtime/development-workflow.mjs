// Workflow guidance is not permission. Existing proposal/MCP approval owns
// every write; host receipts, not this plan, establish what actually happened.
export function afterEditCheckAction({setting,applied,taskId}){
  if(!setting?.script||!applied?.length)return null;
  return {kind:'verify',taskId,profile:setting.profile,script:setting.script,
    title:('편집 뒤 검사: '+setting.script).slice(0,120),reason:'프로젝트에 설정한 편집 뒤 검사',
    effects:'설정한 명령을 실행해요. 명령에 따라 파일이나 실행 환경이 바뀔 수 있어요.',
    verification:'반영 이후의 종료 코드와 출력을 확인하고 요청한 검증 결과와 대조합니다.',
    after:[...new Set(applied.map(p=>p.path))]};
}

export function needsDevelopmentGuidance(task,actions=[]){
  // Routing hint only, never a permission or completion decision. Keep this
  // longer workflow out of ordinary lookups and small-window conversations.
  const request=(task.messages||[]).findLast(m=>m.role==='user')?.content||task.request||'';
  return !!task.changePlan||task.workPlan?.intent?.workflowIds?.includes('source-change')||
    actions.some(a=>a.taskId===task.id&&['start','verify'].includes(a.kind)&&['proposed','started'].includes(a.state))||
    /개발|구현|버그|회귀|프론트|백엔드|웹\s*앱|웹\s*서버|테스트|타입|호출자|참조|정의|\b(?:implement|develop|debug|regression|frontend|backend|webapp|server|tests?|playwright|typecheck|npx|npm|pnpm)\b/i.test(request);
}
export const DEVELOPMENT_GUIDANCE=`For development requests, deliver a working, checked result, not just code or a proposal. Derive observable checks from the requested behavior and record them in record_change_plan. For behavior changes add a meaningful regression test where feasible; do not create tautological tests or weaken assertions to pass. Small copy-only changes need proportionate inspection, not a new test framework. Respect explicit no-run/source-only requests.
After application, execute relevant tests through propose_setup_action(kind=verify), read their results and repair failures in the same task. For a web app also inspect its actual start configuration, reuse an observed healthy server or propose_setup_action(kind=start). The host resumes while that server is running: inspect its process output, using read_process_output(waitMs<=5000) for fresh output when necessary. Use open_development_preview with the observed processId to check HTTP and open or reuse the same bound in-app preview with fresh DOM. Opening a new tab uses the existing Playwright approval. Use its tabId, documentId and observed refs with the existing Playwright tools; the host routes them through the independent browser-agent module and keeps input approval and durable receipts. Do not open a duplicate tab with browser_open when a bound preview exists. If this tool is unavailable, use inspect_dev_server and the existing page-opening path, explicitly retaining that narrower verification scope. For commands that need terminal interaction set interactive=true in the approved setup action. Read read_process_output first, then propose_process_input with that inputRevision and exact text including newline; new input requires its own approval. Never enter credentials or treat input acceptance as task success. Use inspect_code for scoped JS/TS diagnostics and definitions/references; its snapshot omits installed dependencies and tsconfig, so also run the project typecheck when relevant. Do not wait for server exit, start duplicates, guess a port, kill an unrelated listener or call startup logs functional success. An occupied port requires identifying the owner or proposing a different port.
Prefer the bound preview from open_development_preview. For legacy hosts use open_workspace_page or built-in Playwright browser_open for the observed local URL. Select the actual Playwright MCP tools from the catalog, read a fresh snapshot, exercise the requested input/click flow under existing approvals and read the resulting page state. Compare expected with actual behavior, including relevant empty/error cases. Use capture for layout checks, including narrow widths when relevant; opening a tab or a screenshot alone is not behavioral verification. Tests must exercise the changed behavior on the applied version. CLI/library work uses its appropriate execution checks, not an unnecessary web server. If tools, authentication or dependencies block verification, state the exact missing check and preserve the work; never invent a pass.
Keep command output, process IDs and verification results in this conversation. Leave a healthy preview running for the user and report its observed URL and existing stop control. End with the delivered result first, then concise verified outcomes and material limitations. Continue authorized missing work; do not end with 'development complete' while verification is merely planned.`;

export const DEVELOPMENT_REVIEW_GUIDANCE='For active developmentChecks, match each requested behavior to post-application test output and browser readback as appropriate. A verify command must actually test that behavior; exit zero from echo/version/build is not a test pass. A browser snapshot must show the expected result after the required interaction; opening/navigation/capture alone is insufficient. eligibleEvidenceIds and eligibleProcessIds are only provenance candidates, not a semantic pass. Use the latest run of each verification, including approved repairs; an earlier pass cannot override a later failure or unfinished run. Unknown/missing checks require continuing authorized work, or a truthful concrete blocker/approval handoff. Never certify all development checks from one unrelated successful command. Respect currentTurn changes of scope.';

export function developmentChecks(task,receipts){
  const servers=(receipts?.setupActions||[]).filter(action=>action.taskId===task.id&&action.kind==='start'&&action.state==='started'&&action.resultProcessId&&/서버|미리보기|웹|\b(?:server|preview|web)\b/i.test([task.request,action.title,action.verification].join(' '))).map(action=>({method:'server',requirementId:'host:server',description:'실행한 서버의 실제 HTTP 응답 확인',processId:action.resultProcessId,after:Date.parse(action.createdAt)}));
  const plan=task.changePlan;
  if(!plan?.createdAt||!Array.isArray(plan.checks))return servers;
  const answers=new Set((task.questionHistory||[]).map(q=>q.answer?.text));
  const latest=(task.messages||[]).findLast(m=>m.role==='user'&&m.at&&!answers.has(m.content));
  if(latest?.at>plan.createdAt)return []; // A later user turn can change scope.
  const applied=(receipts?.proposals||[]).filter(p=>p.state==='applied'&&plan.targets?.some(t=>t.path===p.path)&&p.createdAt>=plan.createdAt);
  if(!applied.length)return servers;
  // Missing legacy timestamps cannot certify a later test as post-application.
  const after=applied.every(p=>Number.isFinite(Date.parse(p.appliedAt)))?Math.max(...applied.map(p=>Date.parse(p.appliedAt))):null;
  return [...servers,...plan.checks.filter(c=>['test','browser'].includes(c.method)).map(c=>({method:c.method,requirementId:c.requirementId,description:c.description,after}))];
}

// Only host-created repairOf links carry a verify action through a corrected
// command. Do not infer this from titles, output text or model claims. Keep
// independent commands separate, but never resurrect a superseded pass.
function currentVerifications(host){
  const processes=host?.processes||[],byId=new Map(processes.map(p=>[p.id,p]));
  const actions=new Map((host?.setupActions||[]).filter(a=>a.kind==='verify'&&a.state==='started').map(a=>[a.resultProcessId,a]));
  function origin(process,seen=new Set()){
    if(!process||seen.has(process.id))return null;
    seen.add(process.id);
    if(actions.has(process.id))return actions.get(process.id);
    return process.repairOf?origin(byId.get(process.repairOf),seen):null;
  }
  const runs=processes.map(p=>({process:p,action:origin(p)})).filter(r=>r.action);
  const superseded=new Set();
  for(const {process} of runs){
    const seen=new Set([process.id]);let parent=byId.get(process.repairOf);
    while(parent&&!seen.has(parent.id)){
      seen.add(parent.id);superseded.add(parent.id);parent=byId.get(parent.repairOf);
    }
  }
  const groups=new Map();
  for(const {process:p,action} of runs){
    const script=p.script||action.script;
    const key=script?JSON.stringify([p.cwd||action.workspace||'',p.profile||action.profile||'',script]):p.id;
    const group=groups.get(key)||[];group.push(p);groups.set(key,group);
  }
  const current=[];
  for(const group of groups.values()){
    // Unknown ordering cannot establish which result is current.
    if(group.some(p=>!Number.isFinite(Date.parse(p.startedAt))))continue;
    const latest=Math.max(...group.map(p=>Date.parse(p.startedAt)));
    const newest=group.filter(p=>Date.parse(p.startedAt)===latest);
    // A timestamp tie with conflicting states is not a verified pass.
    if(newest.some(p=>p.state!=='completed'||p.execution!=='started'||p.exitCode!==0))continue;
    current.push(...newest.filter(p=>!superseded.has(p.id)));
  }
  return current;
}

export function bindDevelopmentEvidence(checks,entries){
  const host=entries.find(e=>e.id==='host'&&e.usable&&!e.truncated)?.result;
  const verifications=currentVerifications(host);
  return checks.map(check=>{
    const ids=[],processIds=[];
    if(check.method==='server'){
      const process=host?.processes?.find(record=>record.id===check.processId);
      const serverResult=entry=>entry.result?.serverCheck||entry.result;
      const observations=entries.filter(entry=>(entry.tool==='inspect_dev_server'||entry.result?.browserAgent)&&serverResult(entry)?.processId===check.processId);
      const latest=Math.max(...observations.map(entry=>Date.parse(entry.observedAt)));
      const newest=observations.filter(entry=>Date.parse(entry.observedAt)===latest);
      if(process?.state==='running'&&process.execution==='started'&&Number.isFinite(check.after)&&latest>=check.after&&newest.length&&newest.every(entry=>entry.usable&&!entry.truncated&&serverResult(entry).responding===true&&serverResult(entry).state==='running'&&serverResult(entry).execution==='started'))ids.push('host',...newest.map(entry=>entry.id));
    }
    if(check.method==='test'&&check.after!==null){
      processIds.push(...verifications.filter(p=>Date.parse(p.startedAt)>=check.after&&p.output?.trim()&&!p.logIncomplete&&!p.outputTruncated).map(p=>p.id).slice(0,4));
      if(processIds.length)ids.push('host');
    }
    // Only fresh, read-back tool results from this run can establish browser
    // observation. The reviewer still checks the interaction and actual result.
    if(check.method==='browser')for(const entry of entries){
      const preview=host?.developmentPreview,agent=entry.result?.browserAgent;
      const bound=!preview||agent?.previewId===preview.previewId&&agent.tabId===preview.tabId&&agent.processId===preview.processId&&(preview.kind==='web'||preview.serverRunning&&host.processes?.some(p=>p.id===preview.processId&&p.state==='running'&&p.execution==='started'))&&agent.readback===true;
      const workflow=agent?.workflow;
      const readback=['browser_snapshot','browser_wait_for'].includes(entry.result?.tool)||agent?.receipt?.status==='confirmed'&&agent.readback===true||entry.result?.tool==='browser_run_workflow'&&workflow?.completed?.steps>0&&workflow.confirmedSteps===workflow.completed.steps&&agent.readback===true;
      if(bound&&readback&&entry.usable&&!entry.truncated&&entry.result?.ok===true&&check.after!==null&&Date.parse(entry.observedAt)>=check.after&&entry.tool==='mcp__playwright__'+entry.result?.tool&&entry.result?.server==='playwright')ids.push(entry.id);
    }
    return {...check,eligibleEvidenceIds:ids.slice(-4),...(check.method==='test'?{eligibleProcessIds:processIds}:{})};
  });
}

export function enforceDevelopmentEvidence(review,data){
  const check=review.checks.find(c=>c.requirementId==='host:development');
  if(check?.state!=='supported')return review;
  if(data.developmentChecks?.every(c=>c.eligibleEvidenceIds.some(id=>check.evidenceIds.includes(id))))return review;
  return {...review,status:'revise',normalized:'development_verification_missing',checks:review.checks.map(c=>c===check?{...c,state:'unknown',evidenceIds:[],detail:'변경 후 테스트나 화면 동작을 확인한 실행 근거가 부족합니다.'}:c),nextStep:'변경 후 검증 결과가 부족합니다. 기존 실행 기록을 확인하고 필요한 테스트 또는 인앱 동작 확인을 이어가세요. 실행 중인 서버를 중복 실행하지 마세요. 승인이 필요하면 기존 승인 카드를 사용하고, 검증할 수 없으면 구체적인 제한을 밝히세요.'};
}
