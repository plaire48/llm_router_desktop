import React from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';

export function OfficeTools({disabled,templateDisabled,onSelection,onTemplate,onHistory,onHelp,onClose,initialFocus,version,children,selectionLabel='선택한 셀 확인'}) {
  return <DetailPanel title="더 보기" className="deck-dialog settings-dialog" variant="modal" initialFocus={initialFocus} footer={<span className="settings-version">누비 Office / {version}</span>} onHelp={onHelp} onClose={onClose}>
    <div className="office-tool-list" role="group" aria-label="문서 도구">
      <CxButton className="office-tool-action" disabled={disabled} onClick={onSelection}><Icon name="table" size={20}/><span>{selectionLabel}</span></CxButton>
      {onTemplate && <CxButton className="office-tool-action" disabled={templateDisabled} onClick={onTemplate}><Icon name="file" size={20}/><span>등록 양식 사본 열기</span></CxButton>}
      {onHistory && <CxButton className="office-tool-action" onClick={onHistory}><Icon name="clockRewind" size={20}/><span>변경 기록</span></CxButton>}
    </div>
    {children}
  </DetailPanel>;
}
