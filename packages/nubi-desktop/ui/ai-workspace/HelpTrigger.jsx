import React from 'react';
import { ActionButton } from './ActionButton';

export function HelpTrigger({ onClick, className = '' }) {
  return <ActionButton action="help" className={`cx-help-trigger ${className}`.trim()} aria-haspopup="dialog" onClick={event=>{event.currentTarget.focus({preventScroll:true});onClick?.(event);}}/>;
}
