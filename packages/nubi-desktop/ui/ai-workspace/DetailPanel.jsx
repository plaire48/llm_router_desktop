import React, {useState} from 'react';
import {DetailPanel as CxDetailPanel} from '@e2e/cx-design-system';
import HelpPanel from './HelpPanel';
import {Icon} from './Icon';

// Workspace and Desktop dialogs must share CX's one focus/Escape/inert stack.
// A separate lifecycle made a newly opened dialog inert behind an older one.
export function DetailPanel({hideHelp = false, helpTopic, titleIcon, title, className='', variant='drawer', ...props}) {
  const [helpOpen, setHelpOpen] = useState(false);
  return <>
    <CxDetailPanel {...props} variant={variant} className={`nubi-workspace-panel ${!props.embedded&&variant!=='drawer'?'deck-dialog':''} ${className}`} title={titleIcon?<span className="nubi-panel-title"><span className="nubi-panel-title-icon" aria-hidden="true"><Icon name={titleIcon}/></span>{title}</span>:title} hideHelp={hideHelp} onHelp={()=>setHelpOpen(true)}/>
    {helpOpen && <HelpPanel initialTopic={helpTopic} onClose={()=>setHelpOpen(false)}/>}
  </>;
}
