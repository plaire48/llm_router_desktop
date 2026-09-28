import React from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';

export function recoveryActions(code, run) {
  const actions=[];
  if (/^(network_|tls_|auth_|login_|aipro_|model_)/.test(code || '') || ['request_failed','not_connected','response_json_invalid'].includes(code)) actions.push('connection');
  if (['cells_changed','source_changed','scope_expired','template_changed','observation_invalid','template_copy_scope_changed'].includes(code)) actions.push('selection');
  if (run?.kind !== 'document' && (run?.writes > 0 || ['write_uncertain','partial_change','recovery_uncertain','verification_required','office_timeout'].includes(code))) actions.push('history');
  return actions;
}

export function TaskRecovery({code, run, onAction}) {
  const actions=recoveryActions(code,run);
  if (!actions.length) return null;
  const labels={connection:'연결과 모델 확인',selection:'현재 선택 범위 읽기',history:'변경 기록 확인'};
  return <div className="office-recovery-actions" role="group" aria-label="문제 해결">
    {actions.map(action=><CxButton key={action} onClick={()=>onAction(action)}><Icon name={action==='connection'?'link':action==='selection'?'table':'list'} size={16}/>{labels[action]}</CxButton>)}
  </div>;
}
