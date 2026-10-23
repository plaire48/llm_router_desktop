import React from 'react';
import {Icon} from './LucideIcon.jsx';
export function WorkspaceOperationStatus({activity}){
 if(!activity)return null;
 return <span className="nubi-workspace-operation" data-workspace-operation data-state={activity.state} role="status" aria-live="polite" aria-atomic="true" title={(activity.labels||[activity.label]).join('\n')}>
  {activity.icon&&<Icon name={activity.icon} size={14}/>}
  {activity.state==='waiting'&&<Icon name="clock" size={14}/>}
  <span>{activity.label}</span>{activity.state!=='waiting'&&<span className="status-spinner" aria-hidden="true"/>}{activity.count>1&&<small>외 {activity.count-1}개</small>}
 </span>;
}
