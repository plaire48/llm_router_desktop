import {WikiCoverageSummary} from './WikiCoverageBadge.jsx';
import {ProgressEstimate} from './ProgressEstimate.jsx';
import {TaskProgressBar} from './TaskProgressBar.jsx';
import {wikiModelErrors} from './wiki-model-errors.mjs';
import {gitErrors} from './git-errors.mjs';
import React, {useEffect, useState} from 'react';
import {Icon,CxButton} from '@e2e/cx-design-system';
import {durationLabel} from '../runtime/response-timing.mjs';

const stages={selecting_scope:'분석 범위 선택',syncing:'코드 동기화',preparing_runtime:'실행기 확인',preparing_skills:'준비 파일 연결',scanning:'파일 목록 확인',reading:'파일 읽기',snapshot:'분석 준비',snapshot_git:'분석 기준 준비',planning:'구성 분석',replanning:'구성 다시 분석',generating:'문서 작성',reviewing:'내용 검토',finalizing:'문서 검토',publishing:'저장 확인'};
const gitSteps={repository:'분석 저장소 준비',sources:'분석 파일 복사',index:'파일 변경 확인',commit:'분석 기준 저장',history:'분석 이력 복사',worktree:'분석 공간 연결',verify:'분석 기준 확인'};
const states={waiting_model:'위키 모델 연결 대기',waiting_source:'위키 프로젝트 선택 대기',completed:'위키 준비 완료',existing:'위키 연결됨',attention:'위키 확인 필요',cancelled:'위키 준비 중지됨'};
const errors={wiki_interrupted:'위키 준비가 중간에 멈췄어요. 앱이 종료되었거나 프로젝트가 바뀌었어요. 다시 시도해 주세요.',source_stale:'원본 파일이 바뀌었어요. 최신 파일로 다시 시도해 주세요.',provider_changed:'모델이 바뀌었어요. 선택한 모델로 다시 시도해 주세요.',wiki_git_required:'코드 위키에 필요한 Git 실행기가 없어요. 최신 누비 설치 파일로 복구한 뒤 다시 시도해 주세요.',wiki_source_limit:'파일 목록을 끝까지 확인하지 못했어요. 다시 시도해 주세요.',unauthorized:'모델 로그인을 다시 확인해 주세요.',expired_token:'모델 로그인이 만료됐어요. 다시 연결해 주세요.',response_invalid:'모델 응답을 읽지 못했어요. 다시 시도해 주세요.'};
Object.assign(errors,gitErrors,{wiki_reset_failed:'초기화를 마치지 못했어요. 위키 설정에서 “위키 다시 만들기”를 다시 눌러 주세요.',wiki_runtime_missing:'위키 실행 파일을 찾지 못했어요. 최신 누비 설치 파일로 복구해 주세요.',wiki_skills_missing:'위키 준비 파일을 찾지 못했어요. 최신 누비 설치 파일로 복구해 주세요.',wiki_snapshot_missing:'분석용 사본이 없어졌어요. 임시 폴더의 접근 차단 여부를 확인하고 다시 시도해 주세요.',wiki_permission_denied:'파일 접근이 차단됐어요. 프로젝트와 임시 폴더의 쓰기 권한을 확인해 주세요.',wiki_disk_full:'저장 공간이 부족해요. 공간을 확보한 뒤 다시 시도해 주세요.',wiki_output_conflict:'같은 이름의 위키 파일이 있어 저장하지 않았어요. 기존 문서를 확인해 주세요.',wiki_source_missing:'읽던 파일을 찾지 못했어요. 폴더를 확인한 뒤 다시 시도해 주세요.',wiki_no_sources:'분석할 텍스트 파일이 없어요. 코드나 문서가 있는 폴더를 선택해 주세요.',wiki_empty:'모델이 위키 문서를 만들지 못했어요. 다른 모델을 선택하거나 다시 시도해 주세요.',wiki_snapshot_failed:'분석용 Git 준비에 실패했어요. Git 설정과 보안 프로그램을 확인해 주세요.',wiki_git_timeout:'분석용 Git 준비가 지연됐어요. 다시 시도해 주세요.',model_unavailable:'사용할 모델을 연결해 주세요.',model_missing:'사용할 모델을 선택해 주세요.',context_length_exceeded:'프로젝트가 모델의 처리 범위를 넘었어요. 더 작은 폴더를 선택해 주세요.',rate_limited:'모델의 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.',network_error:'모델 연결이 끊겼어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.',timeout:'모델 응답을 기다리다 멈췄어요. 다시 시도해 주세요.',tls_untrusted:'회사 인증서를 확인하지 못했어요. Windows의 회사 인증서 등록 상태를 확인해 주세요.',tls_expired:'인증서 유효기간을 확인해 주세요. PC 날짜와 서버 인증서가 맞아야 합니다.',tls_hostname:'서버 주소와 인증서가 다릅니다. 모델 연결 주소를 확인해 주세요.',network_dns:'모델 서버 주소를 찾지 못했어요. 사내망이나 VPN을 확인해 주세요.',network_refused:'모델 서버에 연결하지 못했어요. 연결 상태를 확인해 주세요.',forbidden:'이 계정의 모델 접근 권한을 확인해 주세요.',no_credential:'모델 로그인 정보가 없어요. 다시 로그인해 주세요.',output_limit:'모델 출력 한도를 넘어 문서를 끝내지 못했어요. 다시 시도해 주세요.',response_json_invalid:'모델 응답 형식을 읽지 못했어요. 다시 시도해 주세요.',model_failed:'모델 요청이 실패해 문서를 만들지 못했어요. 오류 상세를 확인한 뒤 다시 시도해 주세요.',path_scope:'프로젝트 밖을 가리키는 파일은 읽을 수 없어요.',project_changed:'프로젝트가 바뀌어 준비를 멈췄어요.',write_unconfirmed:'위키 저장 결과를 확인하지 못했어요. 생성된 파일을 확인해 주세요.'});
function elapsed(start,end){
  return durationLabel(Math.max(0,end-start),{keepSeconds:true});
}
Object.assign(errors,{
  wiki_plan_missing:'AI가 위키 구성을 제출하지 못했어요. 준비한 파일은 보관했습니다. 모델을 변경한 뒤 이어서 시도할 수 있어요.',
  wiki_plan_invalid:'AI가 만든 위키 구성이 형식에 맞지 않아요. 준비한 파일은 유지됩니다. 모델을 변경하거나 다시 시도해 주세요.',
  wiki_analysis_limit:'구성 분석의 도구 호출 한도에 도달했어요. 준비한 파일은 유지됩니다. 분석 범위를 줄이거나 모델을 변경해 주세요.',
  wiki_review_scope:'근거 검토가 중단됐어요. 이어서 준비하면 남은 문서를 나눠 검토합니다.',
  wiki_review_incomplete:'문서 내용과 원문이 일치하는지 검토를 마치지 못했어요. 완료된 문서는 유지됩니다. 다시 시도해 주세요.',
});

