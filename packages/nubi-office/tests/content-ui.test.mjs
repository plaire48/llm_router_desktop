import './ui-source-loader.mjs';
import test,{after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html lang="ko"><body></body></html>',{url:'https://nubi.test',pretendToBeVisual:true});
for(const name of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','getComputedStyle','innerWidth','innerHeight'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.__APP_VERSION__='source-test';
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});dom.window.HTMLElement.prototype.scrollIntoView=function(){};
let receive,currentHost='word',catalogHandler;const calls=[];
globalThis.chrome={webview:{addEventListener:(_event,fn)=>{receive=fn;},postMessage:({id,method,payload})=>{
  calls.push({method,payload});let result;
  if(catalogHandler&&['document_skill_list','document_skill_import','template_catalog_list','template_catalog_use','office_read','runStart'].includes(method))result=catalogHandler(method,payload);
  else if(method==='session')result={host:currentHost,provider:'aipro',connected:true,model:'test-model',models:[{id:'test-model',label:'Test model'}],providers:[{id:'aipro',connected:true},{id:'chatgpt',connected:false},{id:'fabrix',connected:false}]};
  else if(method==='history')result=[];
  else if(method==='selection')result={host:currentHost,name:'현재 문서',scopeId:'s',documentId:'d',nextOffset:null,items:[{id:currentHost==='word'?'p-1':'s-1/h-1',kind:currentHost==='word'?'paragraph':'shape',style:'제목',text:'확인할 내용',editable:true}]};
  else throw new Error('Unexpected UI RPC '+method);
  queueMicrotask(()=>receive({data:{id,ok:true,result}}));
}}};
const React=await import('react'),{render,screen,fireEvent,cleanup,waitFor}=await import('@testing-library/react');
const {default:App}=await import('../src/App.jsx');
const {OfficeTransaction}=await import('../src/OfficeTransaction.jsx');
const {taskView}=await import('../src/task-view.js');
const {errorText}=await import('../src/errors.js');
const {ContentDetails}=await import('../src/ContentDetails.jsx');
const {OfficeTemplates}=await import('../src/OfficeTemplates.jsx');
const {OfficeSkills}=await import('../src/OfficeSkills.jsx');
const axe=(await import('axe-core')).default;
afterEach(()=>{cleanup();calls.length=0;catalogHandler=undefined;});after(()=>dom.window.close());
test('real App keeps Nubi identity while showing host-specific welcome, input and tools',async()=>{
  for(const [host,name,subject,selection] of [['word','Word','워드','선택한 내용 확인'],['powerpoint','PowerPoint','파워포인트','선택한 슬라이드 확인']]){
    currentHost=host;const view=render(React.createElement(App));
    const composer=await screen.findByRole('textbox',{name:name+' 작업 요청'});
    assert.equal(composer.hasAttribute('title'),false);
    assert.ok(screen.getByText(subject+'를 누비는 AI Agent, 누비'));assert.ok(screen.getByText('누비에게 무엇을 맡길까요?'));
    assert.equal(calls.some(c=>c.method==='selection'),false);
    fireEvent.click(screen.getByRole('button',{name:'더 보기'}));
    assert.equal(screen.queryByRole('button',{name:'등록 양식 사본 열기'}),null);
    assert.equal(screen.queryByRole('button',{name:'변경 기록'}),null);
    fireEvent.click(screen.getByRole('button',{name:selection}));
    await screen.findByText('확인할 내용');assert.equal(calls.filter(c=>c.method==='selection').length,1);assert.equal(calls.some(c=>c.method==='read'),false);
    fireEvent.click(screen.getByRole('button',{name:'이 부분에 요청'}));
    assert.match(screen.getByRole('textbox',{name:name+' 작업 요청'}).value,new RegExp(name));
    view.unmount();calls.length=0;
  }
});
test('approval and recovery never mislabel Word or PowerPoint work as Excel',()=>{
  const view=render(React.createElement(OfficeTransaction,{approval:{payload:{host:'powerpoint',title:'반영할까요?',summary:'슬라이드 제목 수정',target:'s-1/h-1',verification:'원본 확인',operations:[{type:'replace_text',targetId:'s-1/h-1',text:'내용'}]}},onDecision(){}}));
  assert.ok(screen.getByLabelText('PowerPoint 반영 확인'));assert.equal(view.container.textContent.includes('Excel'),false);
  assert.match(taskView({host:'word',state:'failed'}).hint,/Word/);
  for(const host of ['word','powerpoint'])for(const code of ['office_timeout','unsupported_target','observation_invalid','source_changed','document_save_uncertain','verification_required','run_expired'])assert.doesNotMatch(errorText(code,host),/Excel|셀|시트|NubiOffice/);
  assert.equal(taskView({kind:'office',host:'powerpoint',state:'done',task:{save:true},artifact:{saved:true}}).summary,'문서 검토와 파일 저장을 마쳤습니다.');
});

