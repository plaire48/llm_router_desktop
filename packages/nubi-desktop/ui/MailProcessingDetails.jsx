import React from 'react';
import {ResponseTime} from './ResponseTime.jsx';
import {MailTimestamp} from './MailTimestamp.jsx';
import {TaskProgressBar} from './TaskProgressBar.jsx';

export function MailProcessingDetails({status,processing,stale,updatedAt}){
 if(!status||!processing)return null;
 const progress=status.progress||{},selected=status.destination||status.activeModel;
 const model=(status.catalogs||[]).find(item=>item.provider===selected?.provider)?.models?.find(item=>item.id===selected?.model);
 const measured=processing.measurement;
 return <section className="nubi-mail-processing-details" aria-label="현재 메일 처리 정보">
  {stale&&(updatedAt?<MailTimestamp at={updatedAt} label="마지막으로 확인한 상태"/>:<span className="nubi-mail-timestamp">마지막으로 확인한 상태 (확인 시각 없음)</span>)}
  <p>{processing.detail}</p>
  <div className="nubi-mail-processing-counts">{processing.counts.map(({label,value})=><span key={label}>{label} <b>{value.toLocaleString('ko-KR')}개</b></span>)}</div>
  {measured&&<div className="nubi-mail-processing-measurement"><span>{measured.label} {measured.completed}/{measured.total}개 <b>{Math.floor(measured.completed/measured.total*100)}%</b></span><TaskProgressBar queue={false} label={`${measured.label} 진행률`} value={measured.completed} max={measured.total} phase={`${status.accountKey||'local'}:${processing.stage}`} estimate={!stale&&['attachments','indexing'].includes(processing.stage)?{identity:`${status.accountKey||'local'}:${processing.stage}`,completed:measured.completed,total:measured.total}:undefined}/></div>}
  <div className="nubi-mail-processing-metadata"><span>{processing.connection}</span>{selected?.model&&<span title={`${selected.provider||''} / ${selected.model}`}>{model?.name||selected.model}</span>}{!stale&&progress.timing&&['organizing','attachments'].includes(processing.stage)&&<ResponseTime timing={progress.timing} label="진행" live/>}<MailTimestamp at={status.lastCheckedAt||progress.checkedAt} label="마지막 서버 확인"/><MailTimestamp at={progress.lastAppliedAt} label="최근 정리"/>{status.connected&&status.autoWiki&&!status.watchPaused&&<MailTimestamp at={status.nextCheckAt} label="다음 서버 확인"/>}</div>
 </section>;
}
