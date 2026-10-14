import React,{useEffect,useState} from 'react';
import {DetailPanel,CxButton,Icon} from '@e2e/cx-design-system';
import {ProviderIcon} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {TerminalMark} from './marks.jsx';

const errors={claude_models_unavailable:'Claude 모델 목록을 받지 못했어요. 다시 연결해 주세요.',claude_cli_missing:'설치된 Claude Code의 실행 경로를 확인해 주세요.',claude_cli_unavailable:'Claude Code 파일에 접근할 수 없어요. 실행 권한을 확인해 주세요.',claude_cli_update:'Claude Code를 최신 버전으로 업데이트해 주세요.',claude_login_required:'Claude Code에서 한 번 로그인해 주세요.',claude_cli_timeout:'Claude Code 응답이 늦어요. 다시 확인해 주세요.'};
export function ClaudeConnection({api,onConnected,onClose,openWebPage,initialIssue=null}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[issue,setIssue]=useState(initialIssue);
  const missing=issue==='claude_cli_missing',update=issue==='claude_cli_update';
  async function connect(){setBusy(true);setError('');try{await api('provider',{action:'login',input:{provider:'claude'}});await onConnected();}catch(cause){if(['claude_cli_missing','claude_cli_update','claude_login_required'].includes(cause.message)){setIssue(cause.message);}else setError(errors[cause.message]||'Claude Code 연결을 확인하지 못했어요.');}finally{setBusy(false);}}
  async function openGuide(){try{await openWebPage('https://code.claude.com/docs/en/setup');}catch{setError('설치 안내를 열지 못했어요. 다시 시도해 주세요.');}}
  return <DetailPanel className="deck-dialog nubi-panel claude-connection" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon" data-provider="claude"><ProviderIcon provider="claude"/></span>Claude Code 연결</span>} variant="modal" hideHelp onClose={onClose} footer={<>
    {(missing||update)&&openWebPage&&<CxButton className="claude-install-guide" aria-label="공식 설치 안내" title="Claude Code 공식 설치 안내" disabled={busy} onClick={openGuide}><Icon name="linkExternal" size={16}/>{update?'업데이트 안내':'설치 안내'}</CxButton>}
    <CxButton variant="primary" busy={busy} disabled={busy} onClick={connect}><Icon name={missing||update?'refresh':'logIn'} size={16}/>{missing||update?'연결 확인':'로그인'}</CxButton>
  </>}>
    <div className="claude-connection-summary">
      <strong>{missing?'Claude Code를 찾지 못했어요.':update?'Claude Code 업데이트가 필요해요.':'Claude 계정으로 연결해 주세요.'}</strong>
      <p>{missing?'설치 후 연결을 확인해 주세요.':update?'업데이트 후 다시 연결해 주세요.':'로그인 페이지가 누비 안에서 열려요.'}</p>
    </div>
    {missing&&<details className="claude-connection-help">
      <summary><TerminalMark size={16}/><span>이미 설치했나요?</span><Icon name="chevronDown" size={16}/></summary>
      <p>터미널에서 버전을 확인해 주세요.</p>
      <div className="claude-login-command"><code>claude --version</code><CopyButton text="claude --version" label="버전 확인 명령 복사" disabled={busy}/></div>
    </details>}
    {error&&<p className="claude-connection-error" role="alert"><Icon name="infoCircle" size={16}/><span>{error}</span></p>}
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
const CLI_ERRORS={claude_cli_login:'Claude Code 로그인을 찾지 못했어요. 터미널에서 claude를 실행해 로그인해 주세요.',claude_cli_expired:'Claude Code 로그인이 만료됐어요. Claude Code를 한 번 실행한 뒤 새로고침해 주세요.',claude_cli_credentials:'Claude Code 로그인 정보를 읽지 못했어요.',claude_cli_format:'한도 응답 형식이 바뀌었어요.',claude_cli_request:'한도를 읽지 못했어요. 잠시 후 다시 시도해 주세요.'};
// The Claude Code sign-in's usage read (5-hour and 7-day windows) in the same shape as limits seen in Claude responses.
export function cliWindows(cli){
  if(!cli)return [];const fetchedAt=Date.parse(cli.readAt)||Date.now();
  const rows=[['five_hour','5시간 한도',cli.fiveHour],['seven_day','7일 한도',cli.sevenDay],...(cli.scoped||[]).map((value,index)=>['scoped-'+index,value.label,value])];
  return rows.filter(([,,value])=>value).map(([id,label,value])=>({id,label,remaining:value.remaining,resetsAt:value.resetsAt?Date.parse(value.resetsAt)||null:null,fetchedAt}));
}
// Dollars as llm_router's dashboard writes them: $12.34, more digits only for tiny amounts; other currencies by locale.
export function formatMoney(amount,currency='USD'){
  if(!Number.isFinite(amount))return '—';
  if(currency==='USD'){const digits=amount>0&&amount<.0001?6:amount>0&&amount<.01?4:2;return `$${amount.toFixed(digits)}`;}
  try{return new Intl.NumberFormat('ko-KR',{style:'currency',currency}).format(amount);}catch{return `${amount.toFixed(2)} ${currency}`;}
}
function SpendMeter({spend}){
  const used=formatMoney(spend.used,spend.currency),limit=spend.limit!=null?formatMoney(spend.limit,spend.currency):null;
  const share=spend.limit?Math.max(0,Math.min(100,spend.percent??spend.used/spend.limit*100)):null;
  return <div className="usage-window"><div className="usage-row"><span>사용 금액</span><strong>{limit?`${formatMoney(spend.remaining,spend.currency)} 남음`:`${used} 사용`}</strong></div>
    {share!=null&&<div className="context-bar" role="meter" aria-label="Claude 사용 금액 한도" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}><span style={{width:`${100-share}%`}}/></div>}
    {limit&&<span className="usage-caption usage-metadata">{used} / {limit}</span>}
  </div>;
}
export function ClaudeAccountUsage({data,now=Date.now(),onRefresh,readCliUsage}) {
  // One block (user decision 2026-10-14: "하나만 보여야"): the Claude Code sign-in is read when the panel opens and on
  // refresh, so limits show before any Claude call; limits from recent Claude responses are used when newer.
  const quota=data.claudeAccountUsage;
  const [checking,setChecking]=useState(false),[checkError,setCheckError]=useState(''),[cli,setCli]=useState(null);
  const readCli=async()=>{if(!readCliUsage)return false;try{const value=await readCliUsage();setCli(value);setCheckError('');return true;}catch(error){setCheckError(CLI_ERRORS[error?.message]||CLI_ERRORS.claude_cli_request);return false;}};
  useEffect(()=>{let live=true;if(readCliUsage){setChecking(true);void readCli().finally(()=>{if(live)setChecking(false);});}return()=>{live=false;};},[readCliUsage]);
  async function check(){if(checking)return;setChecking(true);setCheckError('');try{const read=await readCli();if(!read&&onRefresh&&data.connections?.claude?.present)await onRefresh();}catch(error){setCheckError(error?.message==='claude_login_required'?'Claude Code에 다시 연결해 주세요.':'한도를 읽지 못했어요. 잠시 후 다시 시도해 주세요.');}finally{setChecking(false);}}
  const fromCli=cliWindows(cli),fromResponses=quota?.windows||[];
  const newest=list=>Math.max(0,...list.map(item=>item.fetchedAt||0));
  const windows=fromCli.length&&newest(fromCli)>=newest(fromResponses)?fromCli:fromResponses.length?fromResponses:fromCli;
  const readAt=newest(windows);
  return <section className="usage-account claude-account" aria-label="Claude 잔여 한도">
    <div className="usage-row"><h3><ProviderIcon provider="claude"/>Claude 잔여 한도</h3><span className="claude-account-actions"><CxButton data-icon-only busy={checking} disabled={checking} aria-label="Claude 한도 새로고침" title={readAt?`Claude 한도 새로고침\n${new Date(readAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 읽음`:'Claude 한도 새로고침'} onClick={()=>void check()}><Icon name="refresh" size={16}/></CxButton></span></div>
    {cli?.spend&&<SpendMeter spend={cli.spend}/>}
    {!windows.length?cli?.spend?null:<p className="usage-caption" role="status">{checking?'읽는 중':checkError?'':'Claude Code에 로그인하면 한도를 읽어요.'}</p>:windows.map(item=>{
      const expired=item.resetsAt&&item.resetsAt<=now,stale=now-item.fetchedAt>300000,remaining=expired?null:item.remaining;
      return <div className="usage-window" key={item.id}><div className="usage-row"><span>{item.label}</span><strong>{remaining==null?expired?'초기화 후 확인 필요':'비율 미제공':`${stale?'마지막 확인 ':''}${remaining.toLocaleString('ko-KR',{maximumFractionDigits:1})}%${stale?'':' 남음'}`}</strong></div>
        {remaining!=null&&<div className="context-bar" role="meter" aria-label={`Claude ${item.label} 잔여 한도`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}><span style={{width:`${remaining}%`}}/></div>}
        {item.resetsAt&&<span className="usage-caption usage-metadata">{new Date(item.resetsAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 초기화</span>}
      </div>;
    })}
    {checkError&&<p className="usage-caption claude-connection-error" role="alert">{checkError}</p>}
    {(readAt>0||cli?.readAt)&&<p className="usage-caption">{new Date(readAt||Date.parse(cli.readAt)).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 기준</p>}
  </section>;
}
