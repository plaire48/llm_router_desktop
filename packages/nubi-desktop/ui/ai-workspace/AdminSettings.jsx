import React, {useEffect, useMemo, useRef, useState} from 'react';
import {TeamAssignment} from './TeamAssignment.jsx';
import {refreshTeamHistory,mergeTeamHistory} from './teamHistoryRefresh.js';
import {SearchField} from './SearchField';
import {createAdminClient, GHES_TEAMS_URL, E2E_ROLES} from './adminClient';
import {GithubAvatar} from './AccountProfile';
import {githubIdentityLabel} from './githubIdentity';
import {ActionButton} from './ActionButton';
import {GithubRequestError} from './GithubRequestError';
import {HelpButton} from './HelpButton';
import {Icon} from './Icon';
import {ColumnVisibilityMenu} from './ColumnVisibilityMenu';
import {ActiveColumnFilters, ControlledTable, PageSizeSelect, TableControlsContext, TablePagination, useColumnControls, usePagination} from './TableControls';
import {SelectionCheckbox, SortHeader, useRowSelection} from './WorkspaceLayout';
import {downloadReportCsv, sortReportRows} from './reportInteractions';
import {useFeedback} from './Toast';
import {TableViewport, useWorkspaceState} from './WorkspaceMemory';
import './admin-settings.css';
import './column-pinning.css';

const memberRoleLabel=user=>user.permissionIssue?'권한 확인 필요':E2E_ROLES.find(role=>role.key===user.role)?.label||'권한 확인 필요';
const dateLabel=value=>value?new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'';
const columns=[
  {key:'name',label:'이름',group:'identity',width:200,value:user=>String(user.name||'').trim()},
  {key:'login',label:'아이디',group:'identity',width:200,value:user=>user.login||''},
  {key:'role',label:'권한',group:'identity',width:180,value:memberRoleLabel},
  {key:'email',label:'이메일',group:'identity',width:260,value:user=>user.email||''},
  {key:'changedAt',label:'최근 팀 변경일',group:'audit',width:180,value:user=>dateLabel(user.teamChange?.date)},
  {key:'changedBy',label:'변경자',group:'audit',width:240,value:user=>user.teamChange?.actor?githubIdentityLabel(user.teamChange.actor):''},
];
const columnGroups=[['identity','사용자'],['audit','최근 팀 변경']];
const primaryKeys=['name','login','role'];
const emptyHistory={items:[],loading:false,note:''};
const auditPermissionNote='팀 변경 기록은 조직 Owner와 GitHub App의 조직 Administration 읽기 권한이 필요합니다.';
function Identity({user,nameOnly=false}) {
  return <span className="admin-identity"><GithubAvatar user={user} size="sm"/><span className="admin-person-name">{nameOnly?String(user.name||'').trim()||'—':githubIdentityLabel(user)}</span></span>;
}

