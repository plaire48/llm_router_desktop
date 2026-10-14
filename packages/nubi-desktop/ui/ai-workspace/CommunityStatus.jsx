import React from 'react';
import {Icon} from './Icon';

// Keep retrieval feedback beside the content it describes.
export function CommunityStatus({loading=false,error='',label='불러오는 중…',className=''}) {
  if(!loading&&!error)return null;
  return <div className={`community-load-status${error?' is-error':''} ${className}`.trim()} role={error?'alert':'status'}>
    {error?<Icon name="alertCircle" size={20}/>:<span className="status-spinner" aria-hidden="true"/>}
    <p>{error||label}</p>
  </div>;
}
