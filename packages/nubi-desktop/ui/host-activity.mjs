const silent=new Set(['state','overview','poll','analysisHistory','usage','startupConnections','titlebarAppearance','openingScene','conversationNavigation','autoApprovals','approvalPolicy','shellProfiles','workspaceLayout']);
const labels={open:'프로젝트 여는 중',openCurrent:'프로젝트 여는 중',chooseFolder:'프로젝트 폴더 여는 중',importProject:'프로젝트 가져오는 중',cloneRepository:'저장소 복제 중',switchProject:'프로젝트 전환 중',startConversation:'대화 여는 중',createTask:'대화 준비 중',startAgent:'작업 시작 중',answerAgent:'답변 전달 중',stopAgent:'작업 중지 중',regenerateAnswer:'답변 다시 준비 중',prepareProposal:'변경 전 파일 확인 중',applyNewFile:'새 파일 저장 중',confirmProposal:'저장 결과 확인 중',saveSource:'파일 저장 중',saveDocumentCopy:'문서 사본 저장 중',editorSource:'파일 읽는 중',readLocalFile:'파일 읽는 중',previewFile:'파일 미리보기 준비 중',proposalText:'변경 내용 읽는 중',proposalArtifacts:'변경 비교 준비 중',artifactText:'자료 읽는 중',browseDirectory:'폴더 목록 읽는 중',conversationHistory:'대화 읽는 중',appliedFileSummary:'변경 파일 확인 중',workspaceChanges:'파일 변경 확인 중',commitHistory:'커밋 이력 읽는 중',decideSetupAction:'명령 승인 처리 중',applyCommandRepair:'수정한 명령 준비 중',run:'명령 시작 중',downloadMail:'메일 파일 저장 중',mailDocument:'메일 본문 읽는 중',openBrowser:'브라우저 여는 중',openWorkspacePage:'웹페이지 여는 중',connectMarketplace:'스킬 목록 연결 중',openTeamWorkspace:'팀 자료 여는 중',search:'자료 검색 중'};
export function hostRequestLabel(method,args={}){
 args ||= {};
 if(silent.has(method)||method==='mail')return null; // Mail owns its finer-grained footer state.
 if(method==='provider')return !args.action||args.action==='status'?null:'모델 연결 확인 중';
 if(method==='ghesAccount')return !args.operation||args.operation==='status'?null:'Git 계정 연결 확인 중';
 if(method==='wikiInitialization')return !args.action||args.action==='status'?null:'위키 요청 처리 중';
 if(method==='projectCatalog')return !args.action||args.action==='list'?null:'프로젝트 목록 변경 중';
 if(method==='workspaceUpdate')return !args.action||args.action==='status'?null:'업데이트 확인 중';
 if(method==='browser')return ['status','layout'].includes(args.action)?null:'브라우저 페이지 처리 중';
 if(method==='browserConnection')return !args.action||args.action==='status'?null:args.action==='disconnect'?'브라우저 연결 해제 중':'브라우저 연결 확인 중';
 if(method==='browserMirror')return ({connect:'브라우저 연결 중',refreshTabs:'브라우저 탭 찾는 중',chooseTab:'브라우저 탭 연결 중',cancelConnect:'브라우저 연결 취소 중'})[args.action]||null;
 if(method==='liveEditor')return ['status','observe'].includes(args.action)?null:'문서 연결 처리 중';
 return labels[method]||'요청 처리 중';
}
// Metadata only: source text, commands, URLs and credentials never enter a
// snapshot. Short requests and polling do not create decorative activity.
export function createHostActivityTracker({delayMs=150}={}){
 const requests=new Map(),listeners=new Set();let sequence=0,snapshot=null;
 const publish=()=>{
  const rows=[...requests.values()].filter(row=>row.visible).sort((a,b)=>b.sequence-a.sequence);
  snapshot=rows.length?{label:rows[0].label,state:'running',count:rows.length,labels:[...new Set(rows.map(row=>row.label))]}:null;
  for(const listener of listeners){try{listener();}catch{}}
 };
 function begin(method,args){
  const label=hostRequestLabel(method,args);if(!label)return()=>{};
  const id=++sequence,row={label,sequence:id,visible:false,timer:null};requests.set(id,row);
  row.timer=setTimeout(()=>{if(requests.has(id)){row.visible=true;publish();}},delayMs);
  return()=>{if(!requests.delete(id))return;clearTimeout(row.timer);if(row.visible)publish();};
 }
 return {begin,getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
  async run(method,args,operation){const finish=begin(method,args);try{return await operation();}finally{finish();}}
 };
}
