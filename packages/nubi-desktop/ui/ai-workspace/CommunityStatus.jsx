import React from 'react';
import {Icon} from './Icon';
import {LoadingNote} from '../LoadingNote.jsx';

// Keep retrieval feedback beside the content it describes.
export function CommunityStatus({loading=false,error='',label='불러오는 중…',className=''}) {
  if(!loading&&!error)return null;
  if(!error)return <LoadingNote className={`community-load-status ${className}`.trim()}>{String(label).replace(/…$/,'')}</LoadingNote>;
  return <div className={`community-load-status is-error ${className}`.trim()} role="alert">
    <Icon name="alertCircle" size={20}/>
    <p>{error}</p>
  </div>;
}
