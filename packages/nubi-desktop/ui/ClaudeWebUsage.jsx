import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {LoadingNote} from './LoadingNote.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import './claude-web-usage.css';
const errors={claude_web_login:'claude.ai 로그인이 필요해요.',claude_web_timeout:'로그인 시간이 지났어요. 다시 시도해 주세요.',claude_web_cancelled:'로그인을 중단했어요.',claude_web_organization:'조직을 찾지 못했어요.',claude_web_format:'사용량 응답 형식이 바뀐 것 같아요.',claude_web_request:'사용량을 읽지 못했어요.',claude_web_busy:'이미 확인 중이에요.',claude_cli_login:'Claude Code에 로그인돼 있지 않아요. 터미널에서 claude 로그인 뒤 다시 확인해 주세요.',claude_cli_expired:'Claude Code 로그인이 만료됐어요. claude를 한 번 실행해 다시 로그인해 주세요.',claude_cli_request:'한도를 읽지 못했어요. 네트워크를 확인해 주세요.',claude_cli_format:'한도 응답 형식이 바뀐 것 같아요.',claude_cli_credentials:'Claude Code 로그인 정보를 읽지 못했어요.'};
// Remaining Claude limit (user decision 2026-10-14): read through the Claude Code sign-in first; the in-app claude.ai
// login stays as the fallback when the CLI is not signed in on this PC.
const percent=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,value<=1&&value>=0?value*100:value)):null;
function webLimit(usage){
 let found=null;
 const visit=value=>{if(found||!value||typeof value!=='object')return;for(const item of Object.values(value)){if(item&&typeof item==='object'&&!Array.isArray(item)){const used=percent(item.utilization??item.used_percent??item.percent_used??item.usage);if(used!=null){found={remaining:100-used,resetsAt:item.resets_at||item.reset_at||item.resetsAt||null};return;}visit(item);}}};
 visit(usage);return found;
}
const when=value=>value?new Date(value).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
function Meter({label,remaining,resetsAt}){
 return <div className="usage-window"><div className="usage-row"><span>{label}</span><strong>{`${Math.round(remaining)}% 남음`}</strong></div><div className="context-bar" role="meter" aria-label={`${label} 잔여 한도`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remaining)}><span style={{width:`${remaining}%`}}/></div>{resetsAt&&<span className="usage-caption usage-metadata">{when(resetsAt)} 초기화</span>}</div>;
}
export function ClaudeWebUsage({api}){
 const [cli,setCli]=useState(null),[cliError,setCliError]=useState(''),[state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),alive=useRef(true);
 const readCli=async()=>{try{const value=await api('claudeCliUsage',{action:'read'});if(alive.current){setCli(value);setCliError('');}return true;}catch(e){if(alive.current){setCli(null);setCliError(e.message);}return false;}};
 useEffect(()=>{alive.current=true;void readCli().then(ok=>{if(!ok)return api('claudeWeb',{action:'status'}).then(value=>{if(alive.current)setState(value);}).catch(()=>{});});return()=>{alive.current=false;};},[api]);
 async function run(action){if(busy)return;setBusy(true);setError('');try{if(action==='refresh'&&await readCli())return;const value=await api('claudeWeb',{action});if(alive.current)setState(value);if(action==='disconnect')notifyWorkspaceToast('claude.ai 세션을 지웠어요.');}catch(e){if(alive.current)setError(errors[e.message]||'한도를 읽지 못했어요.');}finally{if(alive.current)setBusy(false);}}
 const limit=!cli&&state?.usage?webLimit(state.usage):null;
 const connected=!!cli||!!state?.connected;
 return <section className="usage-account claude-web-usage" aria-label="Claude 잔여 한도">
  <div className="usage-row"><h3><Icon name="chartColumn" size={16}/>Claude 잔여 한도{cli&&<small>Claude Code 로그인</small>}</h3><span className="claude-account-actions">
   <CxButton data-icon-only busy={busy} disabled={busy} aria-label={connected?'한도 새로고침':'claude.ai에서 읽기'} title={connected?'한도 새로고침':'claude.ai에 로그인해 읽기'} onClick={()=>void run(connected?'refresh':'connect')}><Icon name={connected?'refresh':'logIn'} size={16}/></CxButton>
   {state?.connected&&!cli&&<CxButton data-icon-only disabled={busy} aria-label="claude.ai 세션 지우기" title="세션 지우기" onClick={()=>void run('disconnect')}><Icon name="logOut" size={16}/></CxButton>}
  </span></div>
  {cli&&cli.fiveHour&&<Meter label="5시간 한도" remaining={cli.fiveHour.remaining} resetsAt={cli.fiveHour.resetsAt}/>}
  {cli&&cli.sevenDay&&<Meter label="7일 한도" remaining={cli.sevenDay.remaining} resetsAt={cli.sevenDay.resetsAt}/>}
  {!cli&&busy&&!state?.connected&&<LoadingNote size={18}>앱 안 브라우저에서 claude.ai에 로그인하면 바로 읽어요</LoadingNote>}
  {!cli&&!busy&&!state?.connected&&<p className="usage-caption">{errors[cliError]||'Claude Code 로그인을 찾지 못했어요.'} 로그인 아이콘을 누르면 앱 안 브라우저에서 claude.ai에 로그인해 읽을 수도 있어요.</p>}
  {!cli&&state?.connected&&limit&&<Meter label="남은 한도" remaining={limit.remaining} resetsAt={limit.resetsAt}/>}
  {!cli&&state?.connected&&!limit&&<details className="claude-web-raw"><summary><Icon name="infoCircle" size={14}/>한도를 찾지 못했어요. 읽은 값 보기</summary><pre>{JSON.stringify(state.usage,null,1).slice(0,4000)}</pre></details>}
  {error&&<p className="usage-caption claude-connection-error" role="alert">{error}</p>}
  {(cli?.readAt||state?.readAt)&&<p className="usage-caption">{new Date(cli?.readAt||state.readAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 기준</p>}
 </section>;
}
