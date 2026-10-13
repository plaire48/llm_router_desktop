import React from 'react';
export function MailTimestamp({at,label='최근 반영',className=''}){
  if(!at||!Number.isFinite(Date.parse(at)))return null;
  const date=new Date(at);
  return <span className={`nubi-mail-timestamp ${className}`}>{label&&<>{label} </>}<time dateTime={at} title={date.toLocaleString()}>{date.toLocaleString('ko-KR',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}</time></span>;
}
