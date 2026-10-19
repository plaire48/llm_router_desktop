import React from 'react';
import {formatMessageTime} from './message-time.mjs';
export function MessageTimestamp({at,role='user'}){
  const time=formatMessageTime(at);if(!time)return null;
  return <time className="nubi-message-timestamp" dateTime={time.iso} title={time.full} aria-label={`${role==='user'?'보낸':'받은'} 시각 ${time.full}`}>{time.short}</time>;
}
