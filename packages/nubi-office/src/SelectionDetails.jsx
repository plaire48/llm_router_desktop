import React, {useState} from 'react';
import {CxButton,CxField,CxSelect,CxNotice,DetailPanel,ActionButton} from '@e2e/cx-design-system';
import {DeckDisclosure,DeckEmpty,DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {FIELD_LABELS,FORMAT_FIELDS} from '../worker/cell-format.mjs';
import {region} from '../worker/office-range.mjs';

const alignment={general:'일반',left:'왼쪽',center:'가운데',right:'오른쪽',top:'위쪽',bottom:'아래쪽',fill:'채우기',justify:'양쪽 맞춤',centerAcrossSelection:'선택 영역 가운데',distributed:'균등 분할'};
const valueText=value=>value===undefined?'미수집':value===null?'비어 있음':typeof value==='boolean'?value?'켜짐':'꺼짐':typeof value==='object'?JSON.stringify(value):String(value);
export function SelectionDetails({scope,loading,error,onRefresh,onRequest,onClose}) {
  return <DetailPanel title="셀 값과 서식" className="deck-dialog office-cell-dialog" variant="modal" hideHelp onClose={onClose}>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    <div className="office-cell-location"><span>{scope?`${scope.worksheet}!${scope.address}`:'Excel에서 선택한 셀'}</span><ActionButton action="refresh" label="선택한 셀 다시 읽기" busy={loading} onClick={onRefresh}/></div>
    {loading ? <DeckEmpty loading title="선택한 셀을 읽고 있습니다"/> : scope&&!error ? <CellProperties key={`${scope.scopeId}:${scope.worksheet}:${scope.address}`} scope={scope} onRequest={onRequest}/> : null}
  </DetailPanel>;
}

function CellProperties({scope,onRequest}) {
  const [index,setIndex]=useState(0),area=region(scope.address),count=area.rows*area.cols,selected=Math.min(index,count-1),row=Math.floor(selected/area.cols),col=selected%area.cols;
  const address=(r,c)=>{let n=area.c+c,letters='';while(n){n--;letters=String.fromCharCode(65+n%26)+letters;n=Math.floor(n/26);}return letters+(area.r+r);};
  const at=matrix=>matrix?.[row]?.[col],formula=at(scope.formulas),value=at(scope.values),validation=at(scope.properties?.validation);
  const fields=entries=><dl className="office-cell-details">{entries.map(([label,content])=><div key={label}><dt>{label}</dt><dd>{valueText(content)}</dd></div>)}</dl>;
  return <>
    <CxField id="cell-details-address" label="확인할 셀"><CxSelect value={selected} onChange={event=>setIndex(Number(event.target.value))}>{Array.from({length:count},(_,i)=><option key={i} value={i}>{address(Math.floor(i/area.cols),i%area.cols)}</option>)}</CxSelect></CxField>
    <div className="office-cell-role"><DeckStatus tone={formula?'active':'neutral'}>{formula?'수식 셀':value===null?'빈 셀':typeof value==='number'?'숫자 값':typeof value==='boolean'?'논리 값':'텍스트 값'}</DeckStatus>{at(scope.properties?.mergedAddress)&&<DeckStatus>병합 셀</DeckStatus>}</div>
    {fields([['표시된 내용',at(scope.displayTexts)],['저장된 값',value],...(formula?[['수식',formula]]:[]),['표시 형식',at(scope.formats?.numberFormat)]])}
    <DeckDisclosure title="글꼴과 정렬" icon="pencil">{fields(FORMAT_FIELDS.filter(field=>field!=='numberFormat').map(field=>{const v=at(scope.formats?.[field]);return [FIELD_LABELS[field],alignment[v]||v];}))}</DeckDisclosure>
    <DeckDisclosure title="양식 속성과 입력 제한" icon="table">{fields([['잠금 설정',at(scope.properties?.locked)],['병합 범위',at(scope.properties?.mergedAddress)],['행 높이',at(scope.properties?.rowHeight)],['열 너비',at(scope.properties?.columnWidth)],['날짜 체계',typeof scope.date1904==='boolean'?scope.date1904?'1904년 기준':'1900년 기준':undefined],['입력 제한',validation===null?'없음':validation===undefined?undefined:({0:'제한 없음',1:'정수',2:'소수',3:'목록',4:'날짜',5:'시간',6:'텍스트 길이',7:'사용자 지정'}[validation.type]||'확인 필요')],...(validation?[['조건',validation.formula1],...(validation.formula2?[['두 번째 조건',validation.formula2]]:[]),['현재 값 검증',at(scope.properties?.validationValid)===true?'충족':at(scope.properties?.validationValid)===false?'확인 필요':'확인되지 않음']]:[])])}<p className="context-note">잠금 설정은 시트 보호 상태와 함께 적용됩니다. 빈 셀의 업무 의미는 항목명과 양식 규칙을 함께 확인합니다.</p></DeckDisclosure>
    <div className="office-dialog-actions"><CxButton onClick={()=>onRequest(address(row,col))}>이 셀에 요청하기</CxButton></div>
  </>;
}
