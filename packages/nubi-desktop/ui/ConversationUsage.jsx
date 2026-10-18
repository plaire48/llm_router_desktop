import React,{useEffect,useState} from 'react';
import {CxButton,DetailPanel} from '@e2e/cx-design-system';
import {PanelTitle} from './SettingsSection.jsx';
import {CollectionTable} from './CollectionTable.jsx';
import './conversation-usage.css';
const labels={planner:'계획',actor:'작업 실행',reviewer:'검토',summary:'요약',analysis:'분석',research:'하위 조사'};
const number=value=>Number(value).toLocaleString('ko-KR');
export function ConversationUsage({api,taskId,onClose}){
 const [data,setData]=useState(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;setData(null);setError(false);api('taskUsage',{taskId}).then(value=>{if(live)setData(value);},()=>{if(live)setError(true);});return()=>{live=false;};},[api,taskId,retry]);
 const tokens=(row,field)=>row[field]===null?'—':`${number(row[field])}${row.reports[field]<row.calls?'*':''}`;
 return <DetailPanel className="deck-dialog nubi-panel nubi-panel--wide nubi-conversation-usage" title={<PanelTitle icon="chartColumn">이 대화의 사용량</PanelTitle>} variant="modal" onClose={onClose}>
  {error?<p role="alert">사용량을 읽지 못했어요. <CxButton onClick={()=>setRetry(value=>value+1)}>다시 시도</CxButton></p>:!data?<p role="status">사용량을 불러오고 있어요.</p>:<>
   <dl className="nubi-usage-summary"><div><dt>모델 호출</dt><dd>{number(data.modelCalls)}회</dd></div><div><dt>실행</dt><dd>{number(data.runCount)}회</dd></div><div><dt>도구 사용</dt><dd>{number(data.toolCalls)}회</dd></div><div><dt>모델 처리 시간 합계</dt><dd>{number(Math.round(data.elapsedMs/1000))}초</dd></div></dl>
   <div className="nubi-usage-table" tabIndex={0} role="region" aria-label="목적별 호출과 토큰"><CollectionTable variant="usage"><thead><tr><th scope="col">목적</th><th scope="col">호출</th><th scope="col" title="prompt tokens">입력</th><th scope="col" title="completion tokens">출력</th><th scope="col" title="cached tokens">캐시</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.purpose}><td>{labels[row.purpose]}</td><td>{number(row.calls)}</td>{['promptTokens','completionTokens','cachedTokens'].map(field=><td key={field}>{tokens(row,field)}</td>)}</tr>)}</tbody></CollectionTable></div>
   <p className="nubi-muted">압축 {number(data.compactions)}회 / 재시도 {number(data.retries)}회</p>
   <p className="nubi-muted">— 미제공 / * 일부 호출만 집계된 토큰</p><details className="nubi-usage-notes"><summary>집계 기준</summary><p>분석에는 문서 처리와 위키 갱신이 포함됩니다.</p><p>보관된 실행 기록 기준이며 30일 이전 기록은 없을 수 있어요. 처리 시간은 동시 실행을 포함한 합계입니다.</p></details>
  </>}
 </DetailPanel>;
}
