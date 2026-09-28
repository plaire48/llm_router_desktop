import React from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {taskView} from './task-view.js';

export function TaskDock({run, input, approval, stopping, onLocate, interactionVisible=true}) {
  const view = taskView(run, {input, approval, stopping});
  const actionLabel=view.state==='awaiting_input'||view.state==='awaiting_user'?'질문 보기':view.state==='awaiting_recovery'?'복구 확인':'변경 확인';
  return <aside className="office-task-dock" aria-label="현재 작업" data-state={view.state} title={view.hint}>
    <span aria-hidden="true">{view.working ? <span className="status-spinner"/> : <Icon name={view.icon} size={16}/>}</span>
    <span className="office-dock-status" role="status" aria-live="polite" aria-atomic="true">{view.label}{view.total > 0 && <span className="office-dock-count">{view.completed}/{view.total}<span className="visually-hidden">단계 완료</span></span>}</span>
    {view.action && !interactionVisible && <CxButton className="office-dock-action" onClick={onLocate}>{actionLabel}</CxButton>}
  </aside>;
}
