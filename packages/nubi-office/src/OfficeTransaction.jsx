import React from 'react';
import {ActionButton,CxButton,Icon} from '@e2e/cx-design-system';
import {InlineMarkdown} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {InteractionSurface,ApprovalPreview} from '../../../extensions/aipro-chat/src/InteractionSurface.jsx';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {TemplatePreservation} from './TemplatePreservation.jsx';

export function OfficeTransaction({approval,onDecision,onOpen}) {
  const p=approval.payload,host=({word:'Word',powerpoint:'PowerPoint'})[p.host]||'Excel';
  return <InteractionSurface className="action-approval office-transaction" title={p.title} icon={p.kind==='recovery'?'alertCircle':'file'} headingClassName="approval-heading" aria-label={p.kind?.startsWith('python_')?'Python 실행 확인':p.kind==='recovery'?'작업 재시도 확인':`${host} 반영 확인`}>
    {p.summary&&<p className="office-decision-summary"><InlineMarkdown content={p.summary}/></p>}
    {p.target&&<p className="office-decision-target"><Icon name="file" size={16}/><span><span className="visually-hidden">대상: </span><strong>{p.target}</strong></span></p>}
    <TemplatePreservation report={p.preservation}/>
    <ApprovalPreview title={p.kind?.startsWith('python_')?'실행 내용 확인':p.kind==='recovery'?'복구 방법 확인':'반영 내용 확인'} label={p.kind?.startsWith('python_')?'로컬 Python 실행 내용':p.kind==='recovery'?'다시 확인할 내용':`${host}에 반영할 내용`}>
    <dl><div><dt>검토</dt><dd>{p.verification}</dd></div></dl>
    {p.code && <DeckDisclosure title="실행할 Python 코드" icon="file"><pre>{p.code}</pre><p className="reply-note">코드 SHA-256: {p.codeSha256}<br/>입력 SHA-256: {p.inputSha256}</p></DeckDisclosure>}
    {p.packages?.length>0 && <DeckDisclosure title="Python 패키지" icon="list"><ul>{p.packages.map(name=><li key={name}>{name}</li>)}</ul></DeckDisclosure>}
    {p.notes && <DeckDisclosure title="보관할 업무 메모" icon="file"><p>{p.notes}</p></DeckDisclosure>}
    {p.fields && <ul className="office-check-list">{p.fields.map(field=><li key={field.id}><div><strong>{field.label} → {field.address}</strong><p>{({text:'텍스트',number:'숫자',percent:'퍼센트',date:'날짜',boolean:'예/아니오'})[field.valueType]} / {field.required?'필수':'선택'}{field.numberFormat && ` / 표시 형식 ${field.numberFormat}`}</p>{field.merge && <p>병합 유지: {field.merge}</p>}<p>현재 값: {field.currentValue === '' || field.currentValue == null ? '비어 있음' : String(field.currentValue)}</p></div></li>)}</ul>}
    {p.operations && <DeckDisclosure title="변경 상세" icon="table"><ul className="office-check-list">{p.operations.map((op,i)=><li key={i}><div><strong>{op.address||op.targetId||p.target}</strong><pre>{JSON.stringify(Object.fromEntries(Object.entries(op).filter(([k])=>!['address','targetId','type'].includes(k))),null,2)}</pre></div></li>)}</ul></DeckDisclosure>}
    </ApprovalPreview>
    {p.documentId && <div className="office-draft-action"><ActionButton action="openExternal" label={`${host} 초안 보기`} iconOnly onClick={()=>onOpen(p.documentId)}/></div>}
    <div className="approval-actions"><CxButton onClick={()=>onDecision(false)}>{p.kind==='recovery'?'작업 중지':'취소'}</CxButton><CxButton variant="primary" onClick={()=>onDecision(true)}>{p.kind==='office_input'?'확인 후 조작':p.kind==='python_install'?'환경 준비 허용':p.kind==='python_execute'?'코드 실행 허용':p.kind==='recovery'?'다시 시도':p.kind==='save'?'확인 후 저장':p.kind==='template_mapping'?'연결 확인':p.kind==='template_copy'?'사본 만들기':p.kind==='template_register'?'사본으로 등록':p.kind==='template_preservation'?'차이 확인 후 계속':p.kind==='template_reanalyze'?'새 양식으로 분석':'확인 후 적용'}</CxButton></div>
  </InteractionSurface>;
}
