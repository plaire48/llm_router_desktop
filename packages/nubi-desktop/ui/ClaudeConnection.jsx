import React,{useState} from 'react';
import {DetailPanel,CxButton,Icon} from '@e2e/cx-design-system';
import {ProviderIcon} from '../../../extensions/aipro-chat/src/ChatControls.jsx';

const errors={claude_models_unavailable:'Claude 모델 목록을 받지 못했어요. 다시 연결해 주세요.',claude_cli_missing:'설치된 Claude Code의 실행 경로를 확인해 주세요.',claude_cli_unavailable:'Claude Code 파일에 접근할 수 없어요. 실행 권한을 확인해 주세요.',claude_cli_update:'Claude Code를 최신 버전으로 업데이트해 주세요.',claude_login_required:'Claude Code에서 한 번 로그인해 주세요.',claude_cli_timeout:'Claude Code 응답이 늦어요. 다시 확인해 주세요.'};
export function ClaudeConnection({api,onConnected,onClose,openWebPage,initialIssue=null}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[issue,setIssue]=useState(initialIssue);
  const missing=issue==='claude_cli_missing',update=issue==='claude_cli_update';
  async function connect(){setBusy(true);setError('');try{await api('provider',{action:'login',input:{provider:'claude'}});await onConnected();}catch(cause){if(['claude_cli_missing','claude_cli_update','claude_login_required'].includes(cause.message))setIssue(cause.message);setError(errors[cause.message]||'Claude Code 연결을 확인하지 못했어요.');}finally{setBusy(false);}}
  return <DetailPanel className="deck-dialog nubi-panel claude-connection" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon" data-provider="claude"><ProviderIcon provider="claude"/></span>Claude Code 연결</span>} variant="modal" hideHelp onClose={onClose} footer={<CxButton variant="primary" busy={busy} disabled={busy} onClick={connect}><Icon name="logIn" size={16}/>{missing||update?'연결 확인':'로그인'}</CxButton>}>
    <p><strong>{missing?'Claude Code 실행 경로를 찾지 못했어요.':update?'Claude Code 업데이트가 필요합니다.':'Claude 계정으로 연결해 주세요.'}</strong></p>
    <ol className="claude-setup-steps">
      <li hidden={!missing&&!update}><div className="claude-setup-heading"><strong><Icon name="download" size={18}/>{update?'업데이트':'설치'}</strong>{openWebPage&&<CxButton disabled={busy} onClick={async()=>{try{await openWebPage('https://code.claude.com/docs/en/setup');}catch{setError('설치 안내를 열지 못했어요. 다시 시도해 주세요.');}}}><Icon name="linkExternal" size={16}/>공식 설치 안내</CxButton>}</div><p className="usage-caption">{update?'최신 버전으로 업데이트한 뒤 다시 연결해 주세요.':'설치하지 않았다면 공식 안내를 따라 설치해 주세요.'}</p></li>
    </ol>
    <p className="usage-caption">{missing?'PowerShell에서 claude --version을 확인한 뒤 연결 확인을 눌러 주세요.':update?'업데이트 후 연결 확인을 눌러 주세요.':'누비 안에서 로그인 페이지가 열립니다.'}</p>
    {error&&<p className="claude-connection-error" role="alert">{error}</p>}
  </DetailPanel>;
}
const PLAN_LABELS={max:'Max',pro:'Pro',team:'Team',enterprise:'Enterprise',free:'Free'};
const percent=value=>value.toLocaleString('ko-KR',{maximumFractionDigits:0});
export function tightestClaudeWindow(quota,now=Date.now()){const live=(quota?.windows||[]).filter(item=>item.remaining!=null&&(!item.resetsAt||item.resetsAt>now));return live.length?live.reduce((low,item)=>item.remaining<low.remaining?item:low):null;}
// Window toolbar pill: the window closest to its limit, with every window on hover.
export function ClaudeQuotaPill({quota,plan,now=Date.now(),onClick}){
  const window=tightestClaudeWindow(quota,now);if(!window)return null;
  const remaining=Math.max(0,Math.min(100,window.remaining));
  const detail=(quota.windows||[]).map(item=>`${item.label} ${item.remaining==null?'확인 필요':`${percent(item.remaining)}% 남음`}${item.resetsAt?` (${new Date(item.resetsAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 초기화)`:''}`).join('\n');
  return <button type="button" className="nubi-claude-quota" data-level={remaining<=10?'critical':remaining<=25?'low':'ok'} aria-label={`Claude 잔여 한도 ${window.label} ${percent(remaining)}% 남음`} title={`Claude 잔여 한도${plan?` (${PLAN_LABELS[plan]||plan})`:''}\n${detail}`} onClick={onClick}><ProviderIcon provider="claude"/><b>{percent(remaining)}%</b><i aria-hidden="true"><span style={{width:`${remaining}%`}}/></i></button>;
}
export function ClaudeAccountUsage({data,now=Date.now(),openWebPage,onRefresh}) {
  const connected=data.connections?.claude?.present,quota=data.claudeAccountUsage,plan=data.claudePlan,extra=quota?.extra;
  const [checking,setChecking]=useState(false),[checkError,setCheckError]=useState('');
  const extraLabel=!extra?null:extra.active?'추가 사용 중':extra.status==='allowed'?'추가 사용 가능':extra.reason==='org_level_disabled'?'조직 정책으로 꺼짐':extra.status==='rejected'?'사용 안 함':null;
  async function check(){if(!onRefresh||checking)return;setChecking(true);setCheckError('');try{await onRefresh();}catch(error){setCheckError(error?.message==='claude_login_required'?'Claude Code에 다시 연결해 주세요.':'한도를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');}finally{setChecking(false);}}
  return <section className="usage-account claude-account" aria-label="Claude 잔여 한도">
    <div className="usage-row"><h3><ProviderIcon provider="claude"/>Claude 잔여 한도{plan&&<span className="claude-plan">{PLAN_LABELS[plan]||plan}</span>}</h3><span className="claude-account-actions">{connected&&onRefresh&&<CxButton busy={checking} disabled={checking} aria-label="Claude 한도 확인" title="짧은 확인 요청 1회를 보내 현재 한도를 읽어요" onClick={check}><Icon name="refresh" size={16}/><span>{quota?.windows?.length?'다시 확인':'한도 확인'}</span></CxButton>}{openWebPage&&<CxButton data-icon-only aria-label="Claude 계정 사용량 보기" title="Claude 계정 사용량 보기" onClick={()=>openWebPage('https://claude.ai/settings/usage')}><Icon name="linkExternal" size={16}/></CxButton>}</span></div>
    {!connected?<p className="usage-caption">Claude Code 연결 후 확인할 수 있습니다.</p>:!quota?.windows?.length?<p className="usage-caption">{onRefresh?'한도 확인을 누르면 짧은 요청 1회로 읽어요.':'한도 정보 수신 대기. Claude 응답 후 확인합니다.'}</p>:quota.windows.map(item=>{
      const expired=item.resetsAt&&item.resetsAt<=now,stale=now-item.fetchedAt>300000,remaining=expired?null:item.remaining;
      return <div className="usage-window" key={item.id}><div className="usage-row"><span>{item.label}</span><strong>{remaining==null?expired?'초기화 후 확인 필요':'비율 미제공':`${stale?'마지막 확인 ':''}${remaining.toLocaleString('ko-KR',{maximumFractionDigits:1})}%${stale?'':' 남음'}`}</strong></div>
        {remaining!=null&&<div className="context-bar" role="meter" aria-label={`Claude ${item.label} 잔여 한도`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}><span style={{width:`${remaining}%`}}/></div>}
        {item.resetsAt&&<span className="usage-caption usage-metadata">{new Date(item.resetsAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 초기화</span>}
      </div>;
    })}
    {connected&&extraLabel&&<p className="usage-caption">추가 사용: {extraLabel}</p>}
    {checkError&&<p className="usage-caption claude-connection-error" role="alert">{checkError}</p>}
    {connected&&quota?.windows?.length>0&&<p className="usage-caption">Claude 응답 기준 {new Date(quota.fetchedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</p>}
  </section>;
}
