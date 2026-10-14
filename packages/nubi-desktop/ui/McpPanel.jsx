import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {LoadingNote} from './LoadingNote.jsx';
import './mcp-panel.css';

// MCP servers (user request 2026-10-14): a list with connection state and tools, and one form for a stdio command or a
// Streamable HTTP address. Secret values (environment values, headers) go to the host vault and are never shown back.
const EMPTY={id:'',name:'',transport:'stdio',command:'',args:'',cwd:'',envKeys:'',url:'',headerKeys:'',secrets:{},enabled:true};
const errors={mcp_server_invalid:'입력을 확인해 주세요. 아이디는 영문 소문자와 숫자, 하이픈 2~40자이고 명령 또는 http(s) 주소가 필요해요.',mcp_server_limit:'MCP 서버는 16개까지 등록할 수 있어요.',mcp_server_missing:'서버를 찾지 못했어요.',secret_unavailable:'이 PC에서는 비밀값을 안전하게 보관할 수 없어요.',mcp_connect_failed:'서버에 연결하지 못했어요. 명령 또는 주소와 로그를 확인해 주세요.',mcp_connect_timeout:'서버가 제때 응답하지 않았어요.'};
const splitList=value=>String(value||'').split(/[\s,]+/).map(item=>item.trim()).filter(Boolean);
const splitArgs=value=>{const out=[];const re=/"([^"]*)"|'([^']*)'|(\S+)/g;let match;while((match=re.exec(String(value||''))))out.push(match[1]??match[2]??match[3]);return out;};
export function McpPanel({api}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[form,setForm]=useState(null),live=useRef(true);
 const load=async()=>{try{const value=await api('mcp',{action:'list'});if(live.current)setData(value.servers||[]);}catch{if(live.current)notifyWorkspaceToast('MCP 서버 목록을 읽지 못했어요.',{error:true});}};
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[api]);
 const act=async(args,done)=>{if(busy)return;setBusy(true);try{const value=await api('mcp',args);if(live.current){await load();done?.(value);}}catch(error){if(live.current)notifyWorkspaceToast(errors[error.message]||`MCP 서버 작업을 마치지 못했어요. (${error.message})`,{error:true});}finally{if(live.current)setBusy(false);}};
 const edit=server=>setForm(server?{...EMPTY,...server,args:(server.args||[]).map(item=>/\s/.test(item)?`"${item}"`:item).join(' '),envKeys:(server.envKeys||[]).join(', '),headerKeys:(server.headerKeys||[]).join(', '),secrets:{}}:{...EMPTY});
 const keys=form?.transport==='stdio'?splitList(form.envKeys):splitList(form?.headerKeys);
 const submit=event=>{
  event.preventDefault();if(!form)return;
  const secrets=Object.fromEntries(keys.filter(key=>typeof form.secrets[key]==='string'&&form.secrets[key]).map(key=>[key,form.secrets[key]]));
  const server=form.transport==='stdio'?{id:form.id.trim(),name:form.name.trim(),transport:'stdio',command:form.command.trim(),args:splitArgs(form.args),cwd:form.cwd.trim()||null,envKeys:keys,enabled:form.enabled,...(Object.keys(secrets).length?{secrets}:{})}:{id:form.id.trim(),name:form.name.trim(),transport:'http',url:form.url.trim(),headerKeys:keys,enabled:form.enabled,...(Object.keys(secrets).length?{secrets}:{})};
  void act({action:'save',server},()=>{setForm(null);notifyWorkspaceToast('MCP 서버를 저장했어요.',{success:true});});
 };
 if(!data)return <LoadingNote>MCP 서버를 불러오는 중</LoadingNote>;
 return <div className="nubi-mcp-panel">
  <p className="nubi-muted">MCP 서버의 도구를 에이전트가 쓸 수 있어요. 읽기 전용 도구는 바로 실행하고, 그 밖의 도구는 실행 전에 물어봐요.</p>
  {data.length===0&&!form&&<p className="nubi-mcp-empty"><Icon name="infoCircle" size={16}/><span>등록한 MCP 서버가 없어요.</span></p>}
  <ul className="nubi-mcp-list">
   {data.map(server=><li key={server.id} className="nubi-mcp-item" data-state={server.state}>
    <div className="nubi-mcp-head">
     <span className="nubi-mcp-state" aria-hidden="true"><Icon name={server.state==='connected'?'check':server.state==='failed'?'alertCircle':server.state==='connecting'?'refresh':'minus'} size={16}/></span>
     <div className="nubi-mcp-title"><strong>{server.name||server.id}</strong><small>{server.transport==='stdio'?`${server.command} ${(server.args||[]).join(' ')}`.trim():server.url}</small></div>
     <span className="nubi-mcp-badge">{server.state==='connected'?`도구 ${server.tools.length}개`:server.state==='failed'?(errors[server.error]||'연결 실패'):server.state==='connecting'?'연결 중':server.enabled?'연결 안 됨':'사용 안 함'}</span>
     <span className="nubi-mcp-actions">
      {server.state==='connected'?<WorkspaceAction action="logout" label="연결 끊기" disabled={busy} onClick={()=>act({action:'disconnect',id:server.id})}/>:<WorkspaceAction action="login" label="연결" disabled={busy} onClick={()=>act({action:'connect',id:server.id},()=>notifyWorkspaceToast('MCP 서버에 연결했어요.',{success:true}))}/>}
      <WorkspaceAction action="edit" label="편집" disabled={busy} onClick={()=>edit(server)}/>
      <WorkspaceAction action="delete" label="삭제" disabled={busy} onClick={()=>act({action:'remove',id:server.id},()=>notifyWorkspaceToast('MCP 서버를 삭제했어요.'))}/>
     </span>
    </div>
    {server.tools.length>0&&<ul className="nubi-mcp-tools">{server.tools.map(tool=><li key={tool.name} title={tool.description}><Icon name={tool.readOnly?'eye':'pencil'} size={14}/><span>{tool.name}</span></li>)}</ul>}
   </li>)}
  </ul>
  {form?<form className="nubi-mcp-form" onSubmit={submit} aria-label="MCP 서버 등록">
   <div className="nubi-mcp-grid">
    <label>아이디<CxInput value={form.id} disabled={!!data.find(server=>server.id===form.id&&form.name!==undefined&&server.addedAt&&form.addedAt)} onChange={event=>setForm({...form,id:event.target.value.toLowerCase()})} placeholder="ghes-tools" required/></label>
    <label>이름<CxInput value={form.name} onChange={event=>setForm({...form,name:event.target.value})} placeholder="사내 GHES 도구"/></label>
    <label>연결 방식<CxSelect value={form.transport} onChange={event=>setForm({...form,transport:event.target.value})}><option value="stdio">명령 실행 (stdio)</option><option value="http">HTTP 서버 (Streamable HTTP)</option></CxSelect></label>
   </div>
   {form.transport==='stdio'?<div className="nubi-mcp-grid">
    <label>명령<CxInput value={form.command} onChange={event=>setForm({...form,command:event.target.value})} placeholder="npx 또는 C:\\...\\node.exe" required/></label>
    <label>인자<CxInput value={form.args} onChange={event=>setForm({...form,args:event.target.value})} placeholder="-y @scope/mcp-server --flag"/></label>
    <label>작업 폴더<CxInput value={form.cwd} onChange={event=>setForm({...form,cwd:event.target.value})} placeholder="비우면 기본 폴더"/></label>
    <label>환경 변수 이름<CxInput value={form.envKeys} onChange={event=>setForm({...form,envKeys:event.target.value})} placeholder="API_TOKEN, BASE_URL"/></label>
   </div>:<div className="nubi-mcp-grid">
    <label>주소<CxInput value={form.url} onChange={event=>setForm({...form,url:event.target.value})} placeholder="https://mcp.company.local/mcp" required/></label>
    <label>헤더 이름<CxInput value={form.headerKeys} onChange={event=>setForm({...form,headerKeys:event.target.value})} placeholder="Authorization"/></label>
   </div>}
   {keys.length>0&&<div className="nubi-mcp-secrets"><small>{form.transport==='stdio'?'환경 변수 값':'헤더 값'}은 이 PC의 보관소에만 저장되고 다시 보여 주지 않아요. 비우면 기존 값을 유지해요.</small>{keys.map(key=><label key={key}>{key}<CxInput type="password" value={form.secrets[key]||''} autoComplete="off" onChange={event=>setForm({...form,secrets:{...form.secrets,[key]:event.target.value}})}/></label>)}</div>}
   <label className="nubi-mcp-enabled"><input type="checkbox" checked={form.enabled} onChange={event=>setForm({...form,enabled:event.target.checked})}/>앱을 시작하면 자동으로 연결</label>
   <div className="nubi-mcp-form-actions"><WorkspaceAction action="cancel" label="취소" visibleLabel onClick={()=>setForm(null)}/><CxButton type="submit" variant="primary" disabled={busy}><Icon name="save" size={16}/><span>저장</span></CxButton></div>
  </form>:<div className="nubi-mcp-add"><CxButton variant="primary" disabled={busy} onClick={()=>edit(null)}><Icon name="plus" size={16}/><span>MCP 서버 추가</span></CxButton></div>}
 </div>;
}
