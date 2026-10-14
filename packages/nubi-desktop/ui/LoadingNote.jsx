import React from 'react';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './loading-note.css';
// Every "loading" moment shows the mascot at work with a spinner, never a bare sentence (user request 2026-10-14).
export function LoadingNote({children,size=22,className=''}){
 return <p role="status" aria-live="polite" className={`nubi-loading-note ${className}`.trim()}><AgentMark size={size} mood="working"/><span className="status-spinner" aria-hidden="true"/><span>{children}</span></p>;
}
