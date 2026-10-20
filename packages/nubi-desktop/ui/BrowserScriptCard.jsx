import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import './browser-teach.css';
// Host must compare the saved hash/version and run receipt again before approval.
export function BrowserScriptCard({script,run,busy=false,canApprove=false,onApprove,onRun}){
 const status={draft:'초안',reviewed:'승인됨',revalidated:'반복 실행 확인'}[script?.status]||'확인 필요';
 return <article className="nubi-browser-script" aria-label="저장한 브라우저 절차">
  <header><Icon name="linkExternal" size={18}/><strong>{script.title}</strong><span className="nubi-muted">{status}</span></header>
  <p className="nubi-muted">버전 {script.version} / {Array.isArray(script.steps)?script.steps.length:script.steps}단계</p>
  {run&&<p role="status">{run.success&&run.receiptId?'시험 실행 완료':run.success?'실행 확인 필요':'실행 중단'}{run.stopped?` — ${run.stopped}`:''}</p>}
  <div className="nubi-browser-teach-actions">{onRun&&<CxButton disabled={busy||script.status==='draft'} onClick={()=>onRun({slug:script.slug,hash:script.hash,version:script.version})}>실행</CxButton>}{script.status==='draft'&&<CxButton variant="primary" disabled={busy||!canApprove||!onApprove} onClick={()=>onApprove({slug:script.slug,hash:script.hash,version:script.version,receiptId:run?.receiptId})}>초안 승인</CxButton>}</div>
 </article>;
}
