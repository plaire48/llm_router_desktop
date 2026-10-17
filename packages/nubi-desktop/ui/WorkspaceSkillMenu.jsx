import {pickerWidth} from './picker-width.mjs';
import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {FolderMark} from './marks.jsx';
import {AnchoredDialog} from './AnchoredDialog.jsx';

// Registered skills are request shortcuts, not installation or tool approval.
// Discovery and file management stay separate from choosing a skill to use.
export function WorkspaceSkillMenu({api, taskId, onMarketplace, onManage, onManageMcp, onDocuments, onOffice, onEditor, onSelect}) {
  const [open, setOpen] = useState(false), [catalog, setCatalog] = useState(null), [mcp, setMcp] = useState(null);
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  const [position, setPosition] = useState(null);
  const trigger = useRef(null), dialog = useRef(null), closeButton = useRef(null), id = useId();
  useEffect(() => { setOpen(false); setCatalog(null); }, [taskId]);
  useEffect(() => {
    if (!open || !onManageMcp) return;
    let live = true;
    Promise.resolve().then(() => api('mcp', {action:'list'})).then(value => { if (live) setMcp(Array.isArray(value?.servers) ? value.servers : []); }).catch(() => { if (live) setMcp([]); });
    return () => { live = false; };
  }, [open, api, onManageMcp]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true); setFailed(false);
    Promise.resolve().then(() => api('listSkills', {taskId})).then(value => {
      if (!Array.isArray(value?.skills)) throw Error('skills_invalid');
      if (live) setCatalog(value);
    }).catch(() => {
      if (live) {
        setCatalog(null); setFailed(true);
        notifyWorkspaceToast('스킬 목록을 불러오지 못했어요. 다시 확인해 주세요.', {error:true});
      }
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, taskId, open, revision]);
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(), menu = dialog.current;
      if (!anchor || !menu) return;
      const inset = 12, gap = 8, width = pickerWidth(innerWidth - inset * 2);
      const maxHeight = Math.min(440, innerHeight - inset * 2), height = Math.min(menu.scrollHeight, maxHeight);
      const above = anchor.top - gap - height;
      setPosition(previous => {
        const next = {width, maxHeight, left:Math.max(inset, Math.min(anchor.left, innerWidth - width - inset)), top:Math.max(inset, Math.min(above >= inset ? above : anchor.bottom + gap, innerHeight - height - inset))};
        return previous && Object.keys(next).every(key => previous[key] === next[key]) ? previous : next;
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (dialog.current) observer.observe(dialog.current);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open]);
  function close() { setOpen(false); }
  function openManagement(callback) { close(); callback?.(trigger.current); }
  const skills = catalog?.skills || [];
  return <div className="nubi-skill-menu-anchor nubi-composer-skill-anchor">
    <CxButton ref={trigger} className="composer-icon nubi-composer-skill-trigger" data-icon-only aria-label="스킬 관리" title="문서 첨부 및 도구" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (open) close(); else {setLoading(true); setFailed(false); setOpen(true);} }}><Icon name="plus" size={18}/></CxButton>
    {open && <AnchoredDialog dialogRef={dialog} id={id} title="도구 목록" className="nubi-skill-menu nubi-composer-skill-menu" initialFocus=".nubi-skill-menu-close" onClose={close} style={{...position, visibility:position ? 'visible' : 'hidden'}}>
      <div className="nubi-skill-menu-header"><strong id={`${id}-title`}>도구 목록</strong><CxButton ref={closeButton} className="nubi-skill-menu-close nubi-modal-close" aria-label="스킬 메뉴 닫기" title="닫기" onClick={close}><Icon name="xClose" size={18}/></CxButton></div>
      
      {onDocuments&&<CxButton className="nubi-skill-menu-marketplace" onClick={()=>openManagement(onDocuments)}><span className="nubi-skill-menu-icon" aria-hidden="true"><Icon name="file" size={18}/></span><span className="nubi-skill-menu-copy"><strong>문서 첨부</strong></span><Icon name="plus" size={16}/></CxButton>}
      {onOffice&&<CxButton className="nubi-skill-menu-marketplace" onClick={()=>openManagement(onOffice)}><span className="nubi-skill-menu-icon" aria-hidden="true"><Icon name="file" size={18}/></span><span className="nubi-skill-menu-copy"><strong>열린 Office 연결</strong></span><Icon name="plus" size={16}/></CxButton>}
      {onEditor&&<CxButton className="nubi-skill-menu-marketplace" onClick={()=>openManagement(onEditor)}><span className="nubi-skill-menu-icon" aria-hidden="true"><Icon name="file" size={18}/></span><span className="nubi-skill-menu-copy"><strong>문서 편집기 연결</strong></span><Icon name="plus" size={16}/></CxButton>}
      <div className="nubi-skill-menu-list" role="list" aria-label="등록한 스킬" aria-busy={loading}>
        {loading && <p className="nubi-skill-menu-empty" role="status"><span className="status-spinner" aria-hidden="true"/>스킬 확인 중</p>}
        {!loading && failed && <div className="nubi-skill-menu-unavailable"><p className="nubi-skill-menu-empty">불러오기 실패</p><CxButton className="nubi-skill-menu-retry" onClick={() => setRevision(value => value + 1)}><Icon name="refresh" size={14}/>다시 확인</CxButton></div>}
        {!loading && !failed && !skills.length && <p className="nubi-skill-menu-empty" role="status">스킬이 없어요.</p>}
        {!loading && skills.map(skill => <div role="listitem" key={skill.path || skill.name}><CxButton className="nubi-skill-menu-row" aria-label={`${skill.title||skill.name} 스킬 사용`} title={skill.description || skill.name} onClick={() => { try {
          if (!onSelect) throw Error('selection_unavailable');
          onSelect(skill,skills); setOpen(false);
          notifyWorkspaceToast(`${skill.title||skill.name} 스킬을 선택했습니다.`, {success:true});
        } catch { notifyWorkspaceToast('스킬을 요청에 추가하지 못했습니다. 다시 선택해 주세요.', {error:true}); } }}>
          <span className="nubi-skill-menu-icon" aria-hidden="true"><Icon name="layers" size={18}/></span><span className="nubi-skill-menu-copy"><strong>{skill.title||skill.name}</strong></span>
        </CxButton></div>)}
      </div>
      {!loading && (catalog?.truncated || catalog?.issues?.length > 0) && <p className="nubi-skill-menu-status">일부 스킬 확인 필요</p>}
      <div className="nubi-skill-menu-add" role="group" aria-label="스킬 추가 및 관리">
        
        {onMarketplace && <CxButton className="nubi-skill-menu-marketplace" onClick={() => openManagement(onMarketplace)}><span className="nubi-skill-menu-icon" aria-hidden="true"><Icon name="layers" size={18}/></span><span className="nubi-skill-menu-copy"><strong>AI Workspace</strong></span><Icon name="chevronRight" size={14}/></CxButton>}
        {onManage && <CxButton className="nubi-skill-menu-marketplace" onClick={() => openManagement(onManage)}><span className="nubi-skill-menu-icon" aria-hidden="true"><FolderMark size={18}/></span><span className="nubi-skill-menu-copy"><strong>내 스킬</strong></span><Icon name="chevronRight" size={14}/></CxButton>}
      </div>
      {onManageMcp && <div className="nubi-skill-menu-mcp" role="group" aria-label="MCP 서버">
        {(mcp || []).map(server => <div key={server.id} className="nubi-skill-menu-mcp-row" data-state={server.state}><span className="nubi-skill-menu-mcp-dot" aria-hidden="true"/><strong>{server.name || server.id}</strong><span>{server.state === 'connected' ? `도구 ${server.tools.length}개` : server.state === 'failed' ? '연결 실패' : '연결 안 됨'}</span></div>)}
        <CxButton className="nubi-skill-menu-marketplace" onClick={() => openManagement(onManageMcp)}><span className="nubi-skill-menu-icon" aria-hidden="true"><Icon name="workflow" size={18}/></span><span className="nubi-skill-menu-copy"><strong>MCP 서버</strong>{mcp && <small>{mcp.length ? `${mcp.length}개 등록` : '등록된 서버 없음'}</small>}</span><Icon name="chevronRight" size={14}/></CxButton>
      </div>}
    </AnchoredDialog>}
  </div>;
}
