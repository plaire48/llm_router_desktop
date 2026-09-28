// Synthetic business forms for template registration and reuse evaluation.
// Every form is invented for testing; none is a company document. `fields`
// and `reuse.values` are the grader's answer key and are never sent to the
// model. Layout patterns follow common Korean office forms: merged titles,
// merged labels beside inputs, section labels merged down rows, item tables.
import {normalizeTypedValue} from '../../worker/cell-format.mjs';

const label=(value,extra={})=>({value,bold:true,fillColor:'#F2F2F2',horizontalAlignment:'center',...extra});
const title=value=>({value,bold:true,fontSize:16,horizontalAlignment:'center'});
const money='#,##0',date='yyyy-mm-dd';
const field=(address,name,valueType,required=true)=>({address,label:name,valueType,required});
const day=text=>normalizeTypedValue(text,'date',false);

function form(definition){
  const {fields,reuse}=definition,values=reuse.values,typed=address=>fields.find(item=>item.address===address)?.valueType;
  for(const address of Object.keys(values))if(!typed(address))throw new Error('form_answer_without_field:'+definition.id+':'+address);
  const expected=Object.fromEntries(Object.entries(values).map(([address,value])=>[address,typed(address)==='date'?day(value):typed(address)==='percent'?normalizeTypedValue(value,'percent'):value]));
  return Object.freeze({...definition,mode:'template',workbookName:definition.workbookName||definition.title+'.xlsx',
    reuse:{...reuse,expected,
      checks:[...Object.entries(expected).map(([address,value])=>({address,field:'value',operator:'equals',expected:value})),...Object.entries(reuse.computed||{}).map(([address,value])=>({address,field:'value',operator:'equals',expected:value}))],
      allowedChanges:[...Object.keys(expected),...Object.keys(reuse.computed||{})].map(address=>address+':value')}});
}

