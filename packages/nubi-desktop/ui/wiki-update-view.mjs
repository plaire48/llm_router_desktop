// What the OpenWiki update card shows. Text only: no input, no state.
const FRESHNESS={source_changed:'원본이 바뀜',unavailable:'원본이 없음',document_changed:'페이지가 직접 바뀜'};
const CHANGE={modified:'수정',added:'추가',deleted:'삭제'};
const STAGE={preparing_runtime:'실행기 확인',preparing_skills:'준비 파일 연결',planning:'계획',replanning:'계획 다시 세움',generating:'페이지 작성',finalizing:'마무리',noop:'바뀐 페이지 없음'};
const ERROR={wiki_runtime_missing:'위키 실행 파일이 없어요. 최신 설치 파일로 복구해 주세요.',wiki_skills_missing:'위키 준비 파일이 없어요. 최신 설치 파일로 복구해 주세요.',model_unavailable:'모델에 연결되지 않아 갱신하지 못했어요.',wiki_update_failed:'갱신을 마치지 못했어요. 작업 공간은 그대로예요.',wiki_update_interrupted:'갱신이 중간에 멈췄어요. 작업 공간은 그대로이니 다시 갱신해 주세요.'};
Object.assign(ERROR,{timeout:'모델 응답이 지연됐어요. 연결을 확인한 뒤 이어서 갱신해 주세요.',unauthorized:'모델에 다시 로그인한 뒤 이어서 갱신해 주세요.',wiki_plan_missing:'구성을 확정하지 못했어요. 이어서 갱신하면 다시 확인합니다.',wiki_plan_invalid:'구성 형식을 확인하지 못했어요. 이어서 갱신해 주세요.',provider_changed:'모델 연결이 바뀌어 멈췄어요. 사용할 모델을 확인해 주세요.',wiki_update_interrupted:'앱이 종료되어 갱신이 멈췄어요.'});
const day=value=>value?String(value).slice(0,10):'알 수 없음';

export function wikiUpdateView({status,update,initialization}){
  if(update?.canResume&&['failed','cancelled'].includes(update.state)){
    const last=[...(update.events||[])].reverse().find(event=>event.type==='progress');
    const progress=update.pageProgress||(Number.isSafeInteger(last?.completed)?last:null);
    const completed=progress?.total>0?`${Math.max(0,Math.min(progress.total,progress.completed))}/${progress.total}개 문서 완료`:'';
    return {title:'위키 갱신 일시 중지',lines:[completed||'작성한 문서를 보관했어요.','남은 작업부터 이어갑니다. 결과는 확인 후 반영합니다.'],detail:update.error?ERROR[update.error]||`오류: ${/^[a-z_]{1,80}$/.test(update.error)?update.error:'wiki_update_failed'}`:null,pages:[],actions:['resume','restart','discard']};
  }
  if(update?.state==='running'){
    const last=[...(update.events||[])].reverse().find(event=>event.type==='progress');
    const stage=last?(STAGE[last.stage]||last.stage)+(last.index&&last.total?` ${last.index}/${last.total}`:'')+(last.page?`: ${last.page}`:''):'준비';
    return {title:'위키 갱신 중',lines:[stage,'복사본에서 실행해요. 끝나면 확인하고 반영합니다.'],pages:[],actions:['cancel']};
  }
  if(update?.state==='ready'){
    const pages=(update.changes||[]).filter(change=>change.path.endsWith('.md')).map(change=>({path:change.path,label:CHANGE[change.change]||change.change}));
    const lines=[pages.length?`바뀐 페이지 ${pages.length}개`:'바뀐 페이지가 없어요.'];
    if(update.result?.skipped)lines.push('다시 쓸 페이지 없음. 갱신 기록만 바뀌었어요.');
    if(update.outside?.length)lines.push('반영하지 않는 파일: '+update.outside.join(', '));
    if(update.outsideEvidence?.length)lines.push('반영하지 않는 파일을 인용한 페이지(근거는 미확인으로 남음): '+update.outsideEvidence.map(item=>`${item.page}(${item.path})`).join(', '));
    return {title:'위키 갱신 결과',lines,pages,actions:update.changes?.length?['apply','discard']:['discard']};
  }
  const ended={applied:`${update?.changes?.length||0}개 파일을 반영했어요.`,cancelled:'갱신을 멈췄어요. 작업 공간은 그대로예요.',discarded:'갱신 결과를 버렸어요. 작업 공간은 그대로예요.',failed:ERROR[update?.error]||ERROR.wiki_update_failed};
  const notice=update&&ended[update.state]?[ended[update.state]]:[];
  if(status?.reason==='no_wiki_pages'){
    const state=initialization?.state;
    const line=state==='running'?'위키를 만들고 있어요.':state==='attention'?'위키 생성이 중단됐어요. 오류를 확인하고 다시 시도해 주세요.':state==='cancelled'?'위키 생성을 중지했어요.':state==='waiting_model'?'모델을 연결하면 위키를 만들 수 있어요.':'아직 위키가 생성되지 않았어요.';
    return {title:'위키 문서',lines:[...notice,line],pages:[],actions:state==='running'?[]:['run']};
  }
  if(!status||status.state==='unknown')return {title:'위키 갱신',lines:[...notice,'생성 기록이 없어 갱신을 제안하지 않아요.'],pages:[],actions:[]};
  if(status.state==='current')return {title:'현재 파일과 일치해요',lines:[...notice,`마지막 갱신 ${day(status.lastUpdate?.updatedAt)}`],pages:[],actions:['run']};
  const lines=[...notice,`마지막 갱신 ${day(status.lastUpdate?.updatedAt)}, 바뀐 파일 ${status.changedFiles?.length||0}개`];
  if(status.reason==='no_generation_record')lines[notice.length]='갱신 기록 없음. 기존 위키를 읽어 기록을 복구해요.';
  if(status.sourceMode==='folder')lines.push('폴더 파일 기준(Git 없음)');
  if(status.reason==='interrupted')lines.push('지난 갱신이 중간에 멈췄어요.');
  if(status.uncommitted?.length)lines.push(`커밋하지 않은 변경 ${status.uncommitted.length}개 포함`);
  lines.push('갱신은 로그인한 모델로 실행하며 저장소 내용이 모델에 전달됩니다. 계획 한 번과 페이지마다 여러 번 모델을 부릅니다. 결과를 확인한 뒤에 반영합니다.');
  return {title:'위키 갱신 제안',lines,pages:(status.stalePages||[]).map(page=>({path:page.path,label:FRESHNESS[page.freshness]||page.freshness})),actions:['run']};
}
