import React from 'react';
import {ActionButton,CxButton,CxNotice,DetailPanel} from '@e2e/cx-design-system';
import {DeckEmpty} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {officeHost} from '../worker/office-hosts.mjs';

export function ContentDetails({host,scope,loading,error,onRefresh,onClose,onRequest}) {
  const profile=officeHost(host),targets=scope?.items?.filter(item=>item.editable)||[];
  return <DetailPanel title={profile.selection} className="deck-dialog" variant="modal" hideHelp onClose={onClose} footer={<ActionButton action="refresh" label="현재 문서 다시 읽기" busy={loading} onClick={onRefresh}/>}>
    {loading?<DeckEmpty loading title="현재 문서를 읽고 있습니다"/>:error?<CxNotice tone="danger">{error}</CxNotice>:<>
      {scope?.name && <p><strong>{scope.name}</strong></p>}
      {targets.length?<ul className="office-content-list">{targets.map(item=><li key={item.id}><div><strong>{item.title||item.tag||item.style||item.name||(item.kind==='field'?'양식 입력칸':`슬라이드 ${item.index}`)}</strong><p>{item.showingPlaceholder?'아직 입력하지 않은 항목':item.text||item.notes||item.id}</p><CxButton onClick={()=>onRequest(item.id)}>이 부분에 요청</CxButton></div></li>)}</ul>:<p className="reply-note">Office에서 수정할 문단 전체, 입력칸 또는 도형을 선택하세요. 복잡한 서식과 보호된 내용은 읽기만 가능합니다.</p>}
      {Number.isInteger(scope?.nextOffset) && <p className="reply-note">현재 {scope.items?.length||0}개 항목을 읽었습니다. 나머지는 작업 중 나누어 읽습니다.</p>}
    </>}
  </DetailPanel>;
}
