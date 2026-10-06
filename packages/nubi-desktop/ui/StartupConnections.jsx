import React from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
export function StartupConnections({onConnect,onClose}){
  return <DetailPanel className="deck-dialog nubi-panel nubi-startup-connections" variant="modal" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon"><Icon name="mail" size={20}/></span><span>메일을 연결해 주세요</span></span>} onClose={onClose}>
    <p>자동 정리를 사용하려면 메일 계정을 연결해 주세요.</p>
    <div className="nubi-startup-options">
      <CxButton onClick={()=>onConnect('mail')}><span className="nubi-mail-section-icon"><Icon name="mail" size={20}/></span><span><strong>메일 연결</strong><small>자동 정리를 켜두면 미수신 메일도 이어서 가져와요.</small></span><Icon name="chevronRight" size={16}/></CxButton>
    </div>
    <p className="nubi-muted">메일 비밀번호는 저장하지 않아요.</p>
  </DetailPanel>;
}
