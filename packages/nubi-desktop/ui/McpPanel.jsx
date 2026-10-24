import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {TerminalMark,BrowserMark,FolderMark} from './marks.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {LoadingNote} from './LoadingNote.jsx';
import './mcp-panel.css';
import {idFor,parseMcpConfig} from './mcp-config.mjs';

// MCP servers (user request 2026-10-14): the list with state and tools, and one form that reads top to bottom:
// how to connect, what to run or where, then secret values as name/value rows. The id is derived from the name.
// The form has a single primary action (user feedback 2026-10-14: no stray cancel icon beside save).
const errors={mcp_server_invalid:'입력을 확인해 주세요. 이름과 명령(또는 http/https 주소)이 필요해요.',mcp_server_limit:'MCP 서버는 16개까지 등록할 수 있어요.',mcp_server_missing:'서버를 찾지 못했어요.',secret_unavailable:'이 PC에서는 비밀값을 안전하게 보관할 수 없어요.',mcp_connect_failed:'서버에 연결하지 못했어요. 명령 또는 주소와 로그를 확인해 주세요.',mcp_connect_timeout:'서버가 제때 응답하지 않았어요.'};
const splitArgs=value=>{const out=[];const re=/"([^"]*)"|'([^']*)'|(\S+)/g;let match;while((match=re.exec(String(value||''))))out.push(match[1]??match[2]??match[3]);return out;};
const quote=item=>/\s/.test(item)?`"${item}"`:item;
const blank=transport=>({id:'',name:'',transport,commandLine:'',cwd:'',url:'',entries:[],enabled:true,existing:false});
const toForm=server=>({id:server.id,name:server.name||server.id,transport:server.transport,commandLine:server.transport==='stdio'?[server.command,...(server.args||[])].map(quote).join(' '):'',cwd:server.cwd||'',url:server.url||'',entries:(server.transport==='stdio'?server.envKeys:server.headerKeys)?.map(key=>({key,value:''}))||[],enabled:server.enabled!==false,existing:true});
export function McpPanel({api}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[form,setForm]=useState(null),[pasting,setPasting]=useState(false),[pasted,setPasted]=useState(''),live=useRef(true);
 const load=async()=>{try{const value=await api('mcp',{action:'list'});if(live.current)setData(value.servers||[]);}catch{if(live.current)notifyWorkspaceToast('MCP 서버 목록을 읽지 못했어요.',{error:true});}};
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[api]);
 const act=async(args,done)=>{if(busy)return;setBusy(true);try{const value=await api('mcp',args);if(live.current){await load();done?.(value);}}catch(error){if(live.current)notifyWorkspaceToast(errors[error.message]||`MCP 서버 작업을 마치지 못했어요. (${error.message})`,{error:true});}finally{if(live.current)setBusy(false);}};
 const update=patch=>setForm(current=>({...current,...patch}));
 const setEntry=(index,patch)=>update({entries:form.entries.map((row,i)=>i===index?{...row,...patch}:row)});
 const submit=event=>{
  event.preventDefault();if(!form)return;
  const id=form.existing?form.id:idFor(form.name);
  if(!id){notifyWorkspaceToast('이름에 영문이나 숫자를 넣어 주세요. 아이디는 이름에서 만들어져요.',{error:true});return;}
  const keys=form.entries.map(row=>row.key.trim()).filter(Boolean);
  const secrets=Object.fromEntries(form.entries.filter(row=>row.key.trim()&&row.value).map(row=>[row.key.trim(),row.value]));
  const tokens=splitArgs(form.commandLine);
  const server=form.transport==='stdio'?{id,name:form.name.trim(),transport:'stdio',command:tokens[0]||'',args:tokens.slice(1),cwd:form.cwd.trim()||null,envKeys:keys,enabled:form.enabled,...(Object.keys(secrets).length?{secrets}:{})}:{id,name:form.name.trim(),transport:'http',url:form.url.trim(),headerKeys:keys,enabled:form.enabled,...(Object.keys(secrets).length?{secrets}:{})};
  void act({action:'save',server},async()=>{setForm(null);try{const connected=await api('mcp',{action:'connect',id});await load();notifyWorkspaceToast(`MCP 서버에 연결했어요. 도구 ${connected?.tools?.length||0}개`,{success:true});}catch(error){await load();notifyWorkspaceToast(`저장했지만 연결하지 못했어요. ${errors[error.message]||error.message}`,{error:true});}});
 };
 const importJson=async()=>{
  let parsed;try{parsed=JSON.parse(pasted);}catch{notifyWorkspaceToast('JSON 형식이 아니에요. 다른 앱의 MCP 설정을 그대로 붙여 넣어 주세요.',{error:true});return;}
  const servers=parseMcpConfig(parsed);
  if(!servers.length){notifyWorkspaceToast('mcpServers 안에 서버가 없어요.',{error:true});return;}
  setBusy(true);const done=[],failed=[];
  try{for(const server of servers){try{await api('mcp',{action:'save',server});try{const connected=await api('mcp',{action:'connect',id:server.id});done.push(`${server.name} 도구 ${connected?.tools?.length||0}개`);}catch(error){failed.push(`${server.name}: ${errors[error.message]||error.message}`);}}catch(error){failed.push(`${server.name}: ${errors[error.message]||error.message}`);}}}
  finally{setBusy(false);}
  await load();setPasting(false);setPasted('');
  if(done.length)notifyWorkspaceToast(`연결했어요. ${done.join(', ')}`,{success:true});
  if(failed.length)notifyWorkspaceToast(`연결하지 못한 서버: ${failed.join(' / ')}`,{error:true});
 };
 if(!data)return <LoadingNote>MCP 서버를 불러오는 중</LoadingNote>;
 if(pasting)return <div className="nubi-mcp-form" aria-label="MCP 설정 붙여넣기">
  <header className="nubi-mcp-form-head"><WorkspaceAction action="back" label="목록으로 돌아가기" onClick={()=>{setPasting(false);setPasted('');}}/><h3>설정 붙여넣기</h3></header>
  <p className="nubi-muted">Claude, Cursor, VS Code 같은 앱의 MCP 설정 JSON을 그대로 붙여 넣으면 서버를 모두 추가하고 바로 연결해요. 환경 변수와 헤더 값은 이 PC의 보관소에만 저장돼요.</p>
  <textarea className="nubi-mcp-paste" aria-label="MCP 설정 JSON" spellCheck={false} value={pasted} onChange={event=>setPasted(event.target.value)} placeholder={'{\n  "mcpServers": {\n    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "…" } },\n    "company": { "url": "https://mcp.company.local/mcp", "headers": { "Authorization": "Bearer …" } }\n  }\n}'}/>
  <div className="nubi-mcp-form-actions"><CxButton variant="primary" disabled={busy||!pasted.trim()} onClick={()=>void importJson()}><Icon name="plus" size={16}/><span>추가하고 연결</span></CxButton></div>
 </div>;
 if(form){
  const stdio=form.transport==='stdio',derived=idFor(form.name);
  return <form className="nubi-mcp-form" onSubmit={submit} aria-label={form.existing?'MCP 서버 편집':'MCP 서버 등록'}>
   <header className="nubi-mcp-form-head"><WorkspaceAction action="back" label="목록으로 돌아가기" onClick={()=>setForm(null)}/><h3>{form.existing?'서버 편집':'새 MCP 서버'}</h3></header>
   <div className="nubi-mcp-field"><label htmlFor="nubi-mcp-name">이름</label><CxInput id="nubi-mcp-name" value={form.name} onChange={event=>update({name:event.target.value})} placeholder="예: 사내 GHES 도구" autoFocus required/><small>{form.existing?`아이디 ${form.id}`:derived?`아이디 ${derived}`:'아이디는 이름에서 만들어져요.'}</small></div>
   <div className="nubi-mcp-field"><span className="nubi-mcp-label">연결 방식</span>
    <div className="nubi-mcp-choice" role="radiogroup" aria-label="연결 방식">
     <button type="button" role="radio" aria-checked={stdio} data-selected={stdio||undefined} disabled={form.existing} onClick={()=>update({transport:'stdio'})}><TerminalMark size={20}/><span><strong>명령 실행</strong><small>이 PC에서 명령을 띄워 연결 (stdio)</small></span></button>
     <button type="button" role="radio" aria-checked={!stdio} data-selected={!stdio||undefined} disabled={form.existing} onClick={()=>update({transport:'http'})}><BrowserMark size={20}/><span><strong>서버 주소</strong><small>사내 서버의 MCP 주소로 연결 (HTTP)</small></span></button>
    </div></div>
   {stdio?<>
    <div className="nubi-mcp-field"><label htmlFor="nubi-mcp-command">명령</label><CxInput id="nubi-mcp-command" className="nubi-mcp-mono" value={form.commandLine} onChange={event=>update({commandLine:event.target.value})} placeholder="npx -y @scope/mcp-server --flag" required/><small>터미널에 치듯 한 줄로 적어요. 공백이 든 경로는 따옴표로 묶어요.</small></div>

   </>:<div className="nubi-mcp-field"><label htmlFor="nubi-mcp-url">주소</label><CxInput id="nubi-mcp-url" className="nubi-mcp-mono" value={form.url} onChange={event=>update({url:event.target.value})} placeholder="https://mcp.company.local/mcp" required/></div>}
   <DeckDisclosure key={`${form.id}:${form.transport}`} title={stdio?'작업 폴더와 환경 변수':'인증 헤더'} icon="sliders">
    {stdio&&<div className="nubi-mcp-field"><label htmlFor="nubi-mcp-cwd">작업 폴더 <em>선택</em></label><div className="nubi-mcp-inline"><CxInput id="nubi-mcp-cwd" className="nubi-mcp-mono" value={form.cwd} onChange={event=>update({cwd:event.target.value})} placeholder="비우면 기본 폴더"/><CxButton type="button" onClick={async()=>{try{const value=await api('chooseMcpFolder');if(value?.path)update({cwd:value.path});}catch{notifyWorkspaceToast('폴더를 고르지 못했어요.',{error:true});}}}><FolderMark size={16}/><span>폴더 선택</span></CxButton></div></div>}
   <div className="nubi-mcp-field">
    <span className="nubi-mcp-label">{stdio?'환경 변수':'헤더'} <em>선택</em></span>
    <small>{stdio?'토큰 같은 값은 환경 변수로 넘겨요.':'인증 토큰은 헤더로 넘겨요 (예: Authorization).'} 값은 이 PC의 보관소에만 저장되고 다시 보여 주지 않아요. 편집할 때 비워 두면 기존 값을 유지해요.</small>
    {form.entries.length>0&&<ul className="nubi-mcp-entries">
     {form.entries.map((row,index)=><li key={index}>
      <CxInput aria-label={stdio?'환경 변수 이름':'헤더 이름'} className="nubi-mcp-mono" value={row.key} onChange={event=>setEntry(index,{key:stdio?event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'_'):event.target.value})} placeholder={stdio?'API_TOKEN':'Authorization'}/>
      <CxInput aria-label="값" type="password" autoComplete="off" value={row.value} onChange={event=>setEntry(index,{value:event.target.value})} placeholder={stdio?'값':'Bearer …'}/>
      <WorkspaceAction action="delete" label={`${row.key||'항목'} 삭제`} onClick={()=>update({entries:form.entries.filter((_,i)=>i!==index)})}/>
     </li>)}
    </ul>}
    <CxButton type="button" className="nubi-mcp-add-entry" onClick={()=>update({entries:[...form.entries,{key:'',value:''}]})}><Icon name="plus" size={16}/><span>{stdio?'환경 변수 추가':'헤더 추가'}</span></CxButton>
   </div>
   </DeckDisclosure>
   <div className="nubi-mail-switch-row nubi-mcp-switch"><div><strong>자동 연결</strong><small>앱을 켜면 이 서버에 바로 연결해요.</small></div><button type="button" role="switch" aria-label="자동 연결" aria-checked={form.enabled} className="nubi-ios-switch" onClick={()=>update({enabled:!form.enabled})}><span aria-hidden="true"/></button></div>
   <div className="nubi-mcp-form-actions"><CxButton type="submit" variant="primary" disabled={busy}><Icon name="save" size={16}/><span>저장</span></CxButton></div>
  </form>;
 }
 return <div className="nubi-mcp-panel">
  <p className="nubi-muted">MCP 서버의 도구를 에이전트가 쓸 수 있어요. 읽기 전용 도구는 바로 실행하고, 그 밖의 도구는 실행 전에 물어봐요.</p>
  {data.length===0&&<p className="nubi-mcp-empty"><Icon name="infoCircle" size={16}/><span>등록한 MCP 서버가 없어요.</span></p>}
  <ul className="nubi-mcp-list">
   {data.map(server=><li key={server.id} className="nubi-mcp-item" data-state={server.state}>
    <div className="nubi-mcp-head">
     <span className="nubi-mcp-kind" aria-hidden="true">{server.transport==='stdio'?<TerminalMark size={18}/>:<BrowserMark size={18}/>}</span>
     <div className="nubi-mcp-title"><strong>{server.name||server.id}</strong><small>{server.transport==='builtin'?`인앱 웹 탭 / ${server.version}`:server.transport==='stdio'?[server.command,...(server.args||[])].join(' '):server.url}</small></div>
     <span className="nubi-mcp-state" data-state={server.state}><Icon name={server.state==='connected'?'check':server.state==='failed'?'alertCircle':server.state==='connecting'?'refresh':'minus'} size={14}/><span>{server.state==='connected'?`도구 ${server.tools.length}개`:server.state==='failed'?(errors[server.error]||'연결 실패'):server.state==='connecting'?'연결 중':server.enabled?'연결 안 됨':'자동 연결 끔'}</span></span>
     <span className="nubi-mcp-actions">
      {server.state!=='connected'&&<WorkspaceAction action="login" label="연결" disabled={busy} onClick={()=>act({action:'connect',id:server.id},()=>notifyWorkspaceToast('MCP 서버에 연결했어요.',{success:true}))}/>}
      {server.transport!=='builtin'&&<WorkspaceAction action="edit" label="편집" disabled={busy} onClick={()=>setForm(toForm(server))}/>}
      {(server.transport!=='builtin'||server.enabled!==false)&&<WorkspaceAction action="delete" label="MCP 제거" disabled={busy} onClick={()=>act({action:'remove',id:server.id},()=>notifyWorkspaceToast('MCP 서버를 제거했어요.'))}/>}
     </span>
    </div>
    {server.tools.length>0&&<details className="nubi-mcp-toolbox"><summary><Icon name="layers" size={14}/><span>도구 {server.tools.length}개</span><small>읽기 전용은 바로 실행, 그 밖에는 실행 전에 물어봐요</small><Icon name="chevronDown" size={14}/></summary>
     <ul className="nubi-mcp-tool-list">{server.tools.map(tool=><li key={tool.name}>
      <div className="nubi-mcp-tool-head"><span className="nubi-mcp-tool-kind" data-read={tool.readOnly||undefined} title={tool.readOnly?'읽기 전용':'실행 전 확인'}><Icon name={tool.readOnly?'eye':'pencil'} size={14}/></span><code>{tool.name}</code>{tool.title&&<span className="nubi-mcp-tool-title">{tool.title}</span>}</div>
      {tool.description&&<p className="nubi-mcp-tool-desc" title={tool.description}>{tool.description}</p>}
      {tool.params?.length>0&&<ul className="nubi-mcp-params" aria-label={`${tool.name} 입력값`}>{tool.params.map(param=><li key={param.name} title={param.description||undefined}><code>{param.name}</code>{param.type&&<small>{param.type}</small>}{param.required&&<em>필수</em>}</li>)}</ul>}
     </li>)}</ul></details>}
    {server.state==='failed'&&<p className="nubi-mcp-error"><Icon name="alertCircle" size={14}/><span>{errors[server.error]||'연결하지 못했어요.'} 명령이나 주소, 환경 변수를 확인한 뒤 연결 버튼을 다시 눌러 주세요.</span></p>}
   </li>)}
  </ul>
  <div className="nubi-mcp-add"><CxButton disabled={busy} onClick={()=>setPasting(true)}><Icon name="clipboardCheck" size={16}/><span>설정 붙여넣기</span></CxButton><CxButton variant="primary" disabled={busy} onClick={()=>setForm(blank('stdio'))}><Icon name="plus" size={16}/><span>MCP 서버 추가</span></CxButton></div>
 </div>;
}