export function AdminSettings({user, onPendingChange, client:providedClient, focusLogin}) {
  const client=useMemo(()=>providedClient||createAdminClient(),[providedClient,user?.login]);
  const [rows,setRows]=useState([]),[query,setQuery]=useState(focusLogin||'');
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[revision,setRevision]=useState(0);
  const [history,setHistory]=useState(emptyHistory);
  const [confirmedHistory,setConfirmedHistory]=useState([]);
  const recheckAudit=useRef(false),expectedHistory=useRef(null);
  const [teamTarget,setTeamTarget]=useState(null),[teamBusy,setTeamBusy]=useState(false);
  const [sort,setSort]=useWorkspaceState('admin-users.sort',{key:'',direction:'asc'});
  const [pinCount,setPinCount]=useWorkspaceState('admin-users.pinCount',0),[pinLimit,setPinLimit]=useState(Infinity);
  const [hiddenColumns,setHiddenColumns]=useWorkspaceState('admin-users.hiddenColumns',[]);
  const requestedHidden=hiddenColumns.filter(key=>columns.some(column=>column.key===key));
  const hidden=requestedHidden.length<columns.length?requestedHidden:requestedHidden.filter(key=>key!=='name');
  const fields=columns.filter(column=>!hidden.includes(column.key));
  const [,notify]=useFeedback();
  const pending=useRef(onPendingChange);pending.current=onPendingChange;
  useEffect(()=>{pending.current?.({dirty:false,saving:teamBusy});return()=>pending.current?.({dirty:false,saving:false});},[teamBusy]);
  useEffect(()=>{
    let current=true;const controller=new AbortController(),refresh=recheckAudit.current,expected=expectedHistory.current;
    recheckAudit.current=false;
    setLoading(true);setLoadError('');setHistory({...emptyHistory,loading:true});
    (async()=>{
      let users;
      try {users=await client.members();if(!current)return;setRows(users);setLoading(false);}
      catch(error){if(current){setLoadError(error);setLoading(false);setHistory(emptyHistory);}return;}
      if(!users.length){setHistory(emptyHistory);return;}
      try {
        if(!client.memberHistory)throw Error('조회 불가');
        const result=await refreshTeamHistory(client.memberHistory,users,{refresh,expected,signal:controller.signal});
        if(current){
          if(!result.waiting&&result.available!==false&&expectedHistory.current===expected)expectedHistory.current=null;
          const note=[
            result.receiptUnavailable?'권한 알림 기록을 불러오지 못했습니다.':result.available===false?(result.items.length?'권한 변경 알림에 기록된 팀 변경을 표시합니다.':auditPermissionNote):'',
            result.waiting?'팀 변경 기록을 확인 중입니다. 잠시 후 새로고침하세요.':'',
            result.limited?'팀 변경 기록은 최근 조회된 범위만 표시합니다.':''
          ].filter(Boolean).join(' ');
          setHistory({items:result.items,loading:false,note});
        }
      } catch(error) {
        if(current)setHistory({...emptyHistory,note:[403,404].includes(error.status)?auditPermissionNote:'팀 변경 기록을 불러오지 못했습니다. 새로고침해 다시 확인하세요.'});
      }
    })();
    return()=>{current=false;controller.abort();};
  },[client,revision]);
  useEffect(()=>{setConfirmedHistory([]);expectedHistory.current=null;},[client]);
  const enriched=useMemo(()=>{const changes=new Map(mergeTeamHistory(history.items,confirmedHistory).map(item=>[item.userId,item]));return rows.map(row=>({...row,teamChange:changes.get(row.id)}));},[rows,history.items,confirmedHistory]);
  const needle=query.trim().toLocaleLowerCase();
  const candidates=enriched.filter(row=>!needle||`${row.name||''} ${row.login} ${memberRoleLabel(row)} ${row.email||''}`.toLocaleLowerCase().includes(needle));
  const controls=useColumnControls('admin-users','members',columns.map(column=>({...column,hidden:hidden.includes(column.key)})),candidates);
  const filtered=sortReportRows(controls.rows,sort,(row,key)=>columns.find(column=>column.key===key)?.value(row));
  const pagination=usePagination('admin-users',filtered,JSON.stringify([user?.login,needle,controls.filters,sort]),{ready:!loading&&!loadError});
  const visibleRows=loading||loadError?[]:pagination.rows;
  const selection=useRowSelection(loading||loadError?[]:filtered,JSON.stringify([user?.login,needle,controls.filters,revision]));
  const selectedOnPage=visibleRows.filter(row=>selection.ids.has(row.id)).length;
  const download=selected=>{
    if(loading||loadError||history.loading)return;
    downloadReportCsv(selected?filtered.filter(row=>selection.ids.has(row.id)):filtered,columns,`E2E_사용자_${selected?'선택':'조회'}`);
  };
  const pinned=fields.slice(0,Math.min(pinCount,fields.length,pinLimit)).map(column=>column.key);
  const selectColumns=next=>{
    const nextFields=columns.filter(column=>!next.includes(column.key));
    if(!nextFields.length)return;
    let keptPinned=0;
    for(const field of nextFields){if(!pinned.includes(field.key))break;keptPinned++;}
    setHiddenColumns(next);setPinCount(keptPinned);
  };
  const togglePin=key=>{
    const index=fields.findIndex(column=>column.key===key);
    if(index>pinned.length){notify(`먼저 ${fields[pinned.length].label} 열을 고정하세요.`);return;}
    if(index===pinned.length&&index>=pinLimit){notify(`현재 화면에서는 ${pinLimit}개 열까지 고정할 수 있습니다. 더 고정하려면 창을 넓혀 주세요.`);return;}
    setPinCount(index<pinned.length?index:index+1);
    notify(index<pinned.length?`${fields[index].label}부터 오른쪽 열의 고정을 해제했습니다.`:`${fields[index].label}까지 ${index+1}개 열을 고정했습니다.`);
  };
  useEffect(()=>{
    if(loading||loadError||!focusLogin)return;
    const row=[...document.querySelectorAll('.admin-settings [data-login]')].find(node=>node.dataset.login.toLowerCase()===focusLogin.toLowerCase());
    row?.scrollIntoView({block:'nearest'});row?.querySelector('[data-action="edit"]')?.focus({preventScroll:true});
  },[loading,loadError,focusLogin]);
  const historyHint=row=>row.teamChange?`${row.teamChange.team} ${row.teamChange.action==='team.add_member'?'추가':'제외'}${row.teamChange.source==='save'?' — 앱에서 반영을 확인한 시간입니다. 권한 알림 기록을 확인 중입니다.':row.teamChange.source==='receipt'?' — 앱에서 반영을 확인한 시간입니다. GHES 권한 변경 알림에 기록되어 있습니다.':''}`:history.loading?'팀 변경 기록 확인 중':history.note||'확인된 팀 변경 기록이 없습니다.';
  const renderCell=(row,column)=>{
    if(column.key==='name')return <Identity user={row} nameOnly/>;
    if(column.key==='role')return <span className={`admin-role${row.permissionIssue?' has-issue':''}`} title={row.permissionIssue||undefined}>{memberRoleLabel(row)}</span>;
    if(column.key==='changedBy')return row.teamChange?.actor?<Identity user={row.teamChange.actor}/>:<span>—</span>;
    if(column.key==='changedAt')return row.teamChange?<time dateTime={row.teamChange.date}>{dateLabel(row.teamChange.date)}</time>:<span>—</span>;
    return <span className={`admin-directory-${column.key}`}>{column.value(row)||'—'}</span>;
  };
  return <TableControlsContext.Provider value={controls}><section className="master-settings-card admin-settings" aria-labelledby="admin-settings-title" aria-busy={loading||teamBusy}>
    <header className="list-action-header admin-action-header">
      <div className="list-heading-row"><div className="list-heading-group">
        <div className="list-heading"><Icon name="users" size={24}/><h1 id="admin-settings-title">관리자 설정</h1><HelpButton initialTopic="admin"/></div>
        <div className="list-result-meta"><dl className="list-hierarchy-counts" aria-label="조회 결과 개수"><div><dt>사용자</dt><dd className="admin-count">{loading||loadError?'—':filtered.length.toLocaleString('ko-KR')}</dd></div></dl><PageSizeSelect pagination={pagination}/></div>
      </div></div>
      <div className="list-toolbar-layout" role="group" aria-label="사용자 목록 작업">
        <div className="list-table-actions">
          {selection.ids.size>0&&<div className="list-selection-bar is-selected"><div><ActionButton action="clearSelection" label="선택 해제" onClick={selection.clear}/><strong>{selection.ids.size}건 선택</strong></div><div><ActionButton action="download" label="선택 내보내기" disabled={history.loading||teamBusy} onClick={()=>download(true)}/></div></div>}
    <div className="list-heading-actions"><div className="search-box table-toolbar-search"><SearchField label="사용자 검색" placeholder="사용자 검색" value={query} onChange={setQuery}/></div></div>
        </div>
        <div className="list-save-actions"><div className="list-utility-actions">
          <ColumnVisibilityMenu fields={columns} hidden={hidden} onChange={selectColumns} view="admin-users" groups={columnGroups} primaryKeys={primaryKeys} primaryLabel="기본 정보" disabled={loading||Boolean(loadError)||teamBusy}/>
          <ActionButton action="download" label="목록 내보내기" title="전체 조회 결과 내보내기" disabled={loading||Boolean(loadError)||history.loading||teamBusy||!filtered.length} onClick={()=>download(false)}/>
          <a className="cx-icon-button" href={GHES_TEAMS_URL} target="_blank" rel="noopener noreferrer" aria-label="GHES에서 팀 권한 관리" title="GHES에서 팀 권한 관리"><Icon name="linkExternal" size={20}/></a>
          <ActionButton action="resetWidths" label="열 너비 초기화" disabled={loading||Boolean(loadError)||!controls.hasCustomWidths} onClick={controls.resetWidths}/>
          <ActionButton action="refresh" busy={loading||history.loading} disabled={teamBusy} onClick={()=>{recheckAudit.current=true;setRevision(value=>value+1);}}/>
        </div></div>
      </div>
      <ActiveColumnFilters controls={controls}/>
      {history.note&&<p className="admin-history-note" role="status">{history.note}</p>}
    </header>
    <div className="admin-content">
      {loadError?<GithubRequestError error={loadError}/>:<>
      <TableViewport className="list-table-viewport admin-directory-viewport" memoryKey="admin-users.members.scroll" resetKey={JSON.stringify([needle,controls.filters,sort,pagination.page,pagination.size])}>
        <ControlledTable className="work-list-table admin-directory-table admin-user-table" stretchColumn="email" frozenColumns={pinned.length?['__select',...pinned]:[]} onPinLimitChange={setPinLimit} selection detail detailWidth={56}>
          <caption className="visually-hidden">사용자 목록</caption>
          <thead><tr><th scope="col" className="selection-column" data-column="__select"><SelectionCheckbox label="현재 페이지 전체 선택" checked={visibleRows.length>0&&selectedOnPage===visibleRows.length} mixed={selectedOnPage>0&&selectedOnPage<visibleRows.length} onChange={()=>selection.togglePage(visibleRows)}/></th>{fields.map(column=>loading||loadError?<th key={column.key} scope="col" data-column={column.key}>{column.label}</th>:<SortHeader key={column.key} field={column.key} label={column.label} sort={sort} onSort={setSort} pinned={pinned.includes(column.key)} onPin={togglePin} pinHint={pinned.includes(column.key)?`${column.label}부터 오른쪽 열 고정 해제`:column.key===fields[pinned.length]?.key?`${column.label} 열 고정`:`먼저 ${fields[pinned.length]?.label} 열을 고정하세요.`}/>)}<th scope="col" data-column="__detail" className="admin-edit-column list-row-actions"><ActionButton action="add" label="사용자 추가" disabled={teamBusy} onClick={()=>setTeamTarget({})}/></th></tr></thead>
          <tbody>{visibleRows.map(row=><tr key={row.login} data-login={row.login} className={selection.ids.has(row.id)?'is-selected':''} aria-selected={selection.ids.has(row.id)}>
            <td className="selection-column"><SelectionCheckbox label={`${githubIdentityLabel(row)} 선택`} checked={selection.ids.has(row.id)} onChange={()=>selection.toggle(row.id)}/></td>
            {fields.map(column=><td key={column.key} data-field={column.key} data-column-pinned={pinned.includes(column.key)||undefined} style={pinned.includes(column.key)?{left:`var(--frozen-${column.key})`}:undefined} title={column.key.startsWith('changed')?historyHint(row):column.key==='email'&&!row.email?'공개된 이메일이 없습니다.':column.value(row)}>{renderCell(row,column)}</td>)}
            <td className="admin-edit-column list-row-actions"><ActionButton action="edit" label={`${githubIdentityLabel(row)} 팀 소속 수정`} disabled={teamBusy} onClick={()=>setTeamTarget(row)}/></td>
          </tr>)}{!visibleRows.length&&<tr><td className="table-empty" colSpan={fields.length+2}><span role={loadError?'alert':'status'}>{loading?'불러오는 중…':loadError||(!rows.length?'등록된 사용자가 없습니다.':'검색 결과가 없습니다.')}</span></td></tr>}</tbody>
        </ControlledTable>
      </TableViewport>
      {!loading&&!loadError&&<TablePagination pagination={pagination} selectedCount={selection.ids.size}/>}
      </>}
    </div>
    {teamTarget&&<TeamAssignment client={client} initialUser={teamTarget.id?teamTarget:null} onClose={()=>{setTeamTarget(null);setRevision(value=>value+1);}} onSaved={(savedUser,saved)=>{
      if(saved?.teamChanges?.length)setConfirmedHistory(items=>mergeTeamHistory([], [...items,...saved.teamChanges]));
      if(saved?.changed&&!saved.pendingTeams?.length)expectedHistory.current={userId:savedUser.id,after:history.items.find(item=>item.userId===savedUser.id)?.date||null,notBefore:saved.teamChanges?.at(-1)?.startedAt};
      setRevision(value=>value+1);
    }} onBusy={setTeamBusy}/>}
  </section></TableControlsContext.Provider>;
}
