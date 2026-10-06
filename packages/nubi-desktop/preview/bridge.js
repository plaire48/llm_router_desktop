// Visual preview only. This bridge never reads credentials, local projects or remote services.
const params=new URLSearchParams(location.search);
let connected=!params.has('login')&&!params.has('model-error'),selected='aipro',model='preview-qwen',reasoning='medium',modelError=params.has('model-error')?'login_timeout':null;
const files={'README.md':'# 누비 Workspace\n\n프로젝트와 대화, 문서를 한곳에서 이어갑니다.\n','src/welcome.js':'export const greeting = "누비에게 맡겨 주세요";\n','openwiki/프로젝트.md':'# 프로젝트 안내\n\n이 화면은 예시 데이터로 구성한 미리보기입니다.\n'};
const today=new Date().toISOString();
const previewAnswer=content=>({id:crypto.randomUUID(),role:'assistant',content,at:new Date().toISOString(),modelId:model,modelName:'Qwen (미리보기)',responseTiming:{kind:'preview',state:'completed',startedAt:new Date(Date.now()-12000).toISOString(),finishedAt:new Date().toISOString(),durationMs:12000}});
const project={projectId:'visual-preview',name:'누비 프로젝트',root:'/preview/nubi',branch:'main',files:Object.keys(files),wikiFiles:['openwiki/프로젝트.md'],tasks:[],proposals:[],processes:[],comparisons:[],profiles:[{id:'bash',label:'Bash'}],defaultShell:'bash',peerTasks:[],peerLinks:[]};
if(params.has('conversation'))project.tasks.push({id:'preview-conversation',request:'프로젝트의 구조와 다음 할 일을 정리해 줘.',state:'review',createdAt:today,criteria:[],trace:[],messages:[previewAnswer('**프로젝트의 시작 흐름을 한곳에 모았어요.**\n\n왼쪽에서 파일과 커밋 이력을 열고, 오른쪽 문서를 보면서 대화를 이어갈 수 있습니다.\n\n다음에는 로그인 후 첫 응답과 프로젝트의 위키 준비 흐름을 확인하면 됩니다.\n\n이 답변은 화면 검토를 위한 예시입니다.')]});
// Deliberately different send/creation/completion times to inspect message
// footers. The intermediate reply has no duration; it must not borrow the run's.
if(params.has('message-times')&&project.tasks.length){
 const task=project.tasks[0],runId=crypto.randomUUID(),base=Date.now()-75000,stamp=offset=>new Date(base+offset).toISOString();
 const final={...task.messages[0],runId,at:stamp(55000),responseTiming:{kind:'preview',state:'completed',startedAt:stamp(55000),finishedAt:stamp(67000),durationMs:12000}};
 task.createdAt=stamp(0);
 task.responseTiming={...final.responseTiming,runId};
 task.messages=[{id:crypto.randomUUID(),runId,role:'assistant',content:'프로젝트 자료를 확인했어요.',at:stamp(5000),modelId:model,modelName:'Qwen (미리보기)'},final];
}
// Opt-in examples of host usage records. No model or private conversation is read.
if(project.tasks.length&&['measured','total','partial','missing','compacted'].includes(params.get('usage'))){
 const mode=params.get('usage'),base={model,window:262144,at:today};
 const usage=mode==='measured'?{...base,kind:'measured',used:23223,prompt:23175,completion:48,reasoning:30}:
  mode==='total'?{...base,kind:'measured',used:23223,prompt:null,completion:null}:
  mode==='compacted'?{...base,kind:'estimated',used:8000,reason:'compaction'}:
  {...base,kind:'estimated',used:24000,reason:'response_usage_missing',...(mode==='partial'?{reported:{prompt_tokens:23175,completion_tokens:null,total_tokens:null}}:{})};
 project.tasks[0].context={phase:'ready',usage};
}
if(params.has('activity')&&project.tasks.length){
 const task=project.tasks[0],previousRun=crypto.randomUUID(),runId=crypto.randomUUID();
 const priorPlan={runId:previousRun,revision:1,steps:[{text:'프로젝트 시작 흐름 확인',expected_outcome:'README와 시작 코드에서 실행 순서를 확인한다.',status:'completed'}],updates:[]};
 const priorTrace=[{id:previousRun+':0:0',runId:previousRun,tool:'read_source',status:'done',label:'README와 시작 코드 확인'}];
 task.messages[0].runId=previousRun;
 task.activityHistory=[{runId:previousRun,state:'review',workPlan:priorPlan,trace:priorTrace,resultReview:{runId:previousRun,status:'ready',checks:[{requirementId:'intent:step:0',state:'supported',evidenceIds:['tool:0']}]}}];
 const before=[{text:'관련 파일 확인',expected_outcome:'현재 시작 화면 구성을 읽는다.',status:'in_progress'},{text:'시작 문구 개선안 정리',expected_outcome:'기존 시작 문구의 개선안을 준비한다.',status:'pending'}];
 const steps=[{...before[0],status:'completed'},{text:'시작 문구 방향 확인',expected_outcome:'사용자가 원하는 안내 범위를 확인한다.',status:'in_progress'},{...before[1]}];
 task.workPlan={runId,revision:2,steps,updates:[{runId,revision:1,before:[],after:before,at:today},{runId,revision:2,before,after:steps,reason:'문구를 바꾸기 전에 안내 범위를 확인합니다.',at:today}]};
 task.trace=[{id:runId+':0:note-0',runId,tool:'progress_note',status:'done',content:'시작 화면의 문구와 프로젝트 안내를 먼저 확인할게요.'},{id:runId+':0:1',runId,tool:'read_source',status:'done',label:'README와 시작 화면 확인'},{id:runId+':0:note-2',runId,tool:'progress_note',status:'done',content:'프로젝트 안내와 시작 문구가 따로 있어요. 문구를 바꾸기 전에 보여줄 범위를 확인할게요.'},{id:runId+':0:3',runId,tool:'ask_user',status:'waiting'}];
 task.question={id:crypto.randomUUID(),runId,text:'시작 화면에 어떤 안내를 보여줄까요?',kind:'choice',inputMode:'text',inputPlaceholder:'예: 파일 확인부터 바로 시작',options:[{id:'option-1',label:'핵심 안내만',description:'다음 행동 하나를 짧게 보여줍니다.'},{id:'option-2',label:'프로젝트 정보도 함께',description:'프로젝트 이름과 최근 작업을 함께 보여줍니다.'}]};
 task.messages.push({id:crypto.randomUUID(),inputId:'preview-admitted-input',role:'user',content:'시작 문구도 조금 더 친절하게 바꿔 줘.',at:today},{id:crypto.randomUUID(),runId,questionId:task.question.id,role:'assistant',content:task.question.text,at:today,modelId:model,modelName:'Qwen (미리보기)'});
 task.state='waiting_input';task.responseTiming={runId,state:'waiting_input',startedAt:new Date(Date.now()-18000).toISOString(),finishedAt:today,durationMs:18000};
 if(params.has('page-question')){
  task.request='연결한 페이지에서 필요한 내용을 확인해 줘.';
  task.question={...task.question,text:'연결한 페이지에서 무엇을 확인할까요?',inputPlaceholder:'예: 로그인 방법과 필요한 설정',options:[{id:'option-1',label:'로그인 방법',description:'인증에 필요한 단계와 설정을 확인합니다.'},{id:'option-2',label:'페이지 내용',description:'열린 페이지의 핵심 내용을 확인합니다.'}]};
  // A legacy reply with identical text belongs to an earlier run, not this form.
  task.messages[0].content=task.question.text;
  task.messages[1].content='페이지를 연결했으니 확인을 이어가 줘.';
  const reply=task.messages.at(-1);
  reply.content='페이지를 열었어요. 확인할 범위를 정리하고 있어요.';
  delete reply.questionId;
  if(params.get('page-question')==='current')task.messages.push({...previewAnswer(task.question.text),runId,questionId:task.question.id});
  task.workPlan={runId,revision:1,steps:[{text:'연결한 페이지 확인',expected_outcome:'연결된 페이지와 요청 범위를 확인한다.',status:'completed'},{text:'확인할 내용 선택',expected_outcome:'사용자가 원하는 확인 범위를 선택한다.',status:'in_progress'}],updates:[]};
  task.trace=[{id:runId+':0:note-0',runId,tool:'progress_note',status:'done',content:'연결한 페이지에서 확인할 범위를 정리하고 있어요.'},{id:runId+':0:1',runId,tool:'ask_user',status:'waiting'}];
 }
}
if(params.has('queue')&&project.tasks.length){project.tasks[0].state='running';project.tasks[0].checkpoint={runId:crypto.randomUUID()};}
if(params.has('changes')&&project.tasks.length){project.proposals=Object.keys(files).slice(0,2).map((path,index)=>({id:'preview-change-'+index,taskId:project.tasks[0].id,path,state:'applied',afterHash:'preview-'+index,createdAt:today}));}
const previewSkills=params.has('skills')?[{name:'프로젝트 읽기',description:'파일 구조와 실행 흐름을 확인하고 핵심 내용을 정리합니다.',path:'.agents/skills/project-read/SKILL.md'},{name:'문서 정리',description:'문서의 형식과 용어를 맞추고 읽기 쉽게 다듬습니다.',path:'.agents/skills/docs/SKILL.md'},{name:'긴 이름의 스킬도 현재 프로젝트의 작업 흐름에 맞춰 확인하기',description:'이름과 설명의 가독성을 확인하는 화면 예시입니다. 실제 스킬이나 파일은 등록하지 않았습니다.',path:'.agents/skills/long-name/SKILL.md'},...Array.from({length:8},(_,i)=>({name:`참고 스킬 ${i+1}`,description:'스크롤과 고정된 추가 영역을 확인하는 예시입니다.',path:`.agents/skills/example-${i}/SKILL.md`}))]:[];
const previewSkillTrash=[];
for(const item of previewSkills){item.title=item.name;item.name=item.path.split('/').at(-2);item.origin='custom';item.managed=true;item.packageHash='preview:'+item.name;files[item.path]=`---\nname: ${item.name}\ndescription: ${JSON.stringify(item.description)}\n---\n\n# ${item.title}\n\n화면 확인용 스킬 지침입니다. 실제 파일은 변경하지 않습니다.\n`;}
project.files=Object.keys(files);
// Optional company-account examples never contact GHES or issue credentials.
const companyExample=params.get('company-skills');
let companyConnected=['connected','installed','network','permission','sso'].includes(companyExample),companyReady=false,companyLoginStarted=0,companyInstalled=companyExample==='installed';
const companyState=()=>{if(companyExample==='signin'&&companyLoginStarted&&Date.now()-companyLoginStarted>=2500){companyConnected=true;companyLoginStarted=0;}return {state:companyConnected?'connected':companyLoginStarted?'connecting':'guest',connected:companyConnected,profile:companyConnected?{name:'회사 계정 (미리보기)',login:'preview',id:1}:null,device:companyLoginStarted?{code:'예시 코드'}:null};};
const mails=[{id:'mail-1',subject:'프로젝트 시작 자료를 공유합니다',from:'프로젝트 팀 <team@example.invalid>',date:today,state:'saved'},{id:'mail-2',subject:'화면 검토 의견',from:'디자인 팀 <design@example.invalid>',date:today,state:'queued'}];
const mailExample=['empty','off','paused','form'].includes(params.get('mail-state'))?params.get('mail-state'):null;
let mailExampleAuto=mailExample==='paused',mailExampleModel=null,mailExampleConnected=mailExample!=='form',mailExampleServer='gmail_test';
if(['empty','form'].includes(mailExample))mails.length=0;
const mailLocal=new Map(),savedMailSearches=new Map(),terminalExamples=new Map();
const localMail=id=>mailLocal.get(id)||{pinned:false,tags:[],confirmed:false};
const previewMail=id=>{
 const row=mails.find(item=>item.id===id);if(!row)throw Error('mail_missing');
 const quotation=params.has('mail-search')&&id==='mail-1';
 return {...row,text:quotation?'안녕하세요.\n\n10월 프로젝트 견적 자료를 보내드립니다.\n첨부한 견적서의 납품 일정과 유지보수 범위를 확인해 주세요.\n\n의견은 금요일까지 공유해 주시면 반영하겠습니다.\n\n이 메일은 화면 검토용 예시입니다. 실제 수신한 메일이 아닙니다.':'안녕하세요.\n\n프로젝트 시작 자료를 공유합니다.\n파일과 대화 이력을 확인하고 다음 할 일을 정리해 주세요.\n\n이 메일은 화면 검토용 예시입니다. 실제 수신한 메일이 아닙니다.',attachments:quotation?[{id:'attachment-1',filename:'프로젝트 견적서.pdf',sha256:'preview-attachment-hash',contentType:'application/pdf',contentState:'document_read',coverage:'예시 문서 / 3쪽',segments:[{page:3,text:'프로젝트 견적에는 구축 비용과 유지보수 범위가 포함됩니다. 납품은 10월 말로 제안합니다.'}]},{id:'attachment-2',filename:'일정.xlsx',sha256:'preview-sheet-hash',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',contentState:'document_attention',error:'document_password'}]:id==='mail-1'?[{id:'attachment-1',filename:'프로젝트 안내.md',sha256:'preview-attachment-hash',contentState:'document_read',coverage:'화면 검토용 예시 문서',segments:[{page:1,text:'프로젝트의 파일과 이력을 확인합니다. 화면 검토용 예시 문서입니다.'}]}]:[]};
};
if(params.has('mail-search')){
 mails[0].subject='10월 프로젝트 견적서와 납품 일정';mails[0].from='구매 팀 <purchase@example.invalid>';
 for(let index=0;index<26;index++)mails.push({id:'mail-example-'+index,subject:['주간 프로젝트 진행 현황','회의 일정과 참석 안내','배포 전 화면 검토 요청'][index%3]+' '+(index+1),from:index%2?'개발 팀 <dev@example.invalid>':'디자인 팀 <design@example.invalid>',date:new Date(Date.now()-(index+1)*86400000).toISOString(),state:'saved'});
}
function previewMailSearch(args){
 const query=(args.query||'').trim(),terms=query.toLowerCase().split(/\s+/).filter(Boolean),filters=args.filters||{};
 let matches=mails.map(row=>{const mail=previewMail(row.id);return {row,mail};}).filter(({row,mail})=>{
  const date=new Date(row.date),now=new Date();now.setHours(0,0,0,0);
  if(filters.period==='unknown')return false;
  if(['7','30'].includes(filters.period)&&date.getTime()<now.getTime()-(Number(filters.period)-1)*86400000)return false;
  if(filters.period==='custom'&&(filters.from&&date<new Date(filters.from+'T00:00:00')||filters.to&&date>=new Date(new Date(filters.to+'T00:00:00').getTime()+86400000)))return false;
  if(filters.senders?.length&&!filters.senders.some(sender=>mail.from.toLowerCase().includes(sender.toLowerCase())))return false;
  if(filters.attachment==='with'&&!mail.attachments.length||filters.attachment==='without'&&mail.attachments.length)return false;
  if(filters.pinned&&!localMail(row.id).pinned)return false;
  if(filters.tags?.length&&!filters.tags.every(tag=>localMail(row.id).tags.includes(tag)))return false;
  if(filters.filename&&!mail.attachments.some(item=>item.filename.toLowerCase().includes(filters.filename.toLowerCase())))return false;
  if(filters.types?.length&&!mail.attachments.some(a=>filters.types.includes(a.filename.endsWith('.pdf')?'pdf':a.filename.endsWith('.xlsx')?'excel':'other')))return false;
  return true;
 }).map(({row,mail})=>{
  const candidates=[{kind:'subject',text:mail.subject+' '+mail.from},{kind:'body',text:mail.text},...mail.attachments.flatMap(a=>[{kind:'attachment',attachmentId:a.id,filename:a.filename,text:a.filename,filenameOnly:true},...(a.segments||[]).map(s=>({...s,kind:'attachment',attachmentId:a.id,filename:a.filename}))])];
  const eligible=candidates.filter(candidate=>!filters.locations?.length||filters.locations.includes(candidate.kind));
  const hit=query?eligible.find(candidate=>terms.every(term=>candidate.text.toLowerCase().includes(term))):eligible[0];if(!hit)return null;
  const at=terms.length?Math.max(0,hit.text.toLowerCase().indexOf(terms[0])-35):0,{text,...match}=hit;
  return {...row,local:structuredClone(localMail(row.id)),title:row.subject,sourceId:row.id,sourceHash:'preview-mail-hash',fetchedAt:row.date,attachmentCount:mail.attachments.length,unreadAttachments:mail.attachments.filter(a=>a.contentState!=='document_read').length,match:{...match,excerpt:text.slice(at,at+210)},excerpt:text.slice(at,at+210),bodyExcerpt:mail.text.slice(0,210)};
 }).filter(Boolean);
 matches.sort((a,b)=>args.sort==='oldest'?a.date.localeCompare(b.date):b.date.localeCompare(a.date));
 const fingerprint=encodeURIComponent(JSON.stringify([query,filters,args.sort,args.limit,[...mailLocal]])),saved=args.cursor?JSON.parse(atob(args.cursor)):null,reset=!!saved&&saved.fingerprint!==fingerprint,limit=args.limit||20,totalPages=Math.ceil(matches.length/limit),encode=offset=>btoa(JSON.stringify({offset,fingerprint}));
 let offset=!reset&&saved?saved.offset:0;if(args.page&&!reset)offset=(Math.min(args.page,Math.max(1,totalPages))-1)*limit;
 return {scope:'personal-mail',query,total:matches.length,totalPages,page:matches.length?Math.floor(offset/limit)+1:0,offset,reset,currentCursor:encode(offset),results:matches.slice(offset,offset+limit),nextCursor:offset+limit<matches.length?encode(offset+limit):null,unavailable:[],unreadAttachments:matches.reduce((sum,row)=>sum+row.unreadAttachments,0),bodyTruncated:0};
}
const status=()=>({provider:selected,providers:[['aipro','AI Pro'],['chatgpt','ChatGPT'],['fabrix','FabriX']].map(([id,label])=>({id,label,connected:connected&&selected===id})),connected,verified:false,pending:null,loginError:modelError,reasoningEffort:selected==='fabrix'?null:reasoning,model:connected?model:'',models:connected?[{id:'preview-qwen',label:'Qwen (미리보기)',contextLength:262144},{id:'preview-codex',label:'Codex (미리보기)',contextLength:262144}]:[]});
// Opt-in mail display examples have no account, password or POP3 connection.
function previewMailStatus(){
 const counts={received:mails.length,queued:mails.filter(row=>row.state==='queued').length,saved:mails.filter(row=>row.state==='saved').length,attention:0};
 const base={connected:false,autoWiki:false,counts,messages:mails,rawRoot:'/preview/personal/raw',wikiRoot:'/preview/personal/wiki',server:{host:'pop3.samsung.net',port:995,tls:true}};
 if(!mailExample)return base;
 return {...base,connected:mailExampleConnected,autoWiki:mailExampleAuto,watchPaused:mailExample==='paused',serverProfile:mailExampleServer,destination:mailExampleModel,catalogs:[{provider:selected,models:status().models}],rawRoot:'/preview/personal/raw',wikiRoot:'/preview/personal/wiki',progress:{
  // OFF deliberately retains an older pause snapshot to check control priority.
  stage:!mailExampleAuto||mailExample==='paused'?'paused':counts.queued?'queued':'watching',completed:counts.saved,queued:counts.queued,remaining:null,attention:0
 }};
}
const hash=async text=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

// Source examples are opt-in and visibly synthetic, never real account evidence.
const previewSourcesReady=(async()=>{if(params.has('sources')&&project.tasks.length){
 project.tasks[0].request='/wiki 프로젝트의 시작 흐름을 알려줘.';
 const wiki={kind:'wiki',citationId:'s-'+ 'a'.repeat(24),href:'#nubi-cite-s-'+ 'a'.repeat(24),number:1,title:'프로젝트 안내',path:'openwiki/프로젝트.md',hash:await hash(files['openwiki/프로젝트.md']),start:1,end:3};
 const mail={kind:'mail',citationId:'s-'+ 'b'.repeat(24),href:'#nubi-cite-s-'+ 'b'.repeat(24),number:2,id:'mail-1',sourceHash:'preview-mail-hash',title:mails[0].subject,from:mails[0].from,date:today};
 const attachment={...mail,citationId:'s-'+'c'.repeat(24),href:'#nubi-cite-s-'+'c'.repeat(24),number:3,attachmentId:'attachment-1',attachmentHash:'preview-attachment-hash',filename:'프로젝트 안내.md',location:{page:1}};
 project.tasks[0].messages=[{...previewAnswer('**프로젝트 자료를 확인하고 다음 작업을 정리합니다.**\n\n위키에는 파일과 대화를 한곳에서 이어가는 흐름이 정리되어 있습니다. [1]('+wiki.href+')\n\n메일에는 프로젝트 시작 자료가 첨부되어 있습니다. [2]('+mail.href+')\n\n첨부 첫 쪽에서는 프로젝트의 파일과 이력을 먼저 확인하도록 안내합니다. [3]('+attachment.href+')\n\n이 답변과 출처는 화면 확인용 예시이며 실제 모델을 호출하지 않았습니다.'),sourceReferences:[wiki,mail,attachment],consultedSources:[]}];
}})();

window.nubi={request:async(method,args={})=>{
 await previewSourcesReady;
 switch(method){
 case 'openCurrent':case 'overview':case 'chooseFolder':case 'importProject':case 'cloneRepository':return structuredClone(project);
 case 'state':return structuredClone(project);
 case 'provider':if(args.action==='login'){connected=true;modelError=null;selected=args.input?.provider||'aipro';}if(args.action==='logout')connected=false;if(args.action==='select'){model=args.input?.model||model;selected=args.input?.provider||selected;}if(args.action==='reasoning'){if(!connected||selected==='fabrix')return {__nubiError:'reasoning_unsupported'};if(args.input.expectedProvider!==selected||args.input.expectedModel!==model)return {__nubiError:'reasoning_changed'};reasoning=args.input.effort;}if(args.action==='verify')return {__nubiError:'preview_only'};return status();
 case 'approvalMode':return {mode:'ask',allowedCommands:[]};
 case 'wikiInitialization':return {state:'existing',percent:null};
 case 'editorSource':case 'read':{const content=files[args.path]||'';return {uri:'file:///preview/'+args.path,root:'/preview/nubi',path:args.path,content,hash:await hash(content)};}
 case 'browseDirectory':{const prefix=args.path?args.path+'/':'',entries=new Map();for(const file of Object.keys(files)){if(!file.startsWith(prefix))continue;const rest=file.slice(prefix.length),name=rest.split('/')[0],directory=rest.includes('/'),rel=prefix+name;entries.set(rel,{id:rel,name,path:rel,directory,extension:directory?'':name.split('.').at(-1)});}return {relative:args.path||'',absolute:'/preview/nubi'+(args.path?'/'+args.path:''),entries:[...entries.values()],truncated:false};}
 case 'saveSource':files[args.path]=args.content;return {hash:await hash(args.content)};
 case 'appliedFileSummary':return {files:await Promise.all(project.proposals.map(async(row,index)=>({path:row.path,hash:await hash(files[row.path]),state:'verified',stats:{state:'counted',added:5+index,removed:index}}))),total:project.proposals.length,totals:{added:11,removed:1},truncated:false};
 case 'workspaceChanges':return args.path?{patch:'diff --git a/src/welcome.js b/src/welcome.js\n- export const greeting = "안녕하세요";\n+ export const greeting = "누비에게 맡겨 주세요";'}:{entries:[{path:'src/welcome.js',state:'modified'}]};
 case 'commitHistory':{
  const commits=[{id:'a'.repeat(40),subject:'프로젝트의 시작 화면 정리',author:'Nubi (예시)',date:today},{id:'b'.repeat(40),subject:'프로젝트 문서 추가',author:'Nubi (예시)',date:today}],branches=[{ref:'refs/heads/main',name:'main',tip:commits[0].id}];
  if(!args.commit)return {commits,branches,currentBranch:'refs/heads/main',branch:args.branch||'HEAD',tip:commits[0].id};
  const commit={...commits.find(item=>item.id===args.commit),parents:[commits[1].id],parent:commits[1].id};
  const changed=[{path:'src/welcome.js',status:'M',added:2,removed:1,beforeMode:'100644',afterMode:'100644'},{path:'README.md',status:'M',added:1,removed:1,beforeMode:'100644',afterMode:'100644'}];
  if(args.view==='files')return {commit,files:changed,totalFiles:changed.length,excludedCount:0,truncated:false};
  if(args.path){const row=changed.find(item=>item.path===args.path);return {...row,commit:args.commit,parent:commit.parent,unavailable:null,before:args.path==='README.md'?'# 프로젝트\n':'export const greeting = "안녕하세요";\n',after:files[args.path]};}
  return {commit:args.commit,patch:'화면 검토용 변경 예시',truncated:false};
 }
 case 'search':return {results:Object.entries(files).filter(([p,t])=>(p+t).includes(args.query)).map(([p,t])=>({path:p,line:1,excerpt:t.slice(0,120)}))};
 case 'terminalCommand':{
  if(!params.has('terminal-recovery'))return {state:'completed',exitCode:0,output:'화면 미리보기예요. 명령은 실행하지 않았습니다.\n',relative:args.path||''};
  if(!args.action||args.action==='run'){
   const previous=terminalExamples.get(args.requestId);if(previous)return previous.record;
   const example={record:{id:crypto.randomUUID(),state:'running',execution:'started',output:'예시 명령 / 실행 1회\n',relative:args.path||'',exitCode:null},at:Date.now(),reads:0};terminalExamples.set(args.requestId,example);
   if(params.get('terminal-recovery')==='launch')return {__nubiError:'host_timeout'};return example.record;
  }
  const example=args.action==='receipt'?terminalExamples.get(args.requestId):[...terminalExamples.values()].find(item=>item.record.id===args.id);if(!example)return {state:'unknown'};
  if(args.action==='stop'){example.record={...example.record,state:'cancelled',exitCode:null};return example.record;}
  example.reads++;if(example.reads<=3)return {__nubiError:'host_timeout'};
  if(Date.now()-example.at>18000&&example.record.state==='running')example.record={...example.record,state:'completed',exitCode:0,output:example.record.output+'예시 실행 완료\n'};
  return {...example.record};
 }
 case 'mail':if(args.action==='facets')return {senders:[],tags:[...new Set([...mailLocal.values()].flatMap(item=>item.tags))],saved:[...savedMailSearches.values()]};
 if(args.action==='updateLocal'){if(params.has('mail-local-error'))return {__nubiError:'mail_storage_failed'};previewMail(args.id);const value={...localMail(args.id),...args.patch};mailLocal.set(args.id,value);return structuredClone(value);}
 if(args.action==='saveSearch'){const value={id:crypto.randomUUID(),name:args.name,query:args.query,filters:structuredClone(args.filters),sort:args.sort};savedMailSearches.set(value.id,value);return value;}
 if(args.action==='removeSearch'){savedMailSearches.delete(args.id);return {removed:true};}
 if(args.action==='history'){const messages=mails.filter(r=>(r.subject+r.from).includes(args.query||''));return {messages,total:messages.length};}if(args.action==='search')return previewMailSearch(args);if(args.action==='evidence'){const mail=previewMail(args.id),attachment=args.attachmentId&&mail.attachments.find(item=>item.id===args.attachmentId);if(args.sourceHash!=='preview-mail-hash'||args.attachmentId&&!attachment)return {__nubiError:'mail_source_changed'};return {id:args.id,sourceHash:'preview-mail-hash',title:mail.subject,from:mail.from,date:mail.date,...attachment?{attachmentId:attachment.id,attachmentHash:attachment.sha256,filename:attachment.filename}:{},...args.location?{location:args.location}:{}};}if(args.action==='read'){if(params.has('mail-stale')&&args.id==='mail-1')await new Promise(resolve=>setTimeout(resolve,1800));return {id:args.id,local:structuredClone(localMail(args.id)),sourceHash:'preview-mail-hash',fetchedAt:today,mail:previewMail(args.id)};}if(mailExample==='form'&&args.action==='connect'){mailExampleConnected=true;mailExampleServer=args.serverProfile;}if(mailExample==='form'&&args.action==='disconnect')mailExampleConnected=false;if(mailExample&&args.action==='setAutoWiki')mailExampleAuto=args.enabled;if(mailExample&&args.action==='setModel')mailExampleModel=args.destination;return previewMailStatus();
 case 'downloadMail':return {previewOnly:true};
 case 'mailDocument':{const attachment=previewMail(args.id).attachments.find(a=>a.id===args.attachmentId);if(!attachment||attachment.contentState!=='document_read')return {__nubiError:'document_password'};return {sourceHash:'preview-mail-hash',attachmentHash:attachment.sha256,segments:attachment.segments,title:attachment.filename,text:attachment.segments.map(s=>s.text).join('\n\n'),coverage:'화면 검토용 예시 문서',model:'미리보기',...(args.action==='ask'?{answer:'이 화면은 문서를 읽고 질문하는 흐름의 미리보기입니다. 실제 모델은 호출하지 않았습니다.'}:{})};}
 case 'listSkills':return params.has('skills-error')?{__nubiError:'preview_only'}:{skills:structuredClone(previewSkills),unavailable:[],issues:[],truncated:false};
 case 'chooseSkillPackage':{const name='registered-preview',existing=previewSkills.find(item=>item.name===name);if(existing)return {...existing,noChange:true};const item={name,title:'새 스킬 (미리보기)',description:'등록 후 목록 복귀를 확인하는 화면 예시입니다.',path:`.agents/skills/${name}/SKILL.md`,origin:'custom',managed:true,packageHash:'preview:'+name};previewSkills.unshift(item);files[item.path]=`---\nname: ${name}\ndescription: 화면 확인용 스킬\n---\n\n등록 화면의 예시입니다.\n`;project.files=Object.keys(files);return item;}
 case 'removeSkill':{const index=previewSkills.findIndex(item=>item.name===args.name);if(index<0)return {__nubiError:'skill_import_changed'};const item=previewSkills[index];if(args.preview)return {...item,fileCount:1};if(params.has('skill-remove-error')||item.packageHash!==args.expectedHash)return {__nubiError:'skill_import_changed'};previewSkills.splice(index,1);previewSkillTrash.unshift({...item,id:crypto.randomUUID(),removedAt:new Date().toISOString()});return {removed:true,name:item.name};}
 case 'skillTrash':{if(!args.operation||args.operation==='list')return {items:structuredClone(previewSkillTrash)};const index=previewSkillTrash.findIndex(item=>item.id===args.trashId&&item.name===args.name&&item.packageHash===args.expectedHash);if(index<0)return {__nubiError:'skill_import_changed'};if(previewSkills.some(item=>item.name===args.name))return {__nubiError:'skill_exists'};previewSkills.unshift(previewSkillTrash.splice(index,1)[0]);return {restored:true,name:args.name};}
 case 'connectMarketplace':if(!companyConnected)return {loginRequired:true};companyReady=true;return {credentialsReady:true};
 case 'skillMarketplace':{
  if(args.operation==='refresh'&&companyReady&&['network','permission','sso'].includes(companyExample))return {__nubiError:{network:'marketplace_network',permission:'ghes_permission',sso:'ghes_sso_required'}[companyExample]};
  if(args.operation==='remove'&&params.has('marketplace-remove-error'))return {__nubiError:'marketplace_modified'};
  if(companyReady&&args.operation==='remove')companyInstalled=false;
  if(companyReady&&args.operation==='install')companyInstalled=true;
  const item={id:'preview-company-skill',name:'project-review',title:'프로젝트 검토 (미리보기)',description:'회사 스킬 목록을 불러온 화면의 예시입니다.',version:'1.0.0',commit:'a'.repeat(40),state:companyInstalled?'installed':'available'};
  return {connected:companyReady,credentialsReady:companyReady,loginRequired:!companyReady,skills:[],installed:companyReady&&companyInstalled?[{...item,state:'installed'}]:[],issues:[],items:companyReady?[item]:[]};
 }
 case 'ghesAccount':if(args.operation==='login'){if(!companyExample)return {__nubiError:'preview_only'};companyConnected=false;companyReady=false;companyLoginStarted=Date.now();}if(['cancel','logout'].includes(args.operation)){companyConnected=false;companyReady=false;companyLoginStarted=0;}return companyState();
 case 'deleteTask':project.tasks=project.tasks.filter(t=>t.id!==args.taskId);return true;
 case 'createTask':{const task={id:crypto.randomUUID(),request:args.request,requestMailReferences:args.mailReferences||[],mailReferences:args.mailReferences||[],criteria:[],state:'review',createdAt:today,trace:[],messages:[previewAnswer('화면 미리보기입니다. 실제 모델은 호출하지 않았어요. 파일과 메일을 열어 화면 흐름을 확인해 보세요.')]};project.tasks.unshift(task);return structuredClone(task);}
 case 'regenerateAnswer':{const task=project.tasks.find(item=>item.id===args.taskId);if(!task||task.messages.at(-1)?.id!==args.messageId)return {__nubiError:'answer_changed'};task.messages.push({...previewAnswer('**답변을 다시 작성했어요.**\n\n이 답변은 화면 확인용 예시입니다. 실제 모델 호출이나 파일 수정, 명령 실행은 하지 않았습니다.'),regeneratedFrom:args.messageId});return {taskId:task.id,state:'review'};}
 case 'saveQuestionDraft':{const task=project.tasks.find(item=>item.id===args.taskId);if(task?.question?.id!==args.questionId)return {__nubiError:'question_changed'};task.question.draft=args.draft;return {saved:true};}
 case 'answerAgent':{const task=project.tasks.find(item=>item.id===args.taskId),question=task?.question;if(!question||args.choice?.questionId!==question.id)return {__nubiError:'question_changed'};const text=args.choice.text||question.options.find(option=>option.id===args.choice.optionId)?.label;if(!text)return {__nubiError:'answer_invalid'};task.activityHistory.push({runId:question.runId,state:task.state,question:{id:question.id,kind:question.kind},workPlan:structuredClone(task.workPlan),trace:structuredClone(task.trace),responseTiming:task.responseTiming,afterMessageId:task.messages.at(-1)?.id});task.questionHistory=[{...question,answer:{text,at:new Date().toISOString()}}];task.question=null;task.messages.push({id:crypto.randomUUID(),role:'user',content:text,at:new Date().toISOString()},previewAnswer('선택한 방향을 확인했어요. 이 화면은 폼과 진행 기록의 연결을 보여주는 예시이며 실제 모델이나 파일은 변경하지 않았습니다.'));task.responseTiming={...task.messages.at(-1).responseTiming,runId:crypto.randomUUID()};task.state='review';return {taskId:task.id,state:'review'};}
 case 'agentInput':{const task=project.tasks.find(item=>item.id===args.taskId);if(!task)return {__nubiError:'agent_input_closed'};task.inbox ||= [];if(args.action==='enqueue'){if(!task.inbox.some(item=>item.id===args.id))task.inbox.push({id:args.id,text:args.text,mailReferences:args.mailReferences||[],mode:args.mode,runId:task.checkpoint?.runId});return structuredClone(task);}if(args.action==='remove'){const index=task.inbox.findIndex(item=>item.id===args.id);if(index<0)return {__nubiError:'agent_input_changed'};const item=task.inbox.splice(index,1)[0];return {text:item.text,mailReferences:item.mailReferences};}return {__nubiError:'preview_only'};}
 case 'startAgent':case 'resumeAgent':{const task=project.tasks.find(item=>item.id===args.taskId);if(args.answer&&task){task.messages.push({id:crypto.randomUUID(),role:'user',content:args.answer,mailReferences:args.mailReferences||[],at:new Date().toISOString()},previewAnswer('메일과 첨부 연결을 확인하는 화면 예시예요. 실제 모델은 호출하지 않았어요.'));}return true;}
 default:return {__nubiError:'preview_only'};
 }
}};
if(params.has('conversation'))localStorage.setItem('nubi-session-tabs-v1:visual-preview',JSON.stringify({tabs:['preview-conversation'],selected:'preview-conversation'}));
