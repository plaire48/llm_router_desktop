import React,{useEffect,useState} from 'react';
import {Icon} from '../Icon';
import {UploadButton} from '../UploadButton';
import {workspaceDroppedFiles} from './workspaceSite';

const fileSize=size=>size<1024?`${size} B`:size<1024*1024?`${Math.ceil(size/1024)} KB`:`${(size/1024/1024).toFixed(1)} MB`;
export function WorkspaceFiles({site,existing,client,busy,onSelect}){
  const [dragging,setDragging]=useState(false),[stored,setStored]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;setStored(null);setError('');
    if(existing&&!site)client.loadSite(existing).then(document=>{if(active)setStored(document);}).catch(reason=>{if(active)setError(reason.message);});
    return()=>{active=false;};
  },[existing,site,client]);
  const document=site?.document||stored,descriptor=site?.descriptor||existing;
  return <div className="workspace-upload">
    <div role="group" className={`workspace-dropzone${dragging?' is-dragging':''}`} aria-label="페이지 업로드" aria-busy={busy} onDragOver={event=>{event.preventDefault();if(!busy)setDragging(true);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget))setDragging(false);}} onDrop={event=>{event.preventDefault();setDragging(false);if(!busy)onSelect(workspaceDroppedFiles(event.dataTransfer));}}>
      <div className="workspace-upload-copy"><Icon name="upload" size={24}/><span>{busy?'파일을 준비하는 중…':'폴더, ZIP 또는 파일을 놓으세요.'}</span></div>
      <UploadButton disabled={busy} onSelect={onSelect} folderLabel="페이지 폴더 선택" fileLabel="페이지 파일 선택"/>
    </div>
    {descriptor&&<div className="workspace-upload-summary"><span>{descriptor.fileCount.toLocaleString()}개 파일</span><span>{fileSize(descriptor.size)}</span></div>}
    {document&&<ul className="workspace-upload-files" aria-label="업로드한 파일">{document.files.map(file=><li key={file.path}><Icon name="file" size={16}/><span title={file.path}>{file.path}</span><small>{fileSize(file.content.length*3/4-(file.content.endsWith('==')?2:file.content.endsWith('=')?1:0))}</small></li>)}</ul>}
    {error&&<p className="workspace-error" role="alert">{error}</p>}
  </div>;
}
