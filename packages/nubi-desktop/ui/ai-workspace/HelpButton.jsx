import React, { useState } from 'react';
import { HelpTrigger } from './HelpTrigger';
import HelpPanel from './HelpPanel';

export function HelpButton({ initialTopic }) {
  const [open, setOpen] = useState(false);
  return <><HelpTrigger className="panel-help" onClick={()=>setOpen(true)}/>{open&&<HelpPanel initialTopic={initialTopic} onClose={()=>setOpen(false)}/>}</>;
}
