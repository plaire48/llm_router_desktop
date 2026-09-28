import {FIELD_LABELS} from '../worker/cell-format.mjs';
import React, {useState} from 'react';
import {ActionButton, CxButton, CxField, CxInput, CxNotice, DetailPanel, Icon} from '@e2e/cx-design-system';
import {DeckDisclosure, DeckEmpty, DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {HelpContent} from '../../../extensions/aipro-chat/src/HelpContent.jsx';
import {errorText} from './errors.js';
import {rpc} from './bridge.js';
import {useFormFeedback} from './form-feedback.js';

export const PROVIDER_NAMES={aipro:'AI Pro',chatgpt:'ChatGPT',fabrix:'FabriX'};
const fields=FIELD_LABELS;
const displayValue=value=>value==null ? '비어 있음' : typeof value==='boolean' ? value ? '켜짐' : '꺼짐' : String(value);

export function ConnectionDialog({provider,onClose,onConnected,call=rpc}) {
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const [values,setValues]=useState({endpoint:'',token:'',clientKey:'',model:''});
  const fabrix=provider==='fabrix',feedback=useFormFeedback();
  const fieldIds={endpoint:'endpoint',token:'token',clientKey:'client-key',model:'model-id'};
  const field=(key,label,type='text',placeholder)=> <CxField label={label} id={fieldIds[key]} error={feedback.errors[fieldIds[key]]}>
    <CxInput type={type} value={values[key]} required disabled={saving} autoComplete="off" placeholder={placeholder} spellCheck={false} {...feedback.input(e=>setValues({...values,[key]:e.target.value}))}/>
  </CxField>;
  return <DetailPanel title={`${PROVIDER_NAMES[provider]} 연결`} variant="modal" className="deck-dialog office-connection-dialog" busy={saving} hideHelp onClose={onClose}>
    <form noValidate id="credentials" className="fabrix-fields" autoComplete="off" onSubmit={async e=>{
      e.preventDefault();if(saving||!feedback.validate(e.currentTarget))return;setSaving(true);setError('');
      try {onConnected(await call('connect',{provider,...values,baseUrl:values.endpoint}));}
      catch(cause) {setError(errorText(cause.message));}
      finally {setSaving(false);}
    }}>
      {error && <CxNotice tone="danger">{error}</CxNotice>}
      <p className="context-note">관리자에게 받은 연결 정보를 입력하세요. 모든 항목이 필요합니다.</p>
      {field('endpoint','서버 주소','url',fabrix ? 'https://서버주소' : 'https://서버주소/v1')}
      {fabrix && field('clientKey','클라이언트 키','password')}
      {field('token','API 토큰','password')}
      {!fabrix && field('model','모델 ID','text','사용할 모델의 정확한 ID')}
      <DeckDisclosure title="연결 정보 보관" icon="link"><p>인증값은 현재 Office 연결에서만 유지됩니다.</p></DeckDisclosure>
      <div className="office-dialog-actions"><ActionButton action="cancel" label="취소" disabled={saving} onClick={onClose}/><CxButton variant="primary" type="submit" busy={saving}>연결</CxButton></div>
    </form>
  </DetailPanel>;
}

export function ChangeHistory({items,loading,error,busy,onRetry,onRestore,onClose}) {
  return <DetailPanel title="변경 기록" className="deck-dialog office-change-dialog" variant="modal" busy={busy} hideHelp onClose={onClose}>
    {error && <CxNotice tone="danger">{error}</CxNotice>}
    {loading ? <DeckEmpty loading title="변경 기록을 읽고 있습니다"/> : <div id="history-list">
      {!items.length ? <DeckEmpty icon="clockRewind" title={error ? '기록을 불러오지 못했습니다' : '변경 기록이 없습니다'} >{error && <ActionButton action="refresh" label="변경 기록 다시 읽기" onClick={onRetry}/>}</DeckEmpty> : <>
        <div className="office-history-summary"><span>최근 {items.length}개 작업</span>{items.some(item=>item.restored) && <DeckStatus icon="check">복원됨 {items.filter(item=>item.restored).length}개</DeckStatus>}</div>
        {items.map(item=><article key={item.id} className="office-change-card">
          <header><span className="deck-symbol"><Icon name="table" size={20}/></span><div><strong>{item.worksheet}!{item.address}</strong><span>{item.workbook}</span></div><DeckStatus tone={item.restored ? 'success' : item.partial ? 'warning' : 'active'} icon={item.restored ? 'check' : item.partial ? 'alertCircle' : 'pencil'}>{item.restored ? '복원됨' : item.partial ? '부분 반영' : '반영됨'}</DeckStatus></header>
          <div className="office-change-grid" role="region" aria-label={`${item.worksheet}!${item.address} 변경 비교`} tabIndex={0}>
            <table><thead><tr>{['셀','이전','변경'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{item.preview?.map((change,index)=><tr key={index}><th scope="row"><span>{change.cell}</span><span className="office-change-field">{fields[change.field] || change.field}</span></th><td>{displayValue(change.before)}</td><td>{displayValue(change.after)}</td></tr>)}</tbody></table>
          </div>
          <footer>{item.recoverable===false && <p className="reply-note"><strong>자동 복원 불가</strong> 양식 구조가 바뀌었습니다. 실제 셀을 확인하세요.</p>}{item.previewTotal>item.preview?.length && <span className="reply-note">속성 변경 {item.previewTotal}건 중 {item.preview.length}건 표시</span>}<CxButton data-restore={item.id} data-restored={String(item.restored)} disabled={busy || item.restored || item.recoverable===false} onClick={()=>onRestore(item)}><Icon name={item.restored ? 'check' : 'undo'} size={16}/>{item.recoverable===false ? '직접 확인 필요' : item.restored ? '복원 완료' : item.partial ? '부분 변경 되돌리기' : '이 작업 되돌리기'}</CxButton></footer>
        </article>)}
        <DeckDisclosure title="보관과 복원 범위" icon="infoCircle"><p>이 창의 최근 20개 작업을 보관합니다. 작업 이후 셀 내용이 달라졌다면 덮어쓰지 않습니다. 창을 종료하면 기록이 사라집니다.</p></DeckDisclosure>
      </>}
    </div>}
  </DetailPanel>;
}

export function OfficeUsage({usage,latest,model,onClose}) {
  const sum=key=>usage.reduce((total,item)=>total+(Number(item[key])||0),0);
  return <DetailPanel title="사용량" className="deck-dialog context-dialog" variant="modal" hideHelp onClose={onClose}>
    {!usage.length ? <DeckEmpty icon="chartColumn" title="아직 보고된 사용량이 없습니다"/> : <>
      <div className="context-summary"><span className="context-source">이 창에서 보고된 토큰</span><div className="context-total"><strong>{(sum('prompt_tokens')+sum('completion_tokens')).toLocaleString()}</strong><span>토큰</span></div></div>
      <DeckDisclosure title="입력과 출력" icon="chartColumn"><dl className="context-details"><div><dt>입력</dt><dd>{sum('prompt_tokens').toLocaleString()}</dd></div><div><dt>출력</dt><dd>{sum('completion_tokens').toLocaleString()}</dd></div></dl></DeckDisclosure>
      {latest && <DeckDisclosure title="이 대화의 마지막 호출" icon="message"><dl className="context-details"><div><dt>모델</dt><dd>{model}</dd></div><div><dt>입력</dt><dd>{latest.prompt_tokens==null?'미제공':Number(latest.prompt_tokens).toLocaleString()}</dd></div><div><dt>출력</dt><dd>{latest.completion_tokens==null?'미제공':Number(latest.completion_tokens).toLocaleString()}</dd></div></dl></DeckDisclosure>}
      <p className="context-note">모델이 보고한 사용량입니다. 계정 잔여 한도는 포함하지 않습니다.</p>
    </>}
  </DetailPanel>;
}

const helpSections=[
  {id:'templates',icon:'table',title:'회사 양식 활용',paragraphs:['Excel에서 입력 영역을 선택한 뒤 입력창의 +에서 현재 양식 등록을 누르세요. 용도와 항목 연결을 확인하고, 승인한 사본에 분석 명세를 저장합니다.','같은 +에서 등록 양식을 검색하고 이름을 바꾸거나 목록에서 제거할 수 있습니다. 이 양식으로 작성을 누르면 새 사본을 만들고, 부족한 내용은 대화로 질문합니다. 목록에서 제거해도 실제 파일은 남습니다.','입력 전후에 양식 확인 카드를 보세요. 확인한 셀 속성과 차이, 그림, 차트, 인쇄 등 미확인 항목을 구분합니다. 차이가 없다고 전체 문서가 동일하다는 뜻은 아닙니다.','현재 .xlsx, 단일 연속 입력 영역 1,000셀, 입력 항목 30개까지 지원합니다. 목록은 현재 Windows 계정으로 보호해 보관합니다. 회사 공용 목록은 아니며 NASCA 암호화 성공 자체는 자동 검증하지 못합니다.']},
  {id:'document',icon:'table',title:'요구사항으로 문서 작성',lead:'무슨 문서가 필요한지 내용과 조건을 알려주세요.',paragraphs:['문서 작성은 셀 선택 없이 시작합니다. 누비가 필요한 시트와 항목을 구성하고 내용, 수식, 서식을 작성합니다. 부족한 업무 정보는 대화로 질문합니다.','계획과 단계별 진행을 채팅에서 확인하세요. 문서 전체를 검토하고 보완한 후 내 문서의 NubiOffice 폴더에 새 Excel 파일로 저장합니다. 저장된 결과 카드에서 다시 볼 수 있습니다.','기존 회사 양식은 누비에게 분석과 등록을 요청한 뒤 사본을 사용하세요. Word와 PowerPoint 작업은 해당 앱의 누비 작업창에서 요청합니다. Excel 차트, 피벗, 매크로 생성은 아직 지원하지 않습니다.'],examples:['출장 계획과 예산을 정리한 문서를 만들어줘. 일정은 10월 1~3일, 인원은 4명이고 교통비는 1인당 8만원이야. 부족한 정보는 물어봐.']},
  {id:'selection',icon:'table',title:'셀 선택과 작업 요청',lead:'항목명과 입력할 셀을 함께 선택하세요.',paragraphs:['요청을 보내면 Excel에서 현재 선택한 셀을 읽습니다. 한 번에 연속된 1,000셀까지 다룹니다. 변경할 대상은 반영 전에 확인합니다.','상단 더 보기의 선택한 셀 확인에서 값, 수식, 서식, 입력 제한을 볼 수 있습니다.'],examples:['B2에 거래처명을, B3에 수량 10을 넣어줘.','선택한 표에서 합계 수식과 오류를 확인해줘.']},
  {id:'mode',icon:'pencil',title:'분석과 셀 수정',controls:[{icon:'search',label:'분석만',description:'선택한 셀을 읽고 답변합니다.'},{icon:'pencil',label:'셀 수정',description:'값, 수식, 서식을 바꾸고 실제 결과를 다시 읽습니다.'}],paragraphs:['코드의 앞자리 0, 날짜, 퍼센트와 숫자를 구분합니다. 단위가 모호하면 질문합니다. 같은 범위 안의 기준 셀을 지정하면 지원하는 글꼴, 색, 정렬, 표시 형식을 맞출 수 있습니다.','기존 수식은 기본으로 보호합니다. 수식 자체를 바꾸려면 요청에 명시하세요. 필요한 값은 질문 아래 입력란에서 답할 수 있습니다.']},
  {id:'progress',icon:'layers',title:'계획과 진행 확인',paragraphs:['계획을 먼저 표시하고 각 단계의 도구 실행과 검토 결과를 보여줍니다. 실행 가능한 오류는 원인을 확인하고 수정합니다. 해결하지 못한 작업을 완료로 표시하지 않습니다.','이전 기록을 읽는 동안 자동 스크롤을 멈춥니다. 아래 화살표를 누르면 최신 진행으로 돌아갑니다. 중지 버튼은 다음 작업을 멈춥니다.']},
  {id:'restore',icon:'undo',title:'변경 내용 되돌리기',paragraphs:['상단 더 보기의 변경 기록에서 이전 값과 결과를 비교하고 복원하세요. 이후 직접 수정한 셀은 덮어쓰지 않습니다.','열려 있는 문서를 수정했다면 Excel에서 저장하세요. 새 문서는 전체 검토와 사용자 확인 후 저장합니다. 대화, 인증, 변경 기록은 이 창이 실행되는 동안만 유지됩니다.']},
  {id:'providers',icon:'link',title:'모델과 연결',paragraphs:['AI Pro, ChatGPT, FabriX를 연결하고 입력창의 모델 버튼에서 전환합니다. FabriX는 모델 선택 화면에서 연결 정보를 설정합니다.','모델 목록은 제공자가 반환한 값을 사용합니다. 모든 모델의 Excel 작업 정확도가 검증된 것은 아닙니다.']}
];
export function OfficeHelp({onClose,host='excel'}) {
  const name=host==='word'?'Word':'PowerPoint';
  const contentSections=[
    {id:'templates',icon:'file',title:'양식 등록과 작성',paragraphs:[`${name}에서 문서와 입력할 부분을 선택한 뒤 입력창의 +에서 현재 양식 등록을 누르세요. 누비가 내용을 분석하고 필요한 업무 규칙을 질문합니다. 승인한 사본과 구조 스냅샷을 등록합니다.`,'같은 +에서 양식을 검색하고 이름을 바꾸거나 목록에서 제거할 수 있습니다. 이 양식으로 작성을 누르면 원본을 다시 확인하고, 대화 중 승인한 새 사본에 내용을 채웁니다. 이후 대화는 같은 사본을 이어서 수정합니다.','목록과 스냅샷은 현재 Windows 계정으로 보호해 보관합니다. 실제 양식 파일이 이동하거나 내용이 바뀌면 다시 등록해야 합니다. 회사 공용 목록이나 화면 전체의 완전한 동일성 검증은 지원하지 않습니다.']},
    {id:'document',icon:'file',title:'문서 작성과 수정',paragraphs:[`원하는 결과를 알려주면 ${name} 2016 안에서 계획을 세우고 도구 실행과 검토를 이어갑니다. 새 문서는 Office 저장 창에서 위치를 정해 저장합니다.`,host==='word'?'문단, 기본 제목 스타일과 표로 문서를 작성합니다. 기존 문단이나 일반 텍스트 양식 입력칸을 선택하면 부족한 값을 질문하고 확인 후 채웁니다. 잠금, XML 연결, 임시 입력칸과 복잡한 서식, 검토 기록은 자동 수정하지 않습니다.':'제목, 본문, 발표자 노트로 슬라이드를 작성하고 선택한 슬라이드를 복제할 수 있습니다. 선택한 도형의 단순 텍스트를 수정하며, 도형 위치와 텍스트 넘침을 확인합니다. 혼합 서식은 글자 구간별 글꼴과 강조를 읽되 자동 교체하지 않습니다.']},
    {id:'review',icon:'check',title:'반영 전 확인',paragraphs:['기존 문서 수정과 최종 저장은 변경 내용을 확인한 뒤 진행합니다. 응답이 끊기면 실행 결과부터 조회하며, 결과가 불명확한 변경은 반복하지 않습니다.','문서의 필드나 텍스트는 지시문으로 실행하지 않습니다. 회사 문서의 열기와 저장은 Office가 처리하며 별도 평문 사본이나 외부 변환기로 우회하지 않습니다. 화면, 인쇄 결과와 회사 암호화 성공은 별도 확인이 필요합니다.']},
    {id:'limits',icon:'infoCircle',title:'현재 지원 범위',paragraphs:['이미지, 차트, 매크로, 복잡한 양식 구조의 생성이나 전체 자동 변환은 아직 지원하지 않습니다. 대화와 인증은 현재 작업창에서만 유지됩니다. 앱을 닫은 뒤 자동 복구하는 기능은 별도 개발 항목입니다.','Excel, Word, PowerPoint는 같은 설치 파일에서 선택합니다. 앱마다 작업 도구가 다르며 사용자가 별도 실행 엔진을 설치할 필요는 없습니다.']},
    {...helpSections.at(-1),paragraphs:[helpSections.at(-1).paragraphs[0],'사용 가능한 모델은 제공자가 반환한 목록을 그대로 사용합니다. 실제 회사 모델의 문서 작성 정확도는 별도 평가 대상입니다.']}
  ];
  return <DetailPanel title="도움말" className="deck-dialog help-dialog" variant="modal" hideHelp onClose={onClose}><HelpContent sections={host==='excel'?helpSections:contentSections}/></DetailPanel>;
}
