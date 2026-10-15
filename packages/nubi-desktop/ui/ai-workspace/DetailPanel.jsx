import React, {useState} from 'react';
import {DetailPanel as CxDetailPanel} from '@e2e/cx-design-system';
import HelpPanel from './HelpPanel';

// Workspace and Desktop dialogs must share CX's one focus/Escape/inert stack.
// A separate lifecycle made a newly opened dialog inert behind an older one.
export function DetailPanel({hideHelp = false, helpTopic, ...props}) {
  const [helpOpen, setHelpOpen] = useState(false);
  return <>
    <CxDetailPanel {...props} hideHelp={hideHelp} onHelp={()=>setHelpOpen(true)}/>
    {helpOpen && <HelpPanel initialTopic={helpTopic} onClose={()=>setHelpOpen(false)}/>}
  </>;
}
