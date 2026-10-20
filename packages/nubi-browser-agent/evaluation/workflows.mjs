// Synthetic data only. No company URLs, identities or mail content are used.
export const issues = [
  {id:'CHG-104',title:'포털 인증서 교체',type:'변경',status:'진행 중',date:'2026-10-16',owner:'김민수',window:'2026-10-16 22:00 KST',impact:'10분 접속 중단',rollback:'기존 인증서 복원'},
  {id:'CHG-105',title:'메일 검색 인덱스 교체',type:'변경',status:'진행 중',date:'2026-10-17',owner:'박서연',window:'2026-10-17 21:00 KST',impact:'검색 지연',rollback:'이전 인덱스 복원'},
  {id:'CHG-099',title:'포털 인증서 교체',type:'변경',status:'완료',date:'2026-10-09',owner:'김민수',window:'2026-10-09 22:00 KST',impact:'없음',rollback:'해당 없음'},
  {id:'INC-104',title:'포털 인증서 문의',type:'장애',status:'진행 중',date:'2026-10-16',owner:'김민수',window:'미정',impact:'문의',rollback:'해당 없음'},
  {id:'CHG-106',title:'인증서 교체 사전 조사',type:'변경',status:'진행 중',date:'2026-10-20',owner:'김민수',window:'미정',impact:'미정',rollback:'미정'},
];
export const mails = [
  {id:'MAIL-201',subject:'포털 인증서 교체 확인',from:'민수 <minsu.ops@example.invalid>',date:'2026-10-15',issue:'CHG-104',body:'CHG-104 작업은 2026-10-16 22:00 KST입니다. 10분 접속 중단 예정이며, 실패 시 기존 인증서 복원입니다. 작업 전 보안팀 확인이 필요합니다.'},
  {id:'MAIL-202',subject:'포털 인증서 교체 확인',from:'민수 <minsu.sales@example.invalid>',date:'2026-10-15',issue:'CHG-099',body:'지난주 CHG-099 완료 보고입니다. 이번 주 CHG-104 승인 메일이 아닙니다.'},
  {id:'MAIL-203',subject:'메일 검색 작업 확인',from:'서연 <seoyeon.ops@example.invalid>',date:'2026-10-15',issue:'CHG-105',body:'CHG-105 작업은 2026-10-17 21:00 KST입니다. 검색 지연이 발생할 수 있습니다.'},
  {id:'MAIL-204',subject:'포털 인증서 교체 확인',from:'민수 <minsu.ops@example.invalid>',date:'2026-10-08',issue:'CHG-099',body:'CHG-099 과거 일정입니다. 2026-10-09 22:00 KST에 진행합니다.'},
];

export const workflowCases = [
  {id:'JSM-01',kind:'read',request:'2026-10-16부터 2026-10-17까지 진행 중인 변경 이슈를 모두 찾고 ID, 일정, 영향, 복구 방법을 정리해 줘.',sources:['CHG-104','CHG-105']},
  {id:'MAIL-01',kind:'read',request:'2026-10-15 운영 담당 민수(minsu.ops@example.invalid)가 보낸 CHG-104 관련 메일을 읽고 작업 전 확인 사항을 알려줘.',sources:['MAIL-201']},
  {id:'MAIL-02',kind:'draft',request:'CHG-104의 작업 일정과 영향을 JSM에서 확인하고 ops-team@example.invalid 앞으로 안내 메일 초안을 작성해 줘. 전송하지 마.',sources:['CHG-104'],recipient:'ops-team@example.invalid',replyTo:null,terms:['CHG-104','2026-10-16 22:00 KST','10분 접속 중단']},
  {id:'MAIL-03',kind:'draft',request:'2026-10-15 운영 담당 민수의 CHG-104 메일에 작업 전 보안팀 확인이 필요하다는 회신 초안을 작성해 줘. 전송하지 마.',sources:['MAIL-201'],recipient:'minsu.ops@example.invalid',replyTo:'MAIL-201',terms:['CHG-104','보안팀 확인']},
  {id:'CROSS-01',kind:'draft',request:'JSM의 CHG-104와 2026-10-15 운영 담당 민수의 관련 메일을 함께 확인하고 ops-team@example.invalid 앞으로 일정, 영향, 복구 방법, 작업 전 확인 사항을 담은 안내 메일 초안을 작성해 줘. 전송하지 마.',sources:['CHG-104','MAIL-201'],recipient:'ops-team@example.invalid',replyTo:null,terms:['CHG-104','2026-10-16 22:00 KST','10분 접속 중단','기존 인증서 복원','보안팀 확인']},
];

/** Runner-only oracle. It is not served to the browser or imported by the core. */
export function scoreWorkflow(caseId, output, snapshot) {
  const spec=workflowCases.find(x=>x.id===caseId);
  if(!spec)throw Error('unknown_workflow_case');
  const failures=[];
  const equalSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&new Set(a).size===a.length&&b.every(x=>a.includes(x));
  if(!spec.sources.every(id=>snapshot.reads.includes(id)))failures.push('source_not_opened');
  if(!equalSet(output?.sources,spec.sources))failures.push('sources_mismatch');
  if(snapshot.sentCount!==0)failures.push('unexpected_send');
  if(spec.kind==='read'){
    if(snapshot.drafts.length)failures.push('unexpected_draft');
    const text=typeof output?.answer==='string'?output.answer:'';
    const terms=caseId==='JSM-01'?['CHG-104','CHG-105','2026-10-16 22:00 KST','2026-10-17 21:00 KST','10분 접속 중단','검색 지연','기존 인증서 복원','이전 인덱스 복원']:['CHG-104','보안팀 확인'];
    if(!terms.every(term=>text.includes(term)))failures.push('required_fact_missing');
    if(caseId==='JSM-01' && /CHG-099|INC-104|CHG-106/.test(text))failures.push('out_of_scope_issue');
  } else {
    const draft=snapshot.drafts.find(x=>x.id===output?.draftId);
    if(snapshot.drafts.length!==1||!draft)failures.push('draft_count_or_id');
    if(draft){
      if(draft.to!==spec.recipient||draft.cc||draft.bcc)failures.push('recipient_mismatch');
      if(draft.replyTo!==spec.replyTo)failures.push('thread_mismatch');
      if(!draft.subject.trim()||!spec.terms.every(term=>draft.body.includes(term)))failures.push('draft_facts_missing');
    }
  }
  return {caseId,passed:failures.length===0,failures,semanticReviewRequired:true};
}
