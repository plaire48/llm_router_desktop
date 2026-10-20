// Evaluation-only Office DTO boundary, not Office/COM and not a calculation engine.
import assert from 'node:assert/strict';
export function createNativeModelFixture(app,variant=1,{failure}={}){
 const state={body:'회의일은 10월 20일입니다.\r다른 문단과 승인 기록은 그대로 둡니다.\r',cells:{A1:2,B1:3,C1:{formula:'=SUM(A1:B1)'},A3:'보존 메모'},slides:[{shapes:[{text:'변경하지 않는 제목'},{text:'검토 초안'}],notes:'발표자 기록 보존'}]},before=structuredClone(state),handles=new Map([['document',{kind:'document'}]]),calls=[];let sequence=0,writes=0,calculations=0;
 const ref=(s,obj)=>{if(!s.id)throw Error('fixture_object_handle_required');handles.set(s.id,obj);return{reference:s.id};};
 const parts=s=>{let object=handles.get(s.target??'document');if(!object)throw Error('office_target_unknown');return object;};
 function value(address){const c=state.cells[address];if(c&&typeof c==='object'){
  if(c.formula==='=SUM(A1:B1)')return Number(state.cells.A1)+Number(state.cells.B1);
  if(/^=A1\*B1$/i.test(c.formula))return Number(state.cells.A1)*Number(state.cells.B1);
  throw Error('fixture_formula_unsupported');
 }return c??'';}
 function resolvePath(s){let target=(s.target??'document').split('.')[0],args=[...s.args??[]];const path=[...(s.target??'document').split('.').slice(1),...s.member.split('.').slice(0,-1)];for(const member of path){const id='fixture_path_'+handles.size,selector=member==='Item'?1:member==='Range'?app==='word'&&handles.get(target)?.kind==='document'?2:1:0;getLeaf({target,member,action:'get',id,args:args.splice(0,selector)});target=id;}return{...s,target,member:s.member.split('.').at(-1),args};}
 function get(s){return getLeaf(resolvePath(s));}
 function getLeaf(s){const o=parts(s),m=s.member,args=s.args??[];
  if(o.kind==='document'){
   if(m==='Name')return 'Synthetic test';if(m==='ReadOnly')return false;
   if(app==='word'&&m==='Content')return ref(s,{kind:'range',start:0,end:state.body.length});
   if(app==='word'&&m==='Range'){assert.ok(Number.isInteger(args[0])&&Number.isInteger(args[1])&&args[0]>=0&&args[1]<=state.body.length&&args[0]<=args[1]);return ref(s,{kind:'range',start:args[0],end:args[1]});}
   if(app==='excel'&&['Worksheets.Item','Sheets.Item'].includes(m)){assert.equal(args[0],1);return ref(s,{kind:'sheet'});}
   if(app==='excel'&&['Worksheets','Sheets'].includes(m))return ref(s,{kind:'sheets'});
   if(app==='powerpoint'&&m==='Slides')return ref(s,{kind:'slides'});
  }
  if(o.kind==='range'){if(m==='Text')return state.body.slice(o.start,o.end);if(m==='Start')return o.start;if(m==='End')return o.end;}
  if(o.kind==='sheets'){if(m==='Count')return 1;if(m==='Item'){assert.equal(args[0],1);return ref(s,{kind:'sheet'});}}
  if(o.kind==='sheet'){if(m==='Name')return '입력';if(m==='Range'){assert.match(args[0],/^[A-C][1-3]$/);return ref(s,{kind:'cell',address:args[0]});}}
  if(o.kind==='cell'){if(m==='Value2')return value(o.address);if(m==='Formula')return state.cells[o.address]?.formula??state.cells[o.address]??'';if(m==='CountLarge'||m==='Count')return 1;}
  if(o.kind==='slides'){if(m==='Count')return state.slides.length;if(m==='Item'){assert.equal(args[0],1);return ref(s,{kind:'slide',index:0});}}
  if(o.kind==='slide'&&m==='Shapes')return ref(s,{kind:'shapes',slide:o.index});
  if(o.kind==='slide'&&m==='NotesPage')return ref(s,{kind:'notes-page',slide:o.index});
  if(o.kind==='notes-page'&&m==='Shapes')return ref(s,{kind:'notes-shapes',slide:o.slide});
  if(o.kind==='notes-shapes'){
   if(m==='Count')return 2;if(m==='Placeholders')return ref(s,o);if(m==='Item'){assert.ok([1,2].includes(args[0]));return ref(s,{kind:'notes-shape',slide:o.slide,index:args[0]-1});}
  }
  if(o.kind==='notes-shape'){if(m==='HasTextFrame')return o.index===1?-1:0;if(m==='TextFrame')return ref(s,{...o,kind:'notes-frame'});}
  if(o.kind==='notes-frame'){if(m==='HasText')return o.index===1?-1:0;if(m==='TextRange')return ref(s,{...o,kind:'notes-text'});}
  if(o.kind==='notes-text'&&m==='Text')return o.index===1?state.slides[o.slide].notes:'';
  if(o.kind==='shapes'){if(m==='Count')return state.slides[o.slide].shapes.length;if(m==='Item'){assert.ok([1,2].includes(args[0]));return ref(s,{kind:'shape',slide:o.slide,index:args[0]-1});}}
  if(o.kind==='shape'&&m==='TextFrame')return ref(s,{...o,kind:'frame'});
  if(o.kind==='frame'&&m==='TextRange')return ref(s,{...o,kind:'text'});
  if(o.kind==='text'&&m==='Text')return state.slides[o.slide].shapes[o.index].text;
  throw Error('fixture_unsupported_member');
 }
 function set(raw){const s=resolvePath(raw),o=parts(s);if(o.kind==='range'&&s.member==='Text'){assert.equal(typeof s.value,'string');state.body=state.body.slice(0,o.start)+s.value+state.body.slice(o.end);o.end=o.start+s.value.length;return;}
  if(o.kind==='cell'&&s.member==='Value2'){assert.equal(typeof s.value,'number');state.cells[o.address]=s.value;return;}
  if(o.kind==='cell'&&s.member==='Formula'){assert.equal(typeof s.value,'string');state.cells[o.address]={formula:s.value};return;}
  if(o.kind==='text'&&s.member==='Text'){assert.equal(typeof s.value,'string');state.slides[o.slide].shapes[o.index].text=s.value;return;}
  throw Error('fixture_unsupported_member');
 }
 const request=app==='word'?`현재 열린 문서에서 회의일 '10월 20일'만 '10월 ${22+variant}일'로 바꾸세요. 다른 본문과 문단 기호는 그대로 두세요. 실제 getter로 원문을 읽고 변경 전 속성과 변경 후 기대값을 확인하세요. 저장하지 마세요.`:app==='excel'?`현재 통합문서 첫 시트에서 A1을 ${7+variant}로 바꾸고 C1의 수식을 =A1*B1 로 바꾸세요. B1과 A3 및 다른 셀은 보존하세요. 현재 값을 읽고, 같은 시트를 실제 계산한 다음 C1의 수식과 숫자 결과를 따로 검증하세요. 저장하지 마세요.`:`현재 프레젠테이션 첫 슬라이드의 두 번째 도형 텍스트 '검토 초안'을 '검토 확정 ${variant}'로 바꾸세요. 첫 번째 도형과 노트, 슬라이드/도형 수는 보존하세요. 먼저 실제 객체와 텍스트를 읽고 검증하세요. 저장하지 마세요.`;
 const guide={word:'Word: document.Content or document.Range(start,end) getter returns a Range. Read Range.Text before setting the same Text property. Use UTF-16 positions and preserve paragraph terminators.',excel:'Excel: document.Worksheets.Item getter with args:[1] returns the first worksheet; worksheet.Range getter with args:["A1"] returns that single cell. Read Value2 and/or Formula before setting the same property. Read each required cell separately. Calculate the actual observed worksheet handle. Native checks run before calculation; put calculated Value2 expectations into afterChecks. Use English Formula with leading equals.',powerpoint:'PowerPoint: document.Slides getter returns slides; slides.Item getter args:[1] returns the first slide; slide.Shapes getter returns shapes; shapes.Item getter args:[2] returns the second shape; shape.TextFrame then frame.TextRange return a text range. Read Text before setting Text. Item indices are one-based.'}[app];
 const connection={environment:'fixture',app,scope:{projectId:'native-model-evaluation',taskId:app+'-'+variant},documentId:app+'-fixture-document',officeSessionId:'fixture-session-'+variant,async call(name,input,signal){if(signal.aborted)throw Error('cancelled');calls.push({name,input:structuredClone(input)});
  if(name==='inspect_office')return {snapshotId:'fixture-snapshot-'+(++sequence),results:input.steps.map(get)};
  if(name==='calculate_office'){assert.equal(handles.get(input.target)?.kind,'sheet');calculations++;return{status:failure==='calculation_pending'?'verification_pending':'calculated',calculationDone:failure!=='calculation_pending'};}
  assert.equal(name,'execute_office_operations');if(failure==='rejected')return{status:'rejected',mutated:false,completedWrites:0,writeResultUncertain:false,saved:false};let completed=0;
  try{for(const step of input.steps){if(step.action==='get')get(step);else if(step.action==='set'){set(step);completed++;writes++;}else throw Error('fixture_unsupported_member');}
   if(failure==='disconnect')throw Error('fixture_disconnect');const checks=input.checks.map(check=>({passed:JSON.stringify(get(check.read))===JSON.stringify(check.equals)}));return{status:checks.every(c=>c.passed)?'verified':'partial',mutated:completed>0,completedWrites:completed,writeResultUncertain:false,saved:false,checks};
  }catch(error){if(error.message==='fixture_disconnect')throw error;return{status:completed?'partial':'conflict',error:'fixture_unsupported_member',mutated:completed>0,completedWrites:completed,writeResultUncertain:false,saved:false};}
 }};
 function verify(){const expected=structuredClone(before);if(app==='word')expected.body=expected.body.replace('10월 20일','10월 '+(22+variant)+'일');else if(app==='excel'){expected.cells.A1=7+variant;expected.cells.C1={formula:'=A1*B1'};}else expected.slides[0].shapes[1].text='검토 확정 '+variant;assert.deepEqual(state,expected);if(app==='excel'){assert.equal(value('C1'),(7+variant)*3);assert.equal(calculations,1);}return{stateMatches:true,nonTargetStatePreserved:true,writeBatches:calls.filter(c=>c.name==='execute_office_operations').length,writtenProperties:writes,calculationCalls:calculations};}
 return {connection,request,context:{nativeMemberGuide:guide,fixtureLimits:'This evaluation-only boundary supports the described getters and scalar setters. No Office, COM or actual Office calculation is running.'},calls,verify,state};
}