// Counts come from the runner. A clock is a duration, never a synthetic percent.
Object.assign(errors,wikiModelErrors,{wiki_failed:'위키 준비를 마치지 못했어요. 오류 상세의 중단 단계와 코드를 확인해 주세요.'});
const pageStates={pending:'대기',done:'완료',running:'작성 중',retrying:'재시도 대기',skipped:'다시 확인'};
const retryReasons={network:'네트워크 연결 대기',network_error:'네트워크 연결 대기',model_timeout:'응답 지연',rate_limited:'사용 한도 재설정 대기',response_invalid:'응답 형식 다시 확인',output_limit:'문서를 나눠 이어 쓰는 중',provider_changed:'모델 연결 대기',wiki_offline:'네트워크 연결 대기',wiki_suspended:'절전 복귀 대기'};
export function WikiPageProgress({pages:values={},heartbeatAt,now=Date.now()}) {
  const pages=Object.entries(values),inline=false;
  return <>{heartbeatAt&&<small role="status">마지막 상태 확인 {Math.max(0,Math.floor((now-heartbeatAt)/1000))}초 전</small>}
    {!inline&&pages.length>0&&<ol className="nubi-wiki-page-list" aria-label="문서별 준비 상태">{pages.slice(0,20).map(([name,page])=><li key={name} data-wiki-page={name}><Icon name={page.state==='done'?'check':'file'} size={18}/><span title={name}>{name.replace(/^\/?openwiki\//,'')}<small>{retryReasons[page.error]||''}{page.nextRetryAt>now?` / 재시도까지 ${Math.ceil((page.nextRetryAt-now)/1000)}초`:''}</small></span><span className="nubi-wiki-page-status">{pageStates[page.state]||'확인 중'}</span></li>)}</ol>}
    {!inline&&pages.length>20&&<small>전체 {pages.length}개 중 20개 문서 표시</small>}
  </>;
}
export function WikiInitializationProgress({job, inline=false,heading=true,onResume,currentModel,currentProvider}) {
  const [now,setNow]=useState(Date.now);
  const [confirmModel,setConfirmModel]=useState(false);
  useEffect(()=>{if(!['running','paused','partial'].includes(job?.state))return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[job?.id,job?.state]);
  useEffect(()=>setConfirmModel(false),[job?.id,currentModel,currentProvider]);
  if(!job)return null;
  const running=job.state==='running',start=Date.parse(job.startedAt),end=Date.parse(job.finishedAt);
  const duration=Number.isFinite(start)?elapsed(start,running?now:Number.isFinite(end)?end:now):null;
  const percent=running&&Number.isFinite(job.percent)?Math.max(0,Math.min(100,job.percent)):null;
  const stageLabel=job.stage==='snapshot_git'?(gitSteps[job.gitStep]||stages[job.stage]):stages[job.stage];
  const title=running?`위키 ${stageLabel||'준비 중'}`:job.state==='partial'?'위키 일부 준비 완료':job.state==='paused'?'위키 준비 일시 정지':states[job.state]||'위키';
  const pages=Object.entries(job.pageStates||{}),missing=pages.filter(([,page])=>page.state!=='done').length;
  const changedModel=!!currentModel&&(currentModel!==job.model||currentProvider!==job.provider);
  const resume=()=>{if(changedModel&&!confirmModel){setConfirmModel(true);return;}onResume?.({confirmed:confirmModel});};
  return <div className={`nubi-wiki-initialization${inline?' is-inline':running?' nubi-progress-atmosphere':''}`} data-state={job.state}>
    {heading&&<div className="nubi-wiki-initialization-line">
      {running?<span className="status-spinner" aria-hidden="true"/>:<Icon name={job.state==='attention'?'alertCircle':'bookmark'} size={14}/>}
      <strong role={running?'status':undefined}>{title}</strong>
      {percent!==null&&<span className="nubi-wiki-percent" title="현재 단계 진행률">{percent}%</span>}
      {inline&&running&&duration&&<span className="nubi-wiki-elapsed">진행 {duration}</span>}
      {!running&&job.state==='completed'&&<span className="nubi-wiki-elapsed">{job.pages}개 문서{job.excludedFiles>0?` / 제외 ${job.excludedFiles}개 파일`:''}{job.changedDuringRun>0?` / 생성 중 바뀐 파일 ${job.changedDuringRun}개, 갱신 필요`:''}{job.lastModelError?` / 모델 오류 ${job.lastModelError}`:''}{duration?` / ${duration}`:''}</span>}
    </div>}
    {!inline&&running&&<TaskProgressBar label={percent===null?title:`${title} 진행률`} value={percent??undefined} active={running} valueText={percent===null?undefined:`${percent}%${job.total>0?` (${job.completed}/${job.total})`:''}`}/>}
    {!inline&&running&&<div className="nubi-wiki-progress-meta">
      {job.total>0&&percent!==null?<span><strong>{job.completed.toLocaleString()}</strong> / {job.total.toLocaleString()}{['reading','snapshot','snapshot_git','publishing'].includes(job.stage)?'개 파일':'개 문서'}</span>:job.stage==='scanning'&&job.completed>0?<span>파일 {job.completed.toLocaleString()}개 확인</span>:null}
      {duration&&<span className="nubi-wiki-elapsed">진행 {duration}</span>}
    </div>}
    {!inline&&job.report&&<details><summary>준비 보고서</summary><WikiCoverageSummary report={job.report}/></details>}
    {!inline&&job.scope&&<small role="status">보강 {job.scope.rounds.done} / {job.scope.rounds.total}회{job.scope.mode==='folders'?' / 선택한 폴더부터 정리':''}</small>}
    {!inline&&running&&<ProgressEstimate identity={`${job.id}:${job.stage}:${job.gitStep||''}:${job.stageStartedAt||''}`} completed={job.completed} total={job.total}/>}
    {!inline&&running&&job.modelWaiting&&<small role="status">AI 응답을 기다리고 있어요. 받은 결과는 유지됩니다.</small>}
    {!inline&&<WikiPageProgress pages={job.pageStates} heartbeatAt={job.heartbeatAt} now={now}/>}
    {!inline&&job.state==='paused'&&<small role="status">{retryReasons[job.error]||'연결을 기다리고 있어요.'} 연결되면 남은 문서부터 이어갑니다.</small>}
    {!inline&&job.state==='partial'&&<small role="status">완료한 문서 {job.pages||pages.length-missing}개를 먼저 보여드려요.</small>}
    {!inline&&confirmModel&&<div role="group" aria-label="모델 변경 승인"><p>보관한 작업은 {job.model}로 시작했습니다. {currentModel}로 바꿔 이어갈까요?</p><small>완료한 문서와 현재 원본 기준은 유지합니다.</small></div>}
    {!inline&&onResume&&['attention','cancelled','paused','partial'].includes(job.state)&&<CxButton onClick={resume} disabled={job.state==='paused'&&!changedModel}><Icon name="refresh" size={18}/>{confirmModel?'변경 승인 후 이어서':job.state==='partial'?`빠진 페이지 ${missing}개 다시 시도`:job.canResume?'이어서 준비':'다시 시도'}</CxButton>}
    {!inline&&job.canResume&&['attention','cancelled'].includes(job.state)&&<small className="nubi-wiki-retained"><Icon name="check" size={16}/>완료한 문서는 보관했습니다.</small>}
    {!inline&&job.state==='attention'&&<><small role="alert">{errors[job.error]||`${stages[job.stage]||'위키 준비'} 단계에서 멈췄어요. 아래 오류 코드를 확인해 주세요.`}</small><details className="nubi-wiki-error-detail"><summary><Icon name="infoCircle" size={16}/>오류 상세</summary><p>{stageLabel||'위키 준비'}{duration?` / 진행 ${duration}`:''}</p><code>{/^[a-z_]{1,80}$/.test(job.error||'')?job.error:'wiki_failed'}</code></details></>}
  </div>;
}