test('Word field inspection presents the observed business label and empty-state meaning',()=>{
  let selected;
  render(React.createElement(ContentDetails,{host:'word',scope:{name:'신청서',nextOffset:null,items:[{id:'cc-42',kind:'field',title:'사업부',text:'Click here',showingPlaceholder:true,editable:true}]},onClose(){},onRefresh(){},onRequest:id=>{selected=id;}}));
  assert.ok(screen.getByText('사업부'));assert.ok(screen.getByText('아직 입력하지 않은 항목'));assert.equal(screen.queryByText('Click here'),null);
  fireEvent.click(screen.getByRole('button',{name:'이 부분에 요청'}));assert.equal(selected,'cc-42');
});

test('copy approval labels the copy action and keeps rejection available',()=>{
  let decision;
  render(React.createElement(OfficeTransaction,{approval:{payload:{host:'word',kind:'template_copy',title:'원본을 보존할 사본을 만들까요?',summary:'요청한 양식 작성',target:'원본.docx',verification:'열린 문서가 사본으로 전환됩니다.'}},onDecision:value=>{decision=value;}}));
  fireEvent.click(screen.getByRole('button',{name:'사본 만들기'}));assert.equal(decision,true);
  fireEvent.click(screen.getByRole('button',{name:'취소'}));assert.equal(decision,false);
  assert.ok(screen.getByText('열린 문서가 사본으로 전환됩니다.'));
  assert.match(errorText('content_copy_mismatch','word'),/입력을 멈췄습니다/);
  assert.match(errorText('template_source_unsaved','powerpoint'),/원본 양식을 저장/);
});

