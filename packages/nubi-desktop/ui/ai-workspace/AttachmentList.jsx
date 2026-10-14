import React,{useState} from 'react';
import {ActionButton} from './ActionButton';
import {Icon} from './Icon';
import {notifyToast} from './Toast';
import './attachments.css';

const sizeLabel=bytes=>bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:bytes>=1024?`${(bytes/1024).toFixed(1)} KB`:`${bytes} B`;
export function AttachmentList({files,onDownload,onRemove,disabled=false,compact=false,label='첨부파일'}) {
  const [downloading,setDownloading]=useState(null);
  if(!files.length)return null;
  const download=async(file,index)=>{
    if(downloading!==null)return;setDownloading(index);
    try{await onDownload(file);}catch(error){notifyToast(error,{source:'attachment-download',error:true});}finally{setDownloading(null);}
  };
  return <section className={`attachment-section${compact?' is-compact':''}`} aria-label={label}>
    {!compact&&<header><h3>{label}<span>{files.length}</span></h3></header>}
    <ul>{files.map((file,index)=><li key={file.url||file.path||file.name}>
      <Icon name="file" size={compact?16:18}/><span className="attachment-name" title={file.name}>{file.name}</span>{file.size>0&&<small>{sizeLabel(file.size)}</small>}
      {onDownload&&<ActionButton action="download" label={`${file.name} 다운로드`} busy={downloading===index} disabled={disabled||downloading!==null} onClick={()=>download(file,index)}/>}
      {onRemove&&<ActionButton action="delete" label={`${file.name} 첨부 삭제`} disabled={disabled} onClick={()=>onRemove(index)}/>}
    </li>)}</ul>
  </section>;
}