export const forms=[
  form({id:'expense-report',title:'지출 결의서',purpose:'부서 경비 지출 승인 요청',sheetName:'지출결의서',range:'A1:E11',auditRange:'A1:G13',merges:['A1:E1','B5:C5','B11:E11'],
    cells:{A1:title('지출 결의서'),
      A3:label('결의 번호'),B3:{numberFormat:'@'},D3:label('작성일'),E3:{numberFormat:date},
      A4:label('부서'),D4:label('작성자'),
      A5:label('지급처'),D5:label('결제 수단'),E5:{validation:{type:3,formula1:'법인카드,계좌이체,현금',ignoreBlank:true,inCellDropdown:true,listSeparator:','}},
      A7:label('공급가액'),B7:{numberFormat:money},A8:label('부가세'),B8:{formula:'=ROUND(B7*0.1,0)',numberFormat:money},A9:label('합계'),B9:{formula:'=B7+B8',numberFormat:money},
      A11:label('적요'),G13:{value:'보존'}},
    fields:[field('B3','결의 번호','text'),field('E3','작성일','date'),field('B4','부서','text'),field('E4','작성자','text'),field('B5','지급처','text'),field('E5','결제 수단','text'),field('B7','공급가액','number'),field('B11','적요','text',false)],
    register:{request:'지금 선택한 지출 결의서 양식을 분석해서 다음에 다시 쓸 수 있게 등록해줘. 양식 이름은 지출 결의서, 용도는 부서 경비 지출 승인 요청이야. 적요만 선택 항목이고 나머지 입력 칸은 모두 필수야. 부가세와 합계는 자동 계산이야.',
      dialogue:[{match:'이름|양식명',answer:'지출 결의서'},{match:'용도|목적',answer:'부서 경비 지출 승인 요청'},{match:'필수|선택',answer:'적요만 선택이고 나머지는 필수'}]},
    reuse:{request:'지출 결의서를 작성해줘. 결의 번호는 0092, 작성일 2026-10-05, 부서 총무팀, 작성자 이서연, 지급처 한빛문구, 결제 수단은 법인카드, 공급가액 120000원, 적요는 사무용품 구입이야.',
      dialogue:[],values:{B3:'0092',E3:'2026-10-05',B4:'총무팀',E4:'이서연',B5:'한빛문구',E5:'법인카드',B7:120000,B11:'사무용품 구입'},computed:{B8:12000,B9:132000}}}),

  form({id:'trip-request',title:'출장 신청서',purpose:'임직원 국내외 출장 사전 신청',sheetName:'출장신청서',range:'A1:F12',auditRange:'A1:H14',
    merges:['A1:F1','A3:B3','E3:F3','A4:B4','E4:F4','A5:B5','E5:F5','A6:B6','E6:F6','A7:B7','A8:B8','C8:F8','A10:B10','E10:F10','A12:F12'],
    cells:{A1:title('출장 신청서'),
      A3:label('소속 부서'),D3:label('성명'),A4:label('사번'),C4:{numberFormat:'@'},D4:label('직급'),
      A5:label('출장 구분'),C5:{validation:{type:3,formula1:'국내,해외',ignoreBlank:true,inCellDropdown:true,listSeparator:','}},D5:label('출장지'),
      A6:label('출발일'),C6:{numberFormat:date},D6:label('복귀일'),E6:{numberFormat:date},
      A7:label('출장 일수'),C7:{formula:'=IF(OR(C6="",E6=""),"",E6-C6+1)'},
      A8:label('출장 목적'),C8:{wrapText:true},
      A10:label('일비(1일)'),C10:{numberFormat:money},D10:label('예상 경비'),E10:{formula:'=IF(OR(C7="",C10=""),"",C7*C10)',numberFormat:money},
      A12:{value:'※ 출장 3일 전까지 소속 부서장의 승인을 받아 제출합니다.'},H14:{value:'보존'}},
    fields:[field('C3','소속 부서','text'),field('E3','성명','text'),field('C4','사번','text'),field('E4','직급','text',false),field('C5','출장 구분','text'),field('E5','출장지','text'),field('C6','출발일','date'),field('E6','복귀일','date'),field('C8','출장 목적','text'),field('C10','일비(1일)','number')],
    register:{request:'지금 선택한 출장 신청서 양식을 분석해서 다음에 다시 쓸 수 있게 등록해줘. 양식 이름은 출장 신청서, 용도는 임직원 국내외 출장 사전 신청이야. 직급만 선택 항목이고 나머지 입력 칸은 모두 필수야. 출장 일수와 예상 경비는 자동 계산이야.',
      dialogue:[{match:'이름|양식명',answer:'출장 신청서'},{match:'용도|목적',answer:'임직원 국내외 출장 사전 신청'},{match:'필수|선택',answer:'직급만 선택이고 나머지는 필수'}]},
    reuse:{request:'출장 신청서를 작성해줘. 영업1팀 김민수 과장이고 사번은 00417이야. 국내 출장으로 부산에 2026-10-12부터 2026-10-14까지 다녀와. 목적은 신규 거래처 계약 협의야. 일비는 나한테 물어봐.',
      dialogue:[{match:'일비',answer:'50000'}],values:{C3:'영업1팀',E3:'김민수',C4:'00417',E4:'과장',C5:'국내',E5:'부산',C6:'2026-10-12',E6:'2026-10-14',C8:'신규 거래처 계약 협의',C10:50000},computed:{C7:3,E10:150000}}}),

  form({id:'training-request',title:'교육 신청서',purpose:'사외 교육 수강 신청',sheetName:'교육신청서',range:'A1:D10',auditRange:'A1:F12',
    merges:['A1:D1','A3:A5','C3:D3','C4:D4','C5:D5','A6:A10','C6:D6','C7:D7','C8:D8','C9:D9','C10:D10'],
    cells:{A1:title('교육 신청서'),
      A3:label('신청자',{verticalAlignment:'center'}),B3:label('성명'),C3:{value:'홍길동',fontColor:'#808080'},B4:label('부서'),C4:{value:'인사팀',fontColor:'#808080'},B5:label('연락처'),C5:{value:'010-0000-0000',numberFormat:'@',fontColor:'#808080'},
      A6:label('교육 과정',{verticalAlignment:'center'}),B6:label('과정명'),B7:label('시작일'),C7:{numberFormat:date},B8:label('교육비'),C8:{numberFormat:money},B9:label('회사 지원율'),C9:{numberFormat:'0%'},
      B10:label('본인 부담금'),C10:{formula:'=IF(OR(C8="",C9=""),"",C8*(1-C9))',numberFormat:money},F12:{value:'보존'}},
    fields:[field('C3','성명','text'),field('C4','부서','text'),field('C5','연락처','text'),field('C6','과정명','text'),field('C7','시작일','date'),field('C8','교육비','number'),field('C9','회사 지원율','percent')],
    register:{request:'지금 선택한 교육 신청서 양식을 분석해서 다음에 다시 쓸 수 있게 등록해줘. 양식 이름은 교육 신청서, 용도는 사외 교육 수강 신청이야. 회색 글자는 작성 예시라서 실제 값이 아니야. 입력 칸은 모두 필수이고 본인 부담금은 자동 계산이야.',
      dialogue:[{match:'이름|양식명',answer:'교육 신청서'},{match:'용도|목적',answer:'사외 교육 수강 신청'},{match:'필수|선택',answer:'모두 필수'},{match:'예시|회색',answer:'예시 값이므로 입력 칸으로 등록'}]},
    reuse:{request:'교육 신청서를 작성해줘. 신청자는 재무팀 박지훈, 연락처 010-2345-6789야. 과정명은 재무제표 분석 실무, 시작일 2026-11-02, 교육비 400000원, 회사 지원율은 80%야.',
      dialogue:[],values:{C3:'박지훈',C4:'재무팀',C5:'010-2345-6789',C6:'재무제표 분석 실무',C7:'2026-11-02',C8:400000,C9:'80%'},computed:{C10:80000}}}),

  form({id:'quotation',title:'견적서',purpose:'고객사 제출용 물품 견적',sheetName:'견적서',range:'A1:F14',auditRange:'A1:H16',
    merges:['A1:F1','B3:C3','E3:F3','B4:C4','E4:F4','A11:E11','A12:E12','A13:E13','B14:F14'],
    cells:{A1:title('견 적 서'),
      A3:label('수신'),D3:label('견적일'),E3:{numberFormat:date},A4:label('담당자'),D4:label('유효 기간'),
      A6:label('No'),B6:label('품목'),C6:label('규격'),D6:label('수량'),E6:label('단가'),F6:label('금액'),
      ...Object.fromEntries([7,8,9,10].flatMap(row=>[[`A${row}`,{value:row-6,horizontalAlignment:'center'}],[`E${row}`,{numberFormat:money}],[`F${row}`,{formula:`=IF(OR(D${row}="",E${row}=""),"",D${row}*E${row})`,numberFormat:money}]])),
      A11:label('공급가액'),F11:{formula:'=SUM(F7:F10)',numberFormat:money},A12:label('부가세'),F12:{formula:'=ROUND(F11*0.1,0)',numberFormat:money},A13:label('합계'),F13:{formula:'=F11+F12',numberFormat:money},
      A14:label('비고'),H16:{value:'보존'}},
    fields:[field('B3','수신','text'),field('E3','견적일','date'),field('B4','담당자','text'),field('E4','유효 기간','text'),
      ...[7,8,9,10].flatMap(row=>[field(`B${row}`,`품목 ${row-6}`,'text',row===7),field(`C${row}`,`규격 ${row-6}`,'text',false),field(`D${row}`,`수량 ${row-6}`,'number',row===7),field(`E${row}`,`단가 ${row-6}`,'number',row===7)]),
      field('B14','비고','text',false)],
    register:{request:'지금 선택한 견적서 양식을 분석해서 다음에 다시 쓸 수 있게 등록해줘. 양식 이름은 견적서, 용도는 고객사 제출용 물품 견적이야. 품목 표는 네 줄이고 첫 줄의 품목, 수량, 단가만 필수야. 규격과 비고, 둘째 줄부터의 품목은 선택이야. 수신, 견적일, 담당자, 유효 기간은 필수야. No와 금액, 공급가액, 부가세, 합계는 입력하지 않아.',
      dialogue:[{match:'이름|양식명',answer:'견적서'},{match:'용도|목적',answer:'고객사 제출용 물품 견적'},{match:'필수|선택',answer:'수신, 견적일, 담당자, 유효 기간과 첫 줄의 품목, 수량, 단가는 필수이고 나머지는 선택'}]},
    reuse:{request:'견적서를 작성해줘. 수신은 대한상사, 견적일 2026-10-20, 담당자 최유진, 유효 기간은 견적일로부터 30일이야. 품목은 두 개야. 첫째는 무선 키보드, 규격 K380, 수량 10개, 단가 30000원. 둘째는 무선 마우스, 규격 M350, 수량 10개, 단가 25000원. 비고는 없어.',
      dialogue:[],values:{B3:'대한상사',E3:'2026-10-20',B4:'최유진',E4:'견적일로부터 30일',B7:'무선 키보드',C7:'K380',D7:10,E7:30000,B8:'무선 마우스',C8:'M350',D8:10,E8:25000},computed:{F7:300000,F8:250000,F11:550000,F12:55000,F13:605000}}})
];
// Registered beside the four forms so that a request for "출장" has two candidates.
export const catalogForms=[...forms,form({id:'trip-settlement',title:'출장 정산서',purpose:'출장 후 경비 정산',sheetName:'출장정산서',range:'A1:D7',auditRange:'A1:F9',merges:['A1:D1'],
  cells:{A1:title('출장 정산서'),A3:label('성명'),C3:label('출장지'),A4:label('교통비'),B4:{numberFormat:money},C4:label('숙박비'),D4:{numberFormat:money},A6:label('정산 합계'),B6:{formula:'=B4+D4',numberFormat:money},F9:{value:'보존'}},
  fields:[field('B3','성명','text'),field('D3','출장지','text'),field('B4','교통비','number'),field('D4','숙박비','number')],
  register:{request:'지금 선택한 출장 정산서 양식을 등록해줘.',dialogue:[]},
  reuse:{request:'출장 정산서를 작성해줘. 김민수, 부산, 교통비 120000원, 숙박비 180000원이야.',dialogue:[],values:{B3:'김민수',D3:'부산',B4:120000,D4:180000},computed:{B6:300000}}})];
export const formById=id=>catalogForms.find(item=>item.id===id);
