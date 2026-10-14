import React from 'react';
import './loading-note.css';
// Every "loading" moment: a ring spinner in front of the text, nothing else (user feedback 2026-10-14).
export function LoadingNote({children,size=22,className=''}){
 return <p role="status" aria-live="polite" className={`nubi-loading-note ${className}`.trim()}><span className="status-spinner" aria-hidden="true"/><span>{children}</span></p>;
}