const catalogId='f00dbabe-0000-4000-8000-000000000001';
const catalogEntry=host=>({id:catalogId,host,name:'분기 보고 양식',summary:'선택한 입력 항목을 사용합니다.',revision:1,itemCount:4,inputCount:2,available:true,sourceFile:'보고서',protection:'windows_current_user'});
test('composer plus opens the host catalog and selected Word template binds subsequent chat to that document',async()=>{
  currentHost='word';const entry=catalogEntry('word'),scope={host:'word',scopeId:'registered-source',documentId:'registered-source',fingerprint:'f1',items:[],offset:0,total:0,nextOffset:null,created:false};
  catalogHandler=(method,payload)=>{
    if(method==='template_catalog_list')return{host:'word',entries:[entry],unreadable:0};
    if(method==='template_catalog_use')return{loaded:true,entry,scope,usageNotes:'등록 시 확인한 업무 규칙'};
    if(method==='office_read'){assert.equal(payload.scopeId,scope.scopeId);return scope;}
    return{id:'run',host:'word',kind:'office',state:'done',answer:'내용을 확인했습니다.',writes:0};
  };
  render(React.createElement(App));await screen.findByRole('textbox',{name:'Word 작업 요청'});
  fireEvent.click(screen.getByRole('button',{name:'Word 양식 등록과 관리'}));await screen.findByText('분기 보고 양식');
  fireEvent.click(screen.getByRole('button',{name:'이 양식으로 작성'}));await screen.findByRole('button',{name:'양식 연결 해제'});
  const input=screen.getByRole('textbox',{name:'Word 작업 요청'});fireEvent.change(input,{target:{value:'다음 분기 계획을 채워줘'}});fireEvent.click(screen.getByRole('button',{name:'전송'}));
  await screen.findByText('내용을 확인했습니다.');await screen.findByRole('button',{name:'전송'});
  const start=calls.find(c=>c.method==='runStart');assert.equal(start.payload.scope.scopeId,'registered-source');assert.equal(start.payload.contentTemplate.id,catalogId);assert.equal(start.payload.contentTemplate.usageNotes,'등록 시 확인한 업무 규칙');assert.equal(calls.some(c=>c.method==='selection'),false);
});
test('current-form registration button starts an explicit analysis run without clearing a pending draft',async()=>{
  currentHost='powerpoint';catalogHandler=method=>method==='template_catalog_list'?{host:'powerpoint',entries:[],unreadable:0}:{id:'registration',host:'powerpoint',kind:'office',state:'done',answer:'양식 분석을 확인했습니다.',writes:0};
  render(React.createElement(App));const input=await screen.findByRole('textbox',{name:'PowerPoint 작업 요청'});fireEvent.change(input,{target:{value:'나중에 작성할 요청'}});
  fireEvent.click(screen.getByRole('button',{name:'PowerPoint 양식 등록과 관리'}));await screen.findByText('등록한 양식이 없습니다');fireEvent.click(screen.getByRole('button',{name:'현재 양식 등록'}));
  await screen.findByText('양식 분석을 확인했습니다.');await screen.findByRole('button',{name:'전송'});assert.equal(calls.find(c=>c.method==='runStart').payload.mode,'template-register');assert.equal(input.value,'나중에 작성할 요청');
});
test('catalog manages names and removal with revision checks while missing files cannot be used',async()=>{
  let entries=[catalogEntry('word'),{...catalogEntry('word'),id:'f00dbabe-0000-4000-8000-000000000002',name:'이동한 양식',available:false}];const writes=[];
  const call=async(method,payload)=>{
    if(method==='template_catalog_list')return{host:'word',entries,unreadable:0};writes.push({method,payload});
    assert.equal(payload.revision,entries[0].revision);
    if(method==='template_catalog_rename'){entries=[{...entries[0],name:payload.name,revision:2},entries[1]];return entries[0];}
    entries=entries.slice(1);return{removed:true,id:payload.templateId};
  };
  render(React.createElement(OfficeTemplates,{host:'word',hostName:'Word',call,onUse(){assert.fail('Missing source must not be used');},onRegister(){},onClose(){}}));
  await screen.findByText('이동한 양식');assert.equal(screen.getAllByRole('button',{name:'이 양식으로 작성'}).filter(button=>button.disabled).length,1);
  const search=screen.getByRole('searchbox',{name:'양식 검색'});
  fireEvent.change(search,{target:{value:'이동'}});assert.equal(screen.queryByRole('button',{name:'분기 보고 양식 이름 변경'}),null);assert.equal(screen.getByRole('button',{name:'이 양식으로 작성'}).disabled,true);
  fireEvent.change(search,{target:{value:'없는 양식'}});assert.ok(screen.getByText('검색 결과가 없습니다'));
  fireEvent.change(search,{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'분기 보고 양식 이름 변경'}));fireEvent.change(screen.getByRole('textbox',{name:'양식 이름 (필수)'}),{target:{value:'변경한 양식'}});fireEvent.click(screen.getByRole('button',{name:'이름 저장'}));
  await screen.findByText('변경한 양식');fireEvent.click(screen.getByRole('button',{name:'변경한 양식 목록에서 제거'}));fireEvent.click(screen.getByRole('button',{name:'목록에서 제거'}));
  await screen.findByRole('button',{name:'이동한 양식 이름 변경'});assert.deepEqual(writes.map(c=>c.method),['template_catalog_rename','template_catalog_remove']);assert.ok(writes.every(c=>c.payload.operationId));
});
test('template dialogs expose host-specific accessible controls in populated, editing and empty states',async()=>{
  for(const [host,hostName] of [['excel','Excel'],['word','Word'],['powerpoint','PowerPoint']]){
    const view=render(React.createElement(OfficeTemplates,{host,hostName,call:async()=>({host,entries:[catalogEntry(host)],unreadable:0}),onUse(){},onRegister(){},onClose(){}}));
    await screen.findByRole('button',{name:'이 양식으로 작성'});
    assert.ok(screen.getByRole('dialog',{name:hostName+' 양식'}));
    fireEvent.click(screen.getByRole('button',{name:'분기 보고 양식 이름 변경'}));
    const result=await axe.run(document.body,{rules:{'color-contrast':{enabled:false}}});
    assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],host);
    view.unmount();
  }
  render(React.createElement(OfficeTemplates,{host:'word',hostName:'Word',call:async()=>({host:'word',entries:[],unreadable:0}),onUse(){},onRegister(){},onClose(){}}));
  await screen.findByText('등록한 양식이 없습니다');
  assert.ok(screen.getByRole('button',{name:'현재 양식 등록'}));
  const result=await axe.run(document.body,{rules:{'color-contrast':{enabled:false}}});
  assert.deepEqual(result.violations.map(v=>v.id),[]);
});

