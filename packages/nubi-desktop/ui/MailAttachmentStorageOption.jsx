import React from 'react';
import {CxCheckbox,Icon} from '@e2e/cx-design-system';
import './mail-storage-setup.css';
export function MailAttachmentStorageOption({checked,disabled,onChange}){
 return <div className="nubi-mail-storage-option">
  <Icon name="file" size={18}/>
  <CxCheckbox aria-label="첨부 원본도 보관" label={<><strong>첨부 원본도 보관</strong><small>{checked?'원본 다운로드 가능 / 저장 용량 증가':'읽은 내용만 보관 / 원본 다운로드 불가'}</small></>} checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>
 </div>;
}
