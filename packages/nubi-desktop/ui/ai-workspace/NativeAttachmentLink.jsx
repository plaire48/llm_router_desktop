import React from 'react';
import {ActionLink} from './ActionButton';
import {GHES_CONFIG,SERVICE_DESK_CONFIG,TALK_CONFIG} from './config';
import {isDiscussionKey,discussionNumber} from './discussionModel';
export function NativeAttachmentLink({number,kind='inquiry'}){
  const discussion=kind==='talk'&&isDiscussionKey(number);
  if(!discussion&&(!Number.isSafeInteger(number)||number<1))return null;
  const target=kind==='talk'?TALK_CONFIG:SERVICE_DESK_CONFIG;
  return <ActionLink action="attachment" label="GitHub에서 첨부" href={`https://${GHES_CONFIG.host}/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${discussion?'discussions':'issues'}/${discussion?discussionNumber(number):number}${discussion?'':'#issuecomment-new'}`} target="_blank" rel="noopener noreferrer"/>;
}
