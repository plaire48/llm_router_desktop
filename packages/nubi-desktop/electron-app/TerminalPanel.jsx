import React,{useEffect,useRef,useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {TerminalMark} from '../ui/marks.jsx';
import '@xterm/xterm/css/xterm.css';
import {notifyWorkspaceToast} from '../ui/WorkspaceToast.jsx';
import {promptFor} from '../ui/TerminalBlock.jsx';
import {guardShellMouse} from './terminal-mouse.mjs';
import {terminalOutputBatch} from './terminal-output.mjs';
const request=async args=>{const result=await window.nubi.terminal(args);if(result?.__nubiError)throw Error(result.__nubiError);return result;};
function transcript(view){const buffer=view?.buffer.active;if(!buffer)return '';const lines=[];for(let i=0;i<buffer.length;i++)lines.push(buffer.getLine(i)?.translateToString(true)||'');return lines.join('\n').trimEnd();}
export default function TerminalPanel({sessionId,processId,api,onInteractive,project,cwd,profileId,onError,onBusy,visible=true}){
 const node=useRef(null),terminal=useRef(null),fit=useRef(null),errors=useRef(onError),shown=useRef(visible),ready=useRef(false);
 errors.current=onError;shown.current=visible;
 const [processInfo,setProcessInfo]=useState(null);
 const [state,setState]=useState('opening'),[selected,setSelected]=useState(false);
 const busyCallback=useRef(onBusy);busyCallback.current=onBusy;
 useEffect(()=>{busyCallback.current?.(['opening','checking','running','stopping'].includes(state));return()=>busyCallback.current?.(false);},[state]);
 const profile=project.profiles.find(item=>item.id===profileId);
 useEffect(()=>{
  let alive=true,frame=0,lastSize='',attached=false;const queued=[];
  const scope={id:sessionId,projectId:project.projectId};
  const style=getComputedStyle(node.current),color=name=>style.getPropertyValue(name).trim();
  // A plain click only focuses or selects. Alt+click cursor moves are off: they type arrow keys, and an Up/Down arrow
  // recalls history in PowerShell and cmd (user report 2026-10-14: a click filled the prompt with arrows).
  const view=new Terminal({cursorBlink:true,cursorStyle:'bar',altClickMovesCursor:false,scrollback:3000,fontFamily:style.getPropertyValue('--nubi-code-family').trim()||style.fontFamily,fontSize:parseFloat(style.fontSize),theme:{background:color('--nubi-terminal-surface'),foreground:color('--nubi-terminal-ink'),cursor:color('--nubi-terminal-accent'),selectionBackground:color('--nubi-terminal-selection')}});
  const mouse=guardShellMouse(view);
  const addon=new FitAddon();view.loadAddon(addon);view.open(node.current);view.textarea?.setAttribute('aria-label',`${profile?.label||'셸'} 터미널 입력`);terminal.current=view;fit.current=addon;
  if(processId){
   view.options.disableStdin=true;view.options.cursorBlink=false;view.textarea?.setAttribute('aria-label','명령 실행 기록');
   let timer,lastOutput='',header=false,ended=false;
   const resize=()=>{if(!shown.current)return;addon.fit();};const observer=new ResizeObserver(resize);observer.observe(node.current);resize();
   const selection=view.onSelectionChange(()=>setSelected(view.hasSelection()));
   const poll=async()=>{try{
    const value=await api('poll',{id:processId,_projectId:project.projectId});if(!alive)return;
    setProcessInfo(value);setState(value.state);
    if(!header){view.writeln(`${promptFor(value.profile,value.cwd)} ${String(value.script||'').replace(/\r?\n/g,'\r\n')}`);header=true;}
    const output=String(value.output||'');if(output!==lastOutput){if(output.startsWith(lastOutput))view.write(output.slice(lastOutput.length).replace(/\r?\n/g,'\r\n'));else{view.clear();view.writeln('[출력 기록 갱신]');view.write(output.replace(/\r?\n/g,'\r\n'));}lastOutput=output;}
    const active=['checking','running','stopping'].includes(value.state);
    if(!active&&!ended){view.writeln(`\r\n[${({completed:'명령 종료',failed:'실행 실패',cancelled:'중지됨',timed_out:'시간 초과',interrupted:'중단됨'})[value.state]||value.state}${value.exitCode!=null?` / exit ${value.exitCode}`:''}]`);ended=true;}
    if(active)timer=setTimeout(poll,shown.current?500:1500);
   }catch(error){if(alive){setState('failed');errors.current(error);}}};void poll();
   return()=>{alive=false;clearTimeout(timer);observer.disconnect();selection.dispose();mouse.dispose();view.dispose();terminal.current=null;};
  }
  const send=(action,args={})=>request({...scope,action,...args});
  const write=(data,ack=false)=>view.write(data,()=>{if(alive&&ack)void send('ack',{length:data.length}).catch(()=>{});});
  const outputBatch=terminalOutputBatch(data=>write(data,true));
  // A local server announced in this terminal opens in the app browser once, with a notice for every new origin
  // (user request 2026-10-14: a dev server must be visible and checkable without hunting for the address).
  const servers={seen:new Set(),tail:'',opened:false};
  const announce=chunk=>{const text=(servers.tail+chunk).slice(-4000);servers.tail=text.slice(-200);for(const match of text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s'"`<>)\]]*)?/g)){let url;try{url=new URL(match[0]);}catch{continue;}if(url.hostname==='0.0.0.0')url.hostname='localhost';const origin=url.origin;if(servers.seen.has(origin))continue;servers.seen.add(origin);const first=!servers.opened;servers.opened=true;if(first)void window.nubi.request('openWorkspacePage',{url:url.href}).catch(()=>{});notifyWorkspaceToast(`로컬 서버가 열렸어요: ${origin}`,{action:{label:'앱 브라우저로 열기',onClick:()=>void window.nubi.request('openWorkspacePage',{url:url.href}).catch(()=>{})}});}};
  const receive=event=>{
   if(!alive||event.id!==sessionId)return;
   if(!attached){queued.push(event);return;}
   if(event.type==='data'){outputBatch.push(String(event.data||''));announce(String(event.data||''));}
   else{outputBatch.flush();ready.current=false;setState(event.type==='exit'?'exited':'disconnected');view.writeln(event.type==='exit'?`\r\n[셸 종료 ${event.exitCode}]`:'\r\n[터미널 연결이 끊겼어요.]');}
  };
  const unsubscribe=window.nubi.onTerminalEvent(receive);
  // Every fit path (including tab re-entry) must update the actual shell's grid.
  const grid=view.onResize(({cols,rows})=>{if(ready.current)void send('resize',{cols,rows}).catch(()=>{});});
  const resize=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;const rect=node.current?.getBoundingClientRect();if(!rect?.width||!rect.height){lastSize='';return;}const key=`${rect.width}:${rect.height}`;if(key===lastSize)return;lastSize=key;addon.fit();});};
  const observer=new ResizeObserver(resize);observer.observe(node.current);resize();
  const input=view.onData(data=>{if(!ready.current)return;void send('input',{data}).catch(error=>{if(alive){ready.current=false;setState('disconnected');errors.current(error);}});});
  const selection=view.onSelectionChange(()=>setSelected(view.hasSelection()));
  view.attachCustomKeyEventHandler(event=>{
   if(event.type!=='keydown')return true;
   // Let app tab shortcuts through; Escape belongs to the running shell.
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='w')return false;
   if(event.key==='Escape')event.stopPropagation();
   if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='c'){if(view.hasSelection()){void navigator.clipboard.writeText(view.getSelection());event.preventDefault();return false;}}
   return true;
  });
  void send('open',{profile:profileId,path:cwd,cols:view.cols,rows:view.rows}).then(result=>{
   if(!alive){void send('detach').catch(()=>{});return;}
   // Startup events are already in the host replay. Only events following this reply are live.
   if(result.windowsPty)view.options.windowsPty=result.windowsPty;
   queued.length=0;attached=true;ready.current=result.state==='running';setState(result.state);write(result.output||'');
   addon.fit();void send('resize',{cols:view.cols,rows:view.rows}).catch(()=>{});if(shown.current)view.focus();
  }).catch(error=>{if(alive){attached=true;setState('failed');errors.current(error);}});
  return()=>{alive=false;ready.current=false;cancelAnimationFrame(frame);outputBatch.dispose();observer.disconnect();unsubscribe();grid.dispose();input.dispose();selection.dispose();mouse.dispose();view.dispose();terminal.current=null;void send('detach').catch(()=>{});};
 },[sessionId,processId,project.projectId]);
 useEffect(()=>{if(visible){fit.current?.fit();terminal.current?.focus();}},[visible]);
 return <section className="desktop-terminal" hidden={!visible} aria-label="프로젝트 터미널" data-terminal-state={state}>
  <div className="desktop-terminal-heading"><TerminalMark size={16}/><strong>{project.profiles.find(p=>p.id===processInfo?.profile)?.label||profile?.label||'터미널'}</strong><span title={cwd||project.root}>{cwd||project.root}</span>{processId&&<span className="desktop-terminal-process-state">{({checking:'실행 전 확인',running:'실행 중',stopping:'중지 중',completed:'명령 종료',failed:'실행 실패',cancelled:'중지됨',timed_out:'시간 초과',interrupted:'중단됨'})[state]||'연결 중'}</span>}<div className="desktop-terminal-process-actions">{processId&&state==='running'&&<CxButton aria-label="명령 중지" title="명령 중지" onClick={()=>void api('stop',{id:processId,_projectId:project.projectId}).catch(onError)}><span className="stop-symbol" aria-hidden="true"/></CxButton>}{processId&&onInteractive&&<CxButton aria-label="기본 터미널에서 직접 입력" title="새 셸에서 직접 입력" onClick={onInteractive}><Icon name="plus" size={16}/></CxButton>}</div><div className="desktop-terminal-copy-actions">{selected&&<CopyButton getText={()=>terminal.current?.getSelection()||''} label="선택한 내용 복사" successMessage="선택한 내용을 복사했습니다."/>}<CopyButton getText={()=>transcript(terminal.current)} label="터미널 내용 복사" successMessage="터미널 내용을 복사했습니다."/></div><CxButton aria-label="터미널 출력 지우기" title="출력 지우기" onClick={()=>{terminal.current?.clear();terminal.current?.focus();}}><Icon name="filterClear" size={16}/></CxButton></div>
  <div ref={node} className="desktop-terminal-output"/>
  {state==='opening'&&<div className="desktop-terminal-recovery" role="status">터미널 여는 중</div>}
  {!processId&&['failed','disconnected'].includes(state)&&<div className="desktop-terminal-recovery" role="status">터미널을 다시 열어 주세요.</div>}
 </section>;
}
