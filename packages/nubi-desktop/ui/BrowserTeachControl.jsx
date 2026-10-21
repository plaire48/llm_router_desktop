import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxSelect,DetailPanel,Icon} from '@e2e/cx-design-system';
import {PanelTitle,SettingsField} from './SettingsSection.jsx';
import {BrowserTeachPanel} from './BrowserTeachPanel.jsx';
import './browser-teach.css';

const message=code=>({browser_auth_protected:'로그인 화면에서는 녹화하지 않습니다. 로그인을 마친 뒤 업무 화면에서 시작해 주세요.',project_changed:'프로젝트가 바뀌었어요. 현재 프로젝트에서 다시 열어 주세요.',browser_teach_session_invalid:'녹화 세션이 만료됐어요. 다시 녹화해 주세요.',workflow_browser_unavailable:'누비 브라우저 연결을 확인해 주세요.'})[code]||'브라우저 응답을 확인하지 못했어요. 현재 창의 상태를 확인해 주세요.';
export function BrowserTeachControl({api,projectId,visible=true,onObscured}){
 const [recording,setRecording]=useState(null),[session,setSession]=useState(null),[tabs,setTabs]=useState(null),[tabId,setTabId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[panelBusy,setPanelBusy]=useState(false);
 const owner=useRef(0),locked=useRef(false),recordRef=useRef(null),sessionRef=useRef(null);
 const call=(action,args={})=>api('browserTeach',{action,projectId,...args});
 useEffect(()=>{const generation=++owner.current;setRecording(null);setSession(null);setTabs(null);setError('');setBusy(false);setPanelBusy(false);locked.current=false;
  return()=>{if(owner.current===generation)owner.current++;const record=recordRef.current,draft=sessionRef.current;recordRef.current=null;sessionRef.current=null;if(record)void api('browserTeach',{action:'record',projectId,tabId:record.tabId,op:'stop'}).then(result=>{if(result.binding)return api('browserTeach',{action:'discard',binding:result.binding});}).catch(()=>{});if(draft)void api('browserTeach',{action:'discard',binding:draft.binding}).catch(()=>{});};
 },[api,projectId]);
 useEffect(()=>{onObscured?.(Boolean(tabs||session));return()=>onObscured?.(false);},[Boolean(tabs||session),onObscured]);
 useEffect(()=>{if(!recording)return;let stopped=false,pending=false;const generation=owner.current;
  const refresh=async()=>{if(pending)return;pending=true;try{const value=await call('record',{tabId:recording.tabId,op:'status'});if(!stopped&&generation===owner.current)setRecording(old=>old?{...old,events:Array.isArray(value.events)?value.events.length:value.events||0,dropped:value.dropped||0}:old);}catch(e){if(!stopped&&generation===owner.current)setError(message(e.message));}finally{pending=false;}};
  const timer=setInterval(refresh,2000);return()=>{stopped=true;clearInterval(timer);};
 },[api,projectId,recording?.tabId]);
 async function act(work){if(locked.current)return;locked.current=true;setBusy(true);setError('');const generation=owner.current;try{await work(()=>generation===owner.current);}catch(e){if(generation===owner.current)setError(message(e.message));}finally{if(generation===owner.current){locked.current=false;setBusy(false);}}}
 async function start(id,live){const result=await call('record',{tabId:id,op:'start'});if(!live()){const ended=await call('record',{tabId:id,op:'stop'});if(ended.binding)await call('discard',{binding:ended.binding});return;}const record={tabId:id,events:Array.isArray(result.events)?result.events.length:result.events||0,dropped:result.dropped||0};recordRef.current=record;setRecording(record);setTabs(null);}
 async function choose(){await act(async live=>{const result=await call('tabs');if(!live())return;const choices=result.tabs||[];if(!choices.length){setError('녹화할 업무 탭을 먼저 열어 주세요.');return;}const active=choices.filter(tab=>tab.active);if(active.length===1)await start(active[0].tabId,live);else{setTabs(choices);setTabId(choices[0].tabId);}});}
 async function stop(){await act(async live=>{const record=recordRef.current;recordRef.current=null;let result;try{result=await call('record',{tabId:recording.tabId,op:'stop'});}catch(error){if(live())recordRef.current=record;throw error;}if(!live()){if(result.binding)void api('browserTeach',{action:'discard',binding:result.binding}).catch(()=>{});return;}recordRef.current=null;setRecording(null);if(!result.card||!result.binding){setError('기록된 동작이 없어요. 업무 화면에서 클릭이나 입력을 한 뒤 다시 확인해 주세요.');return;}sessionRef.current=result;setSession(result);});}
 async function close(){await act(async live=>{await call('discard',{binding:session.binding});if(live()){sessionRef.current=null;setSession(null);}});}
 return <div className="nubi-browser-teach-control" hidden={!visible}>
  <CxButton disabled={busy||!projectId||Boolean(session||tabs)} onClick={recording?stop:choose}><Icon name={recording?'check':'video'} size={18}/>{recording?'녹화 중지':'녹화 시작'}</CxButton>
  {!recording&&!session&&<p className="nubi-browser-teach-intro">평소처럼 한 번 해 보이세요. 입력한 값은 저장되지 않고 칸으로만 남습니다. 비밀번호 칸은 기록하지 않습니다.</p>}
  {recording&&<span role="status">{recording.events}개 동작{recording.dropped?` / 제외 ${recording.dropped}개`:''}</span>}{error&&!session&&!tabs&&<p role="alert">{error}</p>}
  {tabs&&<DetailPanel className="deck-dialog nubi-panel" variant="modal" title={<PanelTitle icon="video">녹화할 탭</PanelTitle>} busy={busy} onClose={()=>{if(!busy)setTabs(null);}} footer={<CxButton variant="primary" disabled={busy||!tabId} onClick={()=>act(live=>start(tabId,live))}>녹화 시작</CxButton>}><SettingsField id="browser-teach-tab" label="업무 화면"><CxSelect value={tabId} disabled={busy} onChange={e=>setTabId(e.target.value)}>{tabs.map(tab=><option key={tab.tabId} value={tab.tabId}>{tab.title||'제목 없는 탭'}</option>)}</CxSelect></SettingsField>{error&&<p role="alert">{error}</p>}</DetailPanel>}
  {session&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" variant="modal" title={<PanelTitle icon="video">브라우저 가르치기</PanelTitle>} busy={busy||panelBusy} onClose={()=>{if(!busy&&!panelBusy)void close();}}>
   {(session.dropped>0||session.skipped>0)&&<p role="status">제외된 기록 {session.dropped||0}개 / 절차로 만들지 못한 기록 {session.skipped||0}개</p>}
   {error&&<p role="alert">{error}</p>}<BrowserTeachPanel embedded {...session} onBusyChange={setPanelBusy} onTest={args=>call('test',args)} onSave={args=>call('save',args)} onApprove={args=>call('approve',args)}/>
  </DetailPanel>}
 </div>;
}
