import React,{useState} from 'react';
import {ActionButton} from './ActionButton';
import './github-request-error.css';

export function GithubRequestError({error}) {
  const [copy,setCopy]=useState(null);
  const copyError=async()=>{
    try {await navigator.clipboard.writeText(error.diagnosticText);setCopy({error,ok:true});}
    catch {setCopy({error,ok:false});}
  };
  return <div className="github-request-error">
    <p role="alert">{error.message}</p>
    {(error.teamSlug||error.diagnosticText)&&<div className="github-request-error-detail">
      {error.teamSlug&&<span>조회 팀 <strong>{error.teamSlug}</strong></span>}
      {error.diagnosticText&&<ActionButton action="copy" label="오류 정보 복사" success={copy?.error===error&&copy.ok} onClick={copyError}/>}
    </div>}
    {copy?.error===error&&<p className="github-request-copy-status" role="status">{copy.ok?'오류 정보를 복사했습니다.':'복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요.'}</p>}
  </div>;
}
