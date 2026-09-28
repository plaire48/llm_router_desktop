import {taskView,recentActivity,activityView,reviewWorkerView} from './task-view.js';
import {FIELD_LABELS} from '../worker/cell-format.mjs';
import React, {useState} from 'react';
import {TraceSurface,TraceStep} from '../../../extensions/aipro-chat/src/TraceSurface.jsx';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {TaskPlan} from '../../../extensions/aipro-chat/src/TaskPlan.jsx';
import {Icon} from '@e2e/cx-design-system';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';

const fields=FIELD_LABELS;
const labels = {document_open:'문서 전체 계산과 결과 확인',document_save:'완성 문서 저장',analyze_request:'요청 분석',review_action:'수정할 내용 검토',review_task:'요청 전체 재검토',review_step:'이 단계의 결과 재검토',repair_task:'미충족 조건 보완',ask_user:'추가 정보 확인',read_selection:'셀 값과 수식 읽기',apply_changes:'셀 수정 후 결과 비교',verify_selection:'최종 셀 다시 확인'};
Object.assign(labels,{register_template:'양식 사본과 분석 명세 저장',inspect_template:'양식 구조 분석',define_template_fields:'항목과 셀 연결 확인',ask_template_field:'양식 입력값 확인',fill_template_fields:'확인된 항목 채우기',excel_capabilities:'Excel 2016 기능 확인',list_worksheets:'통합문서의 시트 목록 읽기',inspect_worksheet:'시트 구조 확인',read_worksheet_range:'다른 시트의 범위 읽기',get_range_data:'셀 상세 데이터 확인',analyze_ranges:'범위별 분석'});

export function TaskActivity({run, latest, input, approval, showSummary=true}) {
  const [expanded,setExpanded]=useState(null);
  if (!run) return null;
  const id = name => latest ? name : undefined;
  const plan = run.plan, checks = run.validation?.checks || [];
  const view=taskView(run,{input,approval}), feed=recentActivity(run.activity,3);
  const workers=reviewWorkerView(run),delegates=reviewWorkerView(run,'delegationWorkers');
  const live=run.state==='running';
  const progress=plan && {status:view.planStatus,plan:plan.steps.map(step=>({text:step.title,status:step.state==='done' ? 'completed' : run.state!=='done'&&['running','recovering','waiting','failed','paused'].includes(step.state) ? 'in_progress' : 'pending'}))};
  return <section id={id('task-panel')} className="office-task" aria-label="실시간 작업 과정">
    {plan && <TaskPlan defaultExpanded={view.working} progress={progress} detailsId={id('plan-overview')} countId={id('plan-progress')} countSuffix=" 완료" statusLabel={view.label} stepAttributes={index=>({className:'plan-step','data-step-id':plan.steps[index].id,'data-state':plan.steps[index].state})}/>}
    {delegates && <section aria-label="역할별 분석 워커">
      <p className="reply-note" role="status"><strong>{delegates.summary}</strong></p>
      {!!delegates.active.length && <WorkerRows nodes={delegates.active}/>}
      <DeckDisclosure title="역할과 작업 순서" icon="list"><WorkerRows nodes={delegates.nodes} showAll/></DeckDisclosure>
    </section>}
    {workers && <section aria-label="문서 검토 워커">
      <p className="reply-note" role="status"><strong>{workers.summary}</strong></p>
      {!!workers.active.length && <WorkerRows nodes={workers.active}/>}
      <DeckDisclosure title="워커별 역할과 결과" icon="list"><WorkerRows nodes={workers.nodes}/></DeckDisclosure>
    </section>}
    {!!(feed.previous.length || feed.recent.length) && <TraceSurface open={expanded ?? (live && !view.waiting || run.state==='failed' || view.state==='awaiting_recovery')} onOpenChange={setExpanded} live={live && !view.waiting} running={view.working} waiting={view.waiting} stopped={['cancelled','unsupported'].includes(run.state)} attention={run.state==='failed'||view.state==='awaiting_recovery'}>
      {!!feed.previous.length && <DeckDisclosure title={`이전 진행 기록 ${feed.previous.length}개`} icon="list"><ActivityRows events={feed.previous} run={run} view={view}/></DeckDisclosure>}
      <ActivityRows id={id('activity-feed')} events={feed.recent} run={run} view={view}/>
    </TraceSurface>}
    <span id={id('activity-now')} className={plan || (live && view.action) ? 'visually-hidden' : 'reply-status'} role="status"><span id={id('activity-now-label')}>{view.label}</span></span>
    {showSummary && view.summary && <p id={id('task-result')} className="reply-note">{view.summary}</p>}
    {!!checks.length && <DeckDisclosure title={checks.some(check=>check.status!=='met')?`확인 필요 ${checks.filter(check=>check.status!=='met').length}개`:'검증 결과'} icon="table" attention={run.state==='failed'}><ul className="office-check-list">{checks.map((check,index)=><li key={index} data-state={check.status}><Icon name={check.status==='met' ? 'check' : 'alertCircle'} size={16}/><div><strong>{check.address || check.requirement}</strong><span>{fields[check.field] || check.field || check.detail}</span>{check.status!=='met' && <p>현재 값 {JSON.stringify(check.actual)?.slice(0,100) ?? '확인되지 않음'}</p>}</div></li>)}</ul></DeckDisclosure>}
    {!!(run.task?.requirements?.length || run.trace?.length || run.workbookSources?.length) && <DeckDisclosure title="참고한 내용" icon="list">
    {['document','office'].includes(run.kind) && run.task?.requirements && <DeckDisclosure title="문서에 반영할 요구사항" icon="list"><ul className="office-check-list">{run.task.requirements.map((r,i)=><li key={r.id||i}><span>{typeof r==='string'?r:r.text}</span></li>)}</ul></DeckDisclosure>}
    {!!run.trace?.length && <DeckDisclosure title="검토 기록" icon="list"><ol id={id('trace-list')} className="office-review-list">{run.trace?.map((step,index) => <li key={index}>{labels[step.name] || step.name}</li>)}</ol></DeckDisclosure>}
    {!!run.workbookSources?.length && <DeckDisclosure title={`참고한 시트 범위 ${run.workbookSources.length}개`} icon="table"><ul className="office-check-list">{run.workbookSources.map(source=><li key={source.snapshotId}><span>{source.worksheet}!{source.address}</span></li>)}</ul></DeckDisclosure>}
    </DeckDisclosure>}
  </section>;
}