test('compact catalog icons disclose evidence, cancel editing and clear search without mutations',async()=>{
  const entry=catalogEntry('word'),calls=[];
  render(React.createElement(OfficeTemplates,{host:'word',hostName:'Word',call:async method=>{calls.push(method);return{host:'word',entries:[entry],unreadable:0};},onUse(){},onRegister(){},onClose(){}}));
  const info=await screen.findByRole('button',{name:'분기 보고 양식 스냅샷 정보'});
  assert.equal(info.getAttribute('aria-expanded'),'false');
  const detail=document.getElementById(info.getAttribute('aria-controls'));assert.equal(detail.hidden,true);
  fireEvent.click(info);assert.equal(detail.hidden,false);assert.ok(detail.textContent.includes(entry.summary));
  fireEvent.click(info);assert.equal(detail.hidden,true);
  const edit=screen.getByRole('button',{name:'분기 보고 양식 이름 변경'});
  fireEvent.click(edit);fireEvent.click(screen.getByRole('button',{name:'이름 변경 취소'}));assert.equal(document.activeElement,edit);
  const remove=screen.getByRole('button',{name:'분기 보고 양식 목록에서 제거'});
  fireEvent.click(remove);assert.ok(screen.getByText(/양식 파일은 남습니다/));fireEvent.click(screen.getByRole('button',{name:'목록 제거 취소'}));assert.equal(document.activeElement,remove);
  const search=screen.getByRole('searchbox',{name:'양식 검색'});
  fireEvent.change(search,{target:{value:'없는 양식'}});fireEvent.click(screen.getByRole('button',{name:'검색 지우기'}));assert.equal(document.activeElement,search);assert.equal(search.value,'');assert.ok(screen.getByText(entry.name));
  assert.deepEqual(calls,['template_catalog_list']);
});


test('visible shared toast has a named region and passes accessibility checks',async()=>{
  const {notifyToast}=await import('@e2e/cx-design-system');
  const {act}=await import('@testing-library/react');
  await act(async()=>notifyToast('계산 결과를 확인했습니다.',{source:'quality-review'}));
  const region=await screen.findByRole('region',{name:'알림'});
  assert.ok(region.querySelector('[role="status"]'));
  const result=await axe.run(region,{rules:{'color-contrast':{enabled:false}}});
  assert.deepEqual(result.violations.map(v=>v.id),[]);
  await act(async()=>notifyToast('',{source:'quality-review'}));
});

