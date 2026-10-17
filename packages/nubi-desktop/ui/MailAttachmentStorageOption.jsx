import React from 'react';
import {SettingToggle} from './SettingToggle.jsx';
import './mail-storage-setup.css';
export function MailAttachmentStorageOption({checked,disabled,onChange}){
 return <SettingToggle className="nubi-mail-storage-option" icon="file" label="첨부 원본도 보관" description={checked?'원본 다운로드 가능 / 저장 용량 증가':'읽은 내용만 보관 / 원본 다운로드 불가'} checked={checked} disabled={disabled} onChange={onChange}/>;
}
