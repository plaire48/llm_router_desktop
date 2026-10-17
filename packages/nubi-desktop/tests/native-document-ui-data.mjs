// Stateful UI evaluation host only, never imported by the product.
const rgb=hex=>{const n=parseInt(hex.replace('#',''),16);return ((n&255)<<16)|(n&0xff00)|((n>>16)&255);};
const signature=s=>JSON.stringify([s.target??'document',s.member,s.args??[]]);
export function nativeDocumentUIData(app){
 const steps=[],values=new Map();let writes=0;
 const add=(target,member,value,args=[],id)=>{const s={target,action:'get',member,...(args.length?{args}:{}),...(id?{id}:{})};steps.push(s);values.set(signature(s),id?{reference:id}:value);};
 let mutation,expected,title;
 if(app==='word'){
  title='문서 작성 환경 도입 검토';
  for(const [name,value]of Object.entries({PageWidth:595,PageHeight:842,TopMargin:50,BottomMargin:48,LeftMargin:52,RightMargin:52}))add('document','PageSetup.'+name,value);
  const paragraphs=[['도입 검토 보고서\r',24,true,'#203D64'],['전사 문서 작성 환경 개선안  |  2026.10.16\r',10,false,'#6B7684'],['01  검토 배경\r',14,true,'#203D64'],['Word, Excel, PowerPoint 작성 과정을 하나의 작업 흐름으로 연결합니다.\r자료 확인부터 변경 검토까지 이어가며 원본 문서의 내용을 보존합니다.\r',11,false,'#191F28'],['02  주요 결정\r',14,true,'#203D64'],['검토 초안: 시범 적용 후 확대 여부를 결정합니다.\r',12,false,'#191F28'],['03  검증 및 다음 단계\r',18,true,'#203D64'],['앱별 변경 내용을 확인하고 사용자가 승인한 범위만 반영합니다.\r아래 표는 이번 시범 적용에서 확인할 항목입니다.\r',11,false,'#191F28']];
  paragraphs.forEach(([text,size,bold,color],i)=>{const id='para'+(i+1);add('document','Paragraphs.Item.Range',null,[i+1],id);add(id,'Text',text);add(id,'Font.Size',size);add(id,'Font.Bold',bold?-1:0);add(id,'Font.Color',rgb(color));add(id,'ParagraphFormat.SpaceAfter',i===0?12:10);});
  add('para6','ParagraphFormat.LineSpacing',22);add('para6','ParagraphFormat.LineSpacingRule',4);add('para7','ParagraphFormat.PageBreakBefore',-1);
  add('document','Tables.Item',null,[1],'reviewTable');
  [['검증 항목','확인 내용','담당'],['Word','문단과 표의 서식 보존','문서 담당'],['Excel','수식과 계산 결과 확인','업무 담당'],['PowerPoint','슬라이드 내용과 배치 확인','발표 담당']].forEach((row,r)=>row.forEach((value,c)=>add('reviewTable','Cell.Range.Text',value+'\r\x07',[r+1,c+1])));
  mutation={target:'para6',action:'set',member:'Text',value:'검토 확정: 3개 부서 시범 적용을 진행합니다.\r'};expected='검토 확정: 3개 부서 시범 적용을 진행합니다.';
 }else{
  title='다음 분기 실행 계획';add('document','PageSetup.SlideWidth',960);add('document','PageSetup.SlideHeight',540);
  const shapes=[
   [1,1,'제목',60,56,840,65,'다음 분기 실행 계획',36,true,'#FFFFFF',null],
   [1,2,'부제',62,128,800,40,'문서 작성 업무를 하나의 검토 흐름으로',19,false,'#B9CDE4',null],
   [1,3,'핵심 메시지',62,220,380,140,'검토 초안\r3개 부서 시범 적용',28,true,'#FFFFFF','#213E5D'],
   [1,4,'실행 과제',500,220,390,160,'01  원천 자료와 요구사항 확인\r02  변경 내용과 계산 결과 검토\r03  사용자 승인 후 범위 내 반영',21,false,'#E4EDF7',null],
   [1,5,'하단 메모',62,470,830,32,'시범 적용 결과를 바탕으로 확대 범위를 결정합니다.',15,false,'#B9CDE4',null],
   [2,1,'확인할 결과',60,60,840,80,'확인할 결과',34,true,'#FFFFFF',null],
   [2,2,'세 가지 검증',64,200,800,230,'문서  |  본문과 표의 보존\r계산  |  수식과 숫자의 일치\r발표  |  내용과 개체 배치의 확인',28,false,'#E4EDF7',null]
  ];
  for(const i of [1,2]){add('document','Slides.Item',null,[i],'slide'+i);add('slide'+i,'Name',i===1?'실행 계획':'확인할 결과');}
  for(const [slide,index,name,left,top,width,height,text,size,bold,color,fill]of shapes){const id='shape'+slide+'_'+index;add('slide'+slide,'Shapes.Item',null,[index],id);for(const [member,value]of Object.entries({Name:name,ZOrderPosition:index+1,Left:left,Top:top,Width:width,Height:height,'TextFrame.TextRange.Text':text,'TextFrame.TextRange.Font.Size':size,'TextFrame.TextRange.Font.Bold':bold?-1:0,'TextFrame.TextRange.Font.Color.RGB':rgb(color)}))add(id,member,value);if(fill)add(id,'Fill.ForeColor.RGB',rgb(fill));}
  // An observed full-slide rectangle supplies the actual background color.
  for(const i of [1,2]){add('slide'+i,'Shapes.Item',null,[10],'bg'+i);for(const [member,value]of Object.entries({Left:0,Top:0,Width:960,Height:540,'Fill.ForeColor.RGB':rgb('#132C46'),'ZOrderPosition':1}))add('bg'+i,member,value);}
  add('slide1','NotesPage.Shapes.Item.TextFrame.TextRange.Text','시범 적용의 범위와 승인 기준을 설명합니다.',[2]);
  mutation={target:'shape1_3',action:'set',member:'TextFrame.TextRange.Text',value:'검토 확정\r3개 부서 시범 적용'};expected='검토 확정';
 }
 function read(s){const result=values.get(signature(s));if(result===undefined)throw Error('fixture_unobserved_property');return structuredClone(result);}
 return {steps,mutation,expected,title,get writes(){return writes;},async call(name,input){
  if(name==='inspect_office')return {snapshotId:'document-preview-fixture',results:input.steps.map(read)};
  if(name!=='execute_office_operations')throw Error('fixture_unexpected_tool');
  for(const s of input.steps){if(s.action!=='set'||!values.has(signature(s)))throw Error('fixture_unobserved_mutation');values.set(signature(s),structuredClone(s.value));}writes++;
  const checks=input.checks.map(c=>({passed:JSON.stringify(read(c.read))===JSON.stringify(c.equals)}));return {status:checks.every(c=>c.passed)?'verified':'partial',mutated:true,completedWrites:input.steps.length,writeResultUncertain:false,saved:false,checks};
 }};
}