test('incomplete native text explains the missing evidence without suggesting a connection failure',()=>{
  for(const host of ['word','powerpoint']){
    const message=errorText('evidence_incomplete',host);
    assert.match(message,/원문.*잘려/);assert.match(message,/기존 변경은 유지/);assert.doesNotMatch(message,/연결|설정|Excel|셀/);
  }
});

test('writing rules editor needs no form setup and preserves legacy requirements on save and re-entry',async()=>{
  const questions=[{question:'보고 대상은 누구인가요?',input_mode:'text',choices:[{label:'팀장'},{label:'임원'}]}];
  let stored=[{id:'00000000-0000-4000-8000-000000000077',host:'word',revision:1,name:'기존 작성 규칙',instructions:'기존 문서 작성 규칙',questions}],selected;
  const call=async(method,payload)=>{
    if(method==='document_skill_list')return{host:'word',entries:structuredClone(stored),unreadable:0};
    if(method==='document_skill_save'){stored=[structuredClone(payload.skill)];return structuredClone(payload.skill);}
    throw new Error('Unexpected skill call '+method);
  };
  render(React.createElement(OfficeSkills,{host:'word',hostName:'Word',onClose(){},onUse:value=>{selected=value;},call}));
  fireEvent.click(await screen.findByRole('button',{name:'기존 작성 규칙 수정'}));
  assert.equal(screen.getByRole('textbox',{name:'스킬 이름 (필수)'}).required,true);assert.equal(screen.getByRole('textbox',{name:'문서 형식과 작성 규칙 (필수)'}).required,true);
  assert.equal(screen.queryByRole('combobox',{name:'답변 방식'}),null);
  assert.equal(screen.queryByRole('button',{name:'입력 항목 추가'}),null);
  assert.ok(screen.getByText('보고 대상은 누구인가요?').closest('details'));
  fireEvent.change(screen.getByRole('textbox',{name:'스킬 이름 (필수)'}),{target:{value:'주간 보고서'}});
  fireEvent.change(screen.getByRole('textbox',{name:'문서 형식과 작성 규칙 (필수)'}),{target:{value:'요약, 실적, 계획 순서. 금액 단위는 천 원.'}});
  fireEvent.click(screen.getByRole('button',{name:'규칙 저장'}));
  await screen.findByText('주간 보고서');assert.deepEqual(stored[0].questions,questions);
  fireEvent.click(screen.getByRole('button',{name:'선택'}));assert.equal(selected.name,'주간 보고서');
  cleanup();render(React.createElement(OfficeSkills,{host:'word',hostName:'Word',onClose(){},onUse(){},call}));
  fireEvent.click(await screen.findByRole('button',{name:'주간 보고서 수정'}));
  assert.equal(screen.getByRole('textbox',{name:'문서 형식과 작성 규칙 (필수)'}).value,stored[0].instructions);
  assert.ok(screen.getByText('보고 대상은 누구인가요?'));
  const result=await axe.run(document.body,{rules:{'color-contrast':{enabled:false}}});assert.deepEqual(result.violations.map(v=>v.id),[]);
});