function WorkerRows({nodes,showAll=false}){
  const labels={pending:'대기',running:'검토 중',waiting:'추가 확인',blocked:'선행 작업 대기',done:'검토 수신',error:'확인 필요',cancelled:'중지',unconfirmed:'미완료'};
  return <ol className="activity-feed" aria-label="검토 워커 목록">{nodes.map(node=><li key={node.id} data-worker-id={node.id} data-state={node.state}>
    <TraceStep status={['pending','blocked'].includes(node.state)?'queued':node.state} label={labels[node.state]||'확인 필요'}>
      {node.title}<span className="office-trace-detail">{node.scope}</span>
      {!!node.dependencies?.length && <span className="office-trace-detail">선행: {node.dependencies.join(", ")}</span>}
      {node.summary && <span className="office-trace-detail">{node.summary}</span>}
      {(node.missing||[]).slice(0,showAll?undefined:1).map((detail,index)=><span key={index} className="office-trace-detail">확인 필요: {detail}</span>)}
      <span className="visually-hidden">{labels[node.state]||'확인 필요'}</span>
    </TraceStep>
  </li>)}</ol>;
}

function ActivityRows({events, run, view, id}) {
  return <ol id={id} className="activity-feed" aria-label="작업 진행 기록">{events.map(event => {
    const {status,label,seconds}=activityView(event,run,view);
    return <li key={event.id} className={event.kind==='commentary'?'agent-progress-note':undefined} data-state={event.state} data-status={status}>
      {event.kind==='commentary' ? <><Icon name="message" size={14}/><MessageBody content={event.detail || event.title} compact/></> : <TraceStep status={status} label={label}>
        {event.title}{event.detail && <span className="office-trace-detail">{event.detail}</span>}
        {status==='unconfirmed'?<span className="office-trace-detail">결과 미확인</span>:<span className="visually-hidden">{` / ${label}`}</span>}
      </TraceStep>}
      {event.kind!=='commentary' && seconds!==null && <span className="activity-duration" aria-hidden="true">{seconds}초</span>}
    </li>;
  })}</ol>;
}
