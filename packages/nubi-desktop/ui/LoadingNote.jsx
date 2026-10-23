import React from 'react';
import './loading-note.css';
// The shared branded hourglass precedes readable status text. Loading remains
// owned by the real operation; no decorative delay or fabricated percentage.
export function LoadingNote({children,size=22,className=''}){
 return <p role="status" aria-live="polite" className={`nubi-loading-note ${className}`.trim()}><span className="status-spinner" aria-hidden="true"/><span>{children}</span></p>;
}