test('composer selects a writing skill through plus and carries it with a registered template into runStart',async()=>{
  currentHost='word';const entry=catalogEntry('word'),scope={host:'word',scopeId:'registered-source',documentId:'registered-source',fingerprint:'f1',items:[],offset:0,total:0,nextOffset:null,created:false};
  const skill={id:catalogId,host:'word',revision:1,name:'임원 보고 스킬',instructions:'요약과 결론을 먼저 작성',questions:[]};
  catalogHandler=(method,payload)=>{
    if(method==='document_skill_list')return{host:'word',entries:[skill],unreadable:0};
    if(method==='template_catalog_list')return{host:'word',entries:[entry],unreadable:0};
    if(method==='template_catalog_use')return{loaded:true,entry,scope,usageNotes:'등록한 양식'};
    if(method==='office_read')return scope;
    return{id:'run',kind:'office',state:'done',answer:'검토했습니다.',writes:0};
  };
  render(React.createElement(App));await screen.findByRole('textbox',{name:'Word 작업 요청'});
  fireEvent.click(screen.getByRole('button',{name:'Word 양식 등록과 관리'}));
  fireEvent.click(await screen.findByRole('button',{name:'작성 스킬'}));
  fireEvent.click(await screen.findByRole('button',{name:'선택'}));
  await screen.findByRole('button',{name:'작성 스킬 연결 해제'});
  fireEvent.click(screen.getByRole('button',{name:'Word 양식 등록과 관리'}));
  fireEvent.click(await screen.findByRole('button',{name:'이 양식으로 작성'}));
  await screen.findByRole('button',{name:'양식 연결 해제'});assert.ok(screen.getByRole('button',{name:'작성 스킬 연결 해제'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Word 작업 요청'}),{target:{value:'이 양식과 스킬로 보고서를 작성해줘'}});
  fireEvent.click(screen.getByRole('button',{name:'전송'}));await screen.findByText('검토했습니다.');
  const started=calls.find(c=>c.method==='runStart').payload;assert.deepEqual(started.documentSkill,skill);assert.equal(started.contentTemplate.scopeId,'registered-source');
});

test('imported package is connected to the current chat without a second selection',async()=>{
  currentHost='word';
  const skill={id:'00000000-0000-4000-8000-000000000089',host:'word',revision:1,name:'team-writing',instructions:'Write with team style',questions:[],package:{version:1,sha256:'b'.repeat(64),fileCount:2,totalBytes:240}};
  let stored=[];
  catalogHandler=(method)=>{
    if(method==='document_skill_list')return{host:'word',entries:stored,unreadable:0};
    if(method==='document_skill_import'){stored=[skill];return skill;}
    return{id:'run',kind:'office',state:'done',answer:'확인했습니다.',writes:0};
  };
  render(React.createElement(App));await screen.findByRole('textbox',{name:'Word 작업 요청'});
  fireEvent.click(screen.getByRole('button',{name:'Word 양식 등록과 관리'}));
  fireEvent.click(await screen.findByRole('button',{name:'작성 스킬'}));
  fireEvent.click(await screen.findByRole('button',{name:'ZIP 등록'}));
  await screen.findByText('team-writing 등록 완료. 다음 요청에 사용합니다.');
  fireEvent.click(screen.getByRole('button',{name:'닫기'}));
  await screen.findByRole('button',{name:'작성 스킬 연결 해제'});
  fireEvent.change(screen.getByRole('textbox',{name:'Word 작업 요청'}),{target:{value:'팀 문체로 보고서 작성'}});
  fireEvent.click(screen.getByRole('button',{name:'전송'}));await screen.findByText('확인했습니다.');
  assert.deepEqual(calls.find(c=>c.method==='runStart').payload.documentSkill,skill);
});

test('ZIP and folder registration replace report starters and show nested resources after reentry',async()=>{
  const skill={id:'00000000-0000-4000-8000-000000000088',host:'excel',revision:1,name:'company-report',instructions:'Company document style',questions:[],package:{version:1,sha256:'a'.repeat(64),fileCount:3,totalBytes:800}};
  const methods=[];let stored=[],selected,imported;
  const call=async(method,payload)=>{
    methods.push({method,payload});
    if(method==='document_skill_list')return{host:'excel',entries:stored,unreadable:0};
    if(method==='document_skill_import'){assert.equal(payload.kind,'zip');stored=[skill];return skill;}
    if(method==='document_skill_manifest')return{skill,files:[{path:'SKILL.md'},{path:'references/team/style.md'},{path:'scripts/tables/calculate.py'}]};
    throw new Error('unexpected_call');
  };
  render(React.createElement(OfficeSkills,{host:'excel',hostName:'Excel',onClose(){},onUse:s=>{selected=s;},onImported:s=>{imported=s;},call}));
  await waitFor(()=>assert.equal(screen.getByRole('button',{name:'ZIP 등록'}).disabled,false));
  assert.equal(screen.queryByRole('button',{name:'보고서 스킬로 시작'}),null);
  fireEvent.click(screen.getByRole('button',{name:'ZIP 등록'}));await screen.findByText('company-report 등록 완료. 다음 요청에 사용합니다.');assert.deepEqual(imported,skill);assert.ok(screen.getByText('파일 3개'));
  fireEvent.click(screen.getByText('등록 범위'));assert.match(document.body.textContent,/파일 256개/);
  fireEvent.click(screen.getByRole('button',{name:'company-report 파일 목록'}));await screen.findByText('scripts/tables/calculate.py');assert.ok(screen.getByText('references/team/style.md'));
  const files=screen.getByRole('button',{name:'company-report 파일 목록'});
  assert.equal(files.getAttribute('aria-expanded'),'true');
  const reads=methods.filter(c=>c.method==='document_skill_manifest').length;
  fireEvent.click(files);assert.equal(files.getAttribute('aria-expanded'),'false');
  assert.equal(screen.queryByText('scripts/tables/calculate.py'),null);
  assert.equal(methods.filter(c=>c.method==='document_skill_manifest').length,reads,'collapsing never reads native data');
  fireEvent.click(screen.getByRole('button',{name:'선택'}));assert.deepEqual(selected,skill);
  cleanup();let folderCalls=0;render(React.createElement(OfficeSkills,{host:'excel',hostName:'Excel',onClose(){},onUse(){},call:async(method,payload)=>{
    if(method==='document_skill_import'){assert.equal(payload.kind,'folder');folderCalls++;return{cancelled:true};}return call(method,payload);
  }}));
  await screen.findByText('company-report');fireEvent.click(screen.getByRole('button',{name:'폴더 등록'}));
  await waitFor(()=>assert.equal(screen.getByRole('button',{name:'폴더 등록'}).disabled,false));assert.equal(folderCalls,1);assert.equal(stored.length,1);
  const result=await axe.run(document.body,{rules:{'color-contrast':{enabled:false}}});assert.deepEqual(result.violations.map(v=>v.id),[]);
});

test('document inspection only describes observed pagination and preserves complete content',()=>{
  const text='사용자가 작성한 상세 내용 '.repeat(40);
  const props={host:'word',scope:{name:'보고서',items:[{id:'p-1',kind:'paragraph',style:'본문',text,editable:true}]},onClose(){},onRefresh(){},onRequest(){}};
  const view=render(React.createElement(ContentDetails,props));
  assert.equal(screen.queryByText(/나머지는 작업 중/),null);
  assert.ok(document.body.textContent.includes(text));
  view.rerender(React.createElement(ContentDetails,{...props,scope:{...props.scope,nextOffset:1}}));
  assert.ok(screen.getByText('현재 1개 항목을 읽었습니다. 나머지는 작업 중 나누어 읽습니다.'));
});

test('skill editing explains empty fields and rejects oversized paste without losing the draft',async()=>{
  const skill={id:catalogId,host:'word',revision:1,name:'규칙',instructions:'보존할 규칙',questions:[]};let saves=0;
  const call=async(method,payload)=>{if(method==='document_skill_list')return{host:'word',entries:[skill],unreadable:0};saves++;return payload.skill;};
  render(React.createElement(OfficeSkills,{host:'word',hostName:'Word',call,onClose(){},onUse(){}}));
  fireEvent.click(await screen.findByRole('button',{name:'규칙 수정'}));
  const name=screen.getByLabelText('스킬 이름 (필수)'),rules=screen.getByLabelText('문서 형식과 작성 규칙 (필수)');
  rules.setSelectionRange(0,rules.value.length);
  assert.equal(fireEvent.paste(rules,{clipboardData:{getData:()=> '가'.repeat(8001)}}),false);
  assert.equal(rules.value,'보존할 규칙');assert.match(document.getElementById(rules.getAttribute('aria-describedby')).textContent,/8,000.*붙여넣지/);
  fireEvent.change(name,{target:{value:'   '}});fireEvent.change(rules,{target:{value:''}});
  fireEvent.click(screen.getByRole('button',{name:'규칙 저장'}));
  assert.equal(saves,0);assert.equal(document.activeElement,name);
  assert.equal(name.getAttribute('aria-invalid'),'true');assert.equal(rules.getAttribute('aria-invalid'),'true');
  fireEvent.change(name,{target:{value:'수정한 이름'}});assert.notEqual(name.getAttribute('aria-invalid'),'true');
});

test('template rename points to missing text and retains the exact name after paste rejection',async()=>{
  const entry=catalogEntry('word'),writes=[];
  const call=async(method,payload)=>{if(method==='template_catalog_list')return{host:'word',entries:[entry],unreadable:0};writes.push(payload);return entry;};
  render(React.createElement(OfficeTemplates,{host:'word',hostName:'Word',call,onClose(){},onUse(){},onRegister(){}}));
  fireEvent.click(await screen.findByRole('button',{name:'분기 보고 양식 이름 변경'}));
  const name=screen.getByLabelText('양식 이름 (필수)');name.setSelectionRange(0,name.value.length);
  assert.equal(fireEvent.paste(name,{clipboardData:{getData:()=> '가'.repeat(101)}}),false);assert.equal(name.value,entry.name);
  fireEvent.change(name,{target:{value:' '}});fireEvent.click(screen.getByRole('button',{name:'이름 저장'}));
  assert.equal(name.getAttribute('aria-invalid'),'true');assert.equal(document.activeElement,name);assert.deepEqual(writes,[]);
  fireEvent.click(screen.getByRole('button',{name:'이름 변경 취소'}));fireEvent.click(screen.getByRole('button',{name:'분기 보고 양식 이름 변경'}));
  assert.notEqual(screen.getByLabelText('양식 이름 (필수)').getAttribute('aria-invalid'),'true');
});

test('connection form links validation to fields, focuses correction and preserves values on provider failure',async()=>{
  const {ConnectionDialog}=await import('../src/OfficeDialogs.jsx');const sent=[];let connected=0;
  render(React.createElement(ConnectionDialog,{provider:'fabrix',onClose(){},onConnected(){connected++;},call:async(method,payload)=>{sent.push(payload);if(sent.length===1)throw new Error('network_error');return{connected:true};}}));
  const address=screen.getByLabelText('서버 주소'),key=screen.getByLabelText('클라이언트 키'),token=screen.getByLabelText('API 토큰');
  fireEvent.change(address,{target:{value:'not-a-url'}});fireEvent.change(key,{target:{value:'test-key'}});fireEvent.change(token,{target:{value:'test-token'}});
  fireEvent.click(screen.getByRole('button',{name:'연결'}));
  assert.equal(sent.length,0);assert.equal(address.getAttribute('aria-invalid'),'true');assert.equal(document.activeElement,address);
  assert.match(document.getElementById(address.getAttribute('aria-describedby')).textContent,/전체 서버 주소/);
  fireEvent.change(address,{target:{value:'https://example.test'}});fireEvent.click(screen.getByRole('button',{name:'연결'}));
  await waitFor(()=>assert.equal(screen.getByRole('button',{name:'연결'}).disabled,false));
  assert.equal(sent.length,1);assert.equal(token.value,'test-token');assert.equal(key.value,'test-key');assert.equal(connected,0);
  fireEvent.click(screen.getByRole('button',{name:'연결'}));await waitFor(()=>assert.equal(connected,1));assert.equal(sent.length,2);
});
