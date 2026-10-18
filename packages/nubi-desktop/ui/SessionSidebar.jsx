import {WorkspaceActionMenu} from './WorkspaceActionMenu.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {ProjectFileTree} from './ProjectFileTree.jsx';
import {DriftLabel} from './DriftLabel.jsx';
import {CxButton, CxInput, DetailPanel, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {sessionSidebarGroups} from './session-navigation.mjs';
import {WorkspaceBrand} from './WorkspaceBrand.jsx';
import {ArchiveMark, FolderMark, FolderOpenMark, RecoveryStatus} from './marks.jsx';

const taskState = {running:'진행 중', stopping:'중지 중', waiting_input:'답변 대기', paused:'복구 대기', failed:'확인 필요'};
// One conversation list by date, as in the browser agent's history (user decision 2026-09-30): the current conversation
// is the soft blue row, and deleting is the trash icon with a confirmation. A running conversation has no trash.
export function SessionSidebar({conversationTools=true,projects=[],onSwitchProject,onRenameProject,onRemoveProject,brand = false, compactAt = 900, compact, project, wikiJob, selected, open, disabled, onToggle, onChooseProject, onSearch, onNew, onSelect, onDelete, onUsage, onExport, onArchive, onPinsChange, onCopyProjectPath, filesMode=false, activeFile, onOpenFile}) {
  const [editingProject,setEditingProject]=useState(null),[projectName,setProjectName]=useState(''),[removingProject,setRemovingProject]=useState(null),[projectBusy,setProjectBusy]=useState(false);
  const [removing, setRemoving] = useState(null), [deleting, setDeleting] = useState(false), [expanded, setExpanded] = useState(true), [showAll, setShowAll] = useState(false), [pinned, setPinned] = useState([]), [archived, setArchived] = useState(false), [pinBusy,setPinBusy]=useState(false);
  const sidebar=useRef(null),pinFocus=useRef(null);
  useLayoutEffect(()=>{const id=pinFocus.current;if(!id)return;pinFocus.current=null;[...sidebar.current.querySelectorAll('.nubi-session-row')].find(node=>node.dataset.sessionId===id)?.querySelector('summary')?.focus();},[pinned,project?.conversationNavigation?.pinnedIds]);
  const fileItems = useMemo(() => (project?.files || []).map(path => ({path})), [project?.files]);
  // The left navigation rail owns the sidebar toggle. Over a narrow window the
  // sidebar covers the rail, so the scrim and Escape close it there.
  useEffect(() => {
    if (!open) return;
    const close = event => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"], [role="alertdialog"]')) {event.preventDefault();event.stopPropagation();onToggle();} };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open, onToggle, compactAt, compact]);
  useEffect(() => { if (!project?.projectId) return; setExpanded(true); setShowAll(false); setArchived(false); try { const saved=JSON.parse(localStorage.getItem(`nubi-pinned-tasks:${project.projectId}`)); setPinned(Array.isArray(saved)?[...new Set(saved.filter(id=>typeof id==='string'))]:[]); } catch { setPinned([]); } }, [project?.projectId]);

  if (!project) return null;
  async function remove() {
    if (!removing || deleting) return;
    setDeleting(true);
    try { if (await onDelete(removing.id)) setRemoving(null); }
    finally { setDeleting(false); }
  }
  const orderedPins=conversationTools?(project.conversationNavigation?.pinnedIds??pinned):pinned;
  const tasks=conversationTools?(project.conversationNavigation?.tasks??project.tasks):project.tasks;
  const togglePin = async id => {
    if(pinBusy)return;const next=orderedPins.includes(id)?orderedPins.filter(item=>item!==id):[id,...orderedPins];
    setPinBusy(true);pinFocus.current=id;
    try {if(onPinsChange&&!await onPinsChange(next)){pinFocus.current=null;return;}setPinned(next);if(!onPinsChange){try{localStorage.setItem(`nubi-pinned-tasks:${project.projectId}`,JSON.stringify(next));}catch{}}}
    finally{setPinBusy(false);}
  };
  const {groups,hiddenCount:hiddenTaskCount,canCollapse}=sessionSidebarGroups(tasks,orderedPins,{showAll,archived});
  const archiveCount=tasks.filter(task=>task.archivedAt).length;

  const rootParts = String(project.root || '').split(/[\\/]/).filter(Boolean);
  const folderName = rootParts.at(-1) || project.name;
  const copyRoot = () => onCopyProjectPath?.({projectId:project.projectId, taskId:selected || undefined});
  const projectRows=projects.some(entry=>entry.id===project.projectId)?projects:[{id:project.projectId,name:project.kind==='conversation'?'개인 대화':folderName,root:project.root,kind:project.kind},...projects];
  const activeContents=<>{filesMode&&onOpenFile&&<ProjectFileTree key={project.projectId} items={fileItems} selected={activeFile} onSelect={item=>onOpenFile(item.path)} disabled={disabled}/>}<div className="nubi-sidebar-actions"><CxButton className="nubi-sidebar-new" aria-current={selected === null ? 'page' : undefined} disabled={disabled} onClick={onNew}><Icon name="plus" size={18}/>새 대화</CxButton></div>
      {onArchive&&<CxButton className="nubi-sidebar-more" aria-pressed={archived} onClick={()=>{setArchived(value=>!value);setShowAll(false);}}><ArchiveMark size={16}/>{archived?'대화로 돌아가기':`보관함 ${archiveCount}`}</CxButton>}
      {archived&&groups.length===0&&<p className="nubi-muted">보관한 대화가 없어요.</p>}
      {groups.length > 0 && <nav className="nubi-sidebar-history" aria-label="대화 목록">{groups.map(group => <section key={group.key} aria-label={`${group.label} 대화`}><h3>{group.label}</h3>
        {group.tasks.map(task => { const running = ['running', 'stopping'].includes(task.state); const complete = ['review', 'completed'].includes(task.state); const archiveBusy=['running','stopping','waiting_input','paused','interrupted','failed','ready'].includes(task.state); return <div className="nubi-session-row" key={task.id} data-session-id={task.id} data-current={selected === task.id} data-state={task.state} data-pinned={orderedPins.includes(task.id)}>
          <CxButton className="nubi-session-select" aria-current={selected === task.id ? 'page' : undefined} title={orderedPins.includes(task.id)?`고정된 대화: ${task.request}`:task.request} aria-description={orderedPins.includes(task.id)?'고정된 대화':undefined} disabled={disabled} onClick={() => onSelect(task.id)}><Icon name={orderedPins.includes(task.id)?"pin":"message"} size={16}/><DriftLabel className="nubi-session-title">{task.request}</DriftLabel>{task.origin?.kind==='side_task'&&<small className="nubi-session-origin" title="에이전트 제안으로 시작한 대화" aria-label="에이전트 제안으로 시작한 대화">제안</small>}{running ? <span className="nubi-session-progress" role="status" aria-label="진행 중"><span className="status-spinner"/></span> : task.state==='paused' ? <RecoveryStatus/> : !complete && taskState[task.state] && <small>{taskState[task.state]}</small>}</CxButton>
          <div className="nubi-session-actions">{conversationTools&&task.unread && <span className="nubi-session-complete" role="status" aria-label="읽지 않음" title="읽지 않음"/>}<WorkspaceActionMenu inline label={`${task.request} 관리`}><CxButton className="nubi-session-action" aria-label={orderedPins.includes(task.id) ? `${task.request} 고정 해제` : `${task.request} 고정`} title={orderedPins.includes(task.id) ? '고정 해제' : '고정'} aria-pressed={orderedPins.includes(task.id)} disabled={disabled||pinBusy||!!onPinsChange&&project.conversationNavigation?.pinnedIds===null} onClick={event => { event.stopPropagation(); void togglePin(task.id); }}><Icon name="pin" size={18}/></CxButton>{onArchive&&<CxButton className="nubi-session-action" aria-label={`${task.request} ${task.archivedAt?'보관 해제':'보관'}`} title={task.archivedAt?'보관 해제':'보관'} disabled={disabled||!task.archivedAt&&(archiveBusy||orderedPins.includes(task.id))} onClick={()=>onArchive(task.id,!task.archivedAt)}><ArchiveMark size={18}/></CxButton>}{onUsage&&<CxButton className="nubi-session-action" aria-label={`${task.request} 사용량`} title="이 대화의 사용량" disabled={disabled} onClick={()=>onUsage(task.id)}><Icon name="chartColumn" size={18}/></CxButton>}{onExport&&<CxButton className="nubi-session-action" aria-label={`${task.request} Markdown으로 내보내기`} title="Markdown으로 내보내기" disabled={disabled} onClick={()=>onExport(task.id)}><Icon name="download" size={18}/></CxButton>}{!running && <ActionButton action="delete" iconOnly label={`${task.request} 삭제`} title="삭제" disabled={disabled} onClick={event => { event.stopPropagation(); setRemoving(task); }}/>}</WorkspaceActionMenu></div>
        </div>})}
      </section>)}{hiddenTaskCount > 0 && <CxButton className="nubi-sidebar-more" onClick={() => setShowAll(true)}><Icon name="chevronDown" size={16}/>대화 {hiddenTaskCount}개 더보기</CxButton>}{canCollapse && <CxButton className="nubi-sidebar-more" onClick={() => setShowAll(false)}><Icon name="chevronUp" size={16}/>접기</CxButton>}</nav>}</>;
  async function manageProject(operation,close){setProjectBusy(true);try{const result=await operation();if(result)close();}finally{setProjectBusy(false);}}
  return <>
    {open&&<div className="nubi-sidebar-scrim" aria-hidden="true" onClick={onToggle}/>}
    <aside ref={sidebar} className="nubi-sidebar" aria-label="프로젝트 대화" data-open={open}>
      {brand&&<div className="nubi-sidebar-brand"><WorkspaceBrand/><CxButton className="nubi-sidebar-toggle" data-open={open} aria-label={open?'사이드바 접기':'사이드바 펼치기'} title={open?'사이드바 접기':'사이드바 펼치기'} aria-expanded={open} onClick={onToggle}><Icon name={open?'panelLeftClose':'panelLeft'} size={18}/></CxButton></div>}
      <div className="nubi-sidebar-body" hidden={!open}>
        <div className="nubi-sidebar-actions nubi-sidebar-quick-actions">{project.root&&<CopyButton label="프로젝트 경로 복사" disabled={disabled} resetKey={project.root} onCopy={copyRoot}/>}<CxButton className="nubi-sidebar-folder-picker" aria-label="프로젝트 추가" title="프로젝트 추가" disabled={disabled} onClick={onChooseProject}><Icon name="plus" size={18}/><span>프로젝트</span></CxButton>{onSearch&&<CxButton className="nubi-sidebar-search" aria-label="대화 검색" title="대화 검색" disabled={disabled} onClick={onSearch}><Icon name="search" size={18}/><span>검색</span></CxButton>}</div>
        {projectRows.map(entry=>{const current=entry.id===project.projectId,background=project.backgroundProjects?.find(row=>row.projectId===entry.id),wiki=current?wikiJob||project.wikiChatJob:background?.wikiChatJob,wikiRunning=wiki?.state==='running';return <section className="nubi-saved-project" key={entry.id} data-current={current}>
          <div className="nubi-sidebar-project-row"><CxButton className="nubi-sidebar-project" aria-expanded={current&&expanded} aria-label={`${entry.name} 대화 ${current&&expanded?'접기':'펼치기'}`} title={entry.root} disabled={disabled||projectBusy} onClick={()=>current?setExpanded(value=>!value):onSwitchProject?.(entry.id)}>
            {current&&expanded?<FolderOpenMark size={18}/>:<FolderMark size={18}/>}<DriftLabel className="nubi-sidebar-project-name">{entry.name}</DriftLabel>{wikiRunning?<span className="nubi-project-wiki-state" role="status" aria-label={`${entry.name} 위키 ${wiki.kind==='update'?'갱신':'작성'} 중`} title={`${entry.name} 위키 ${wiki.kind==='update'?'갱신':'작성'} 중${Number.isFinite(wiki.percent)?` (${wiki.percent}%)`:''}`}><span className="status-spinner" aria-hidden="true"/>{wiki.kind==='update'?'위키 갱신':'위키 작성'}</span>:background?.running?<span className="nubi-session-progress" role="status" aria-label="진행 중" title="이 프로젝트에서 진행 중"><span className="status-spinner"/></span>:background?.waitingInput?<span className="nubi-session-progress" role="status" aria-label="확인 필요" title="이 프로젝트에 확인할 질문이 있어요"><Icon name="infoCircle" size={16}/></span>:null}<Icon name="chevronDown" size={16}/>
          </CxButton>{entry.kind!=='conversation'&&onRenameProject&&<WorkspaceActionMenu inline label={`${entry.name} 프로젝트 관리`}>
            <CxButton className="nubi-session-action" aria-label={`${entry.name} 이름 변경`} title="이름 변경" disabled={disabled||projectBusy} onClick={()=>{setProjectName(entry.name);setEditingProject(entry);}}><Icon name="pencil" size={18}/></CxButton>
            <CxButton className="nubi-session-action" aria-label={`${entry.name} 목록에서 제거`} title="목록에서 제거" disabled={disabled||projectBusy||wikiRunning||background?.running||background?.waitingInput} onClick={()=>setRemovingProject(entry)}><Icon name="xClose" size={18}/></CxButton>
          </WorkspaceActionMenu>}</div>{current&&expanded&&activeContents}
        </section>;})}
      </div>
    </aside>
    {editingProject&&<DetailPanel className="deck-dialog nubi-project-name-dialog" title="프로젝트 이름" variant="modal" busy={projectBusy} onClose={()=>{if(!projectBusy)setEditingProject(null);}} footer={<CxButton variant="primary" disabled={projectBusy||!projectName.trim()} onClick={()=>manageProject(()=>onRenameProject(editingProject.id,projectName),()=>setEditingProject(null))}><Icon name="check" size={16}/>저장</CxButton>}>
      <form onSubmit={event=>{event.preventDefault();if(!projectBusy&&projectName.trim())void manageProject(()=>onRenameProject(editingProject.id,projectName),()=>setEditingProject(null));}}><label htmlFor="nubi-project-name">이름</label><CxInput id="nubi-project-name" value={projectName} maxLength={80} autoFocus disabled={projectBusy} onChange={event=>setProjectName(event.target.value)}/></form>
    </DetailPanel>}
    {removingProject&&<DeckConfirmation title="목록에서 제거할까요?" message={<><strong className="nubi-delete-title" title={removingProject.name}>{removingProject.name}</strong><span className="nubi-project-remove-note">파일과 대화는 그대로 남아요.</span></>} confirmLabel="목록에서 제거" confirmIcon="xClose" showActionLabels busy={projectBusy} onCancel={()=>{if(!projectBusy)setRemovingProject(null);}} onConfirm={()=>manageProject(()=>onRemoveProject(removingProject.id),()=>setRemovingProject(null))}/>}
    {removing && <DeckConfirmation className="nubi-delete-conversation" title="대화를 삭제할까요?" message={<><strong className="nubi-delete-title" title={removing.request}>{removing.request.replace(/\\r\\n|\\n/g, ' ')}</strong><span className="nubi-delete-scope">대화와 작업 기록이 삭제돼요.</span><span className="nubi-deletion-note"><Icon name="infoCircle" size={16} aria-hidden="true"/><span>프로젝트에 반영한 파일은 그대로 남아요.</span></span></>} confirmLabel="삭제" confirmIcon="trash" showActionLabels busy={deleting} onCancel={() => { if (!deleting) setRemoving(null); }} onConfirm={remove}/>}
  </>;
}
