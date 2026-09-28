import React from 'react';
import {Icon} from '@e2e/cx-design-system';
import {DeckDisclosure,DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';

const labels={preserved:'일치',changed:'차이 있음',unverified:'미확인'};
export function TemplatePreservation({report}) {
  if(!report)return null;
  const unverified=report.checks.some(item=>item.status==='unverified');
  return <section className="reply-note office-preservation" aria-label="양식 보존 확인">
    <div className="office-preservation-heading"><strong>양식 확인</strong><DeckStatus tone={report.differenceCount?'warning':'neutral'} icon={report.differenceCount?'alertCircle':unverified?'infoCircle':'check'}>{report.differenceCount?`차이 ${report.differenceCount}건`:unverified?'미확인 항목 있음':'비교 항목 일치'}</DeckStatus></div>
    <p><strong>별도 확인이 필요합니다.</strong><br/>그림, 차트, 인쇄 모양, NASCA 암호화</p>
    <DeckDisclosure title="비교 상세" icon="table">{report.target&&<p><strong>{report.target}</strong></p>}{report.note&&<p>{report.note}</p>}<ul className="office-check-list">{report.checks.map(item=><li key={item.id} data-state={item.status==='preserved'?'met':item.status}><Icon name={item.status==='preserved'?'check':item.status==='changed'?'alertCircle':'infoCircle'} size={16} aria-hidden="true"/><div><strong>{item.label}</strong><span>{labels[item.status]}</span>{item.note&&<p>{item.note}</p>}</div></li>)}</ul>
      {report.expectedValueChanges>0 && <p>입력값과 계산 결과 변경 <strong>{report.expectedValueChanges}건</strong>은 양식 차이와 구분했습니다.</p>}
      {!!report.differences.length && <ul className="office-check-list">{report.differences.map((item,i)=><li key={i}><div><strong>{item.address} / {item.field}</strong><p>이전: {item.before}</p><p>이후: {item.after}</p></div></li>)}</ul>}
      {report.differenceCount>report.differences.length && <p>차이 {report.differenceCount}건 중 {report.differences.length}건 표시</p>}
    </DeckDisclosure>
  </section>;
}
