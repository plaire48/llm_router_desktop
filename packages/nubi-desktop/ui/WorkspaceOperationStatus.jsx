import React from 'react';
import {Icon} from '@e2e/cx-design-system';
export function WorkspaceOperationStatus({activity}){
 if(!activity)return null;
 return <span className="nubi-workspace-operation" data-workspace-operation data-state={activity.state} role="status" aria-live="polite" aria-atomic="true" title={(activity.labels||[activity.label]).join('\n')}>
  {activity.state==='waiting'?<Icon name="clock" size={14}/>:<span className="status-spinner" aria-hidden="true"/>}
  <span>{activity.label}</span>{activity.count>1&&<small>외 {activity.count-1}개</small>}
 </span>;
}
