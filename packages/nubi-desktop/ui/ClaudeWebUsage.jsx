import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {LoadingNote} from './LoadingNote.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import './claude-web-usage.css';
const errors={claude_web_login:'claude.ai 로그인이 필요해요.',claude_web_timeout:'로그인 시간이 지났어요. 다시 시도해 주세요.',claude_web_cancelled:'로그인을 중단했어요.',claude_web_organization:'조직을 찾지 못했어요.',claude_web_format:'사용량 응답 형식이 바뀐 것 같아요.',claude_web_request:'사용량을 읽지 못했어요.',claude_web_busy:'이미 확인 중이에요.'};
// Reads the usage page's own API with the person's claude.ai session (in-app login), nothing copied out of the session.
const percent=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,value<=1&&value>=0?value*100:value)):null;
function rows(usage){
 const out=[];const push=(label,value)=>{if(out.length<12)out.push({label,value});};
 const visit=(value,prefix)=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){const name=prefix?`${prefix} ${key}`:key;if(item&&typeof item==='object'&&!Array.isArray(item)){const used=percent(item.utilization??item.used_percent??item.percent_used??item.usage);const reset=item.resets_at||item.reset_at||item.resetsAt;if(used!=null||reset){push(name,{used,reset,remaining:used==null?null:100-used});continue;}visit(item,name);}else if(typeof item==='number'||typeof item==='string')push(name,{text:String(item).slice(0,80)});}};
 visit(usage,'');return out;
}
export function ClaudeWebUsage({api}){
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),alive=useRef(true);
 useEffect(()=>{alive.current=true;void api('claudeWeb',{action:'status'}).then(value=>{if(alive.current)setState(value);}).catch(()=>{});return()=>{alive.current=false;};},[api]);
 async function run(action){if(busy)return;setBusy(true);setError('');try{const value=await api('claudeWeb',{action});if(alive.current)setState(value);if(action==='disconnect')notifyWorkspaceToast('claude.ai 세션을 지웠어요.');}catch(e){if(alive.current)setError(errors[e.message]||'사용량을 읽지 못했어요.');}finally{if(alive.current)setBusy(false);}}
 const list=state?.usage?rows(state.usage):[];
 return <section className="usage-account claude-web-usage" aria-label="Claude 웹 사용량">
  <div className="usage-row"><h3><Icon name="chartColumn" size={16}/>claude.ai 사용량{state?.organization?.name&&<small>{state.organization.name}</small>}</h3><span className="claude-account-actions">
   <CxButton data-icon-only busy={busy} disabled={busy} aria-label={state?.connected?'사용량 새로고침':'claude.ai에서 읽기'} title={state?.connected?'사용량 새로고침':'claude.ai에 로그인해 읽기'} onClick={()=>void run(state?.connected?'refresh':'connect')}><Icon name={state?.connected?'refresh':'logIn'} size={16}/></CxButton>
   {state?.connected&&<CxButton data-icon-only disabled={busy} aria-label="claude.ai 세션 지우기" title="세션 지우기" onClick={()=>void run('disconnect')}><Icon name="logOut" size={16}/></CxButton>}
  </span></div>
  {busy&&!state?.connected&&<LoadingNote size={18}>앱 안 브라우저에서 claude.ai에 로그인하면 바로 읽어요</LoadingNote>}
  {!busy&&!state?.connected&&<p className="usage-caption">로그인 아이콘을 누르면 앱 안 브라우저에서 claude.ai(SSO)에 로그인하고, 그 세션으로 사용량 페이지와 같은 값을 읽어요.</p>}
  {state?.connected&&list.map(row=><div className="usage-window" key={row.label}><div className="usage-row"><span>{row.label}</span><strong>{row.value.text??(row.value.remaining==null?'':`${row.value.remaining.toLocaleString('ko-KR',{maximumFractionDigits:1})}% 남음`)}</strong></div>{row.value.remaining!=null&&<div className="context-bar" role="meter" aria-label={`${row.label} 잔여`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.value.remaining}><span style={{width:`${row.value.remaining}%`}}/></div>}{row.value.reset&&<span className="usage-caption usage-metadata">{new Date(row.value.reset).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 초기화</span>}</div>)}
  {state?.connected&&!list.length&&<details className="claude-web-raw"><summary><Icon name="infoCircle" size={14}/>읽은 값 보기</summary><pre>{JSON.stringify(state.usage,null,1).slice(0,4000)}</pre></details>}
  {error&&<p className="usage-caption claude-connection-error" role="alert">{error}</p>}
  {state?.readAt&&<p className="usage-caption">claude.ai 기준 {new Date(state.readAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</p>}
 </section>;
}
