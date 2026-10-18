import {DeckConfirmation,DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {pickerWidth} from './picker-width.mjs';
import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {AnchoredDialog} from './AnchoredDialog.jsx';

// Automatic approval, as in Codex and Claude Code (user decision 2026-09-30: three modes and "always allow").
// Administrator commands and app control always wait for the user; the menu says so.
export const APPROVAL_MODES=[
  {id:'ask',icon:'user',label:'매번 확인',description:'파일 수정과 명령마다 확인해요.'},
  {id:'edits',icon:'pencil',label:'파일 자동 반영',description:'파일은 자동 반영, 명령은 확인해요.'},
  {id:'commands',icon:'automation',label:'파일과 명령 자동',description:'파일 수정과 프로젝트 테스트, 빌드, 점검을 자동 실행해요.'},
];

// The composer control: the current mode as an icon and a name, and a menu to change it or drop an allowed command.
export function ApprovalModeControl({policy,disabled,onMode,onRemove}){
  const [position,setPosition]=useState(null),[pending,setPending]=useState(null),confirming=useRef(false);
  const [open,setOpen]=useState(false),trigger=useRef(null),menu=useRef(null),titleId=useId(),current=APPROVAL_MODES.find(mode=>mode.id===policy?.mode)||APPROVAL_MODES[0];
  // Follow CX's keyboard-tooltip portal and viewport clamp pattern for this interactive menu.
  useLayoutEffect(()=>{
    if(!open){setPosition(null);return;}
    const place=()=>{const anchor=trigger.current?.getBoundingClientRect(),content=menu.current;if(!anchor||!content)return;const width=pickerWidth(innerWidth-32),above=anchor.top-24,below=innerHeight-anchor.bottom-24,up=above>=content.scrollHeight||above>=below,maxHeight=Math.max(80,up?above:below),height=Math.min(content.scrollHeight,maxHeight);setPosition({width,maxHeight,left:Math.max(16,Math.min(anchor.left,innerWidth-width-16)),top:Math.max(16,up?anchor.top-height-8:anchor.bottom+8)});};
    place();window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);};
  },[open,policy?.allowedCommands?.length]);
  useEffect(()=>{setPending(null);},[policy?.mode]);
  function dismissWarning(){setPending(null);queueMicrotask(()=>trigger.current?.focus({preventScroll:true}));}
  function select(mode){
    if(disabled)return;
    setOpen(false);
    if(mode.id===current.id){trigger.current?.focus();return;}
    if(mode.id==='ask'){trigger.current?.focus();onMode(mode.id);return;}
    confirming.current=false;setPending({mode,from:current.id});
  }
  function confirm(){
    if(!pending||disabled||confirming.current||pending.from!==current.id)return;
    confirming.current=true;const mode=pending.mode.id;dismissWarning();onMode(mode);
  }
  const warning=pending?.from===current.id?pending:null,commands=warning?.mode.id==='commands';
  function navigate(event){if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const items=[...menu.current.querySelectorAll('[role="menuitemradio"]')],index=items.indexOf(document.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
  const allowed=policy?.allowedCommands||[];
  return <><div className="nubi-approval-mode">
    <CxButton ref={trigger} type="button" className="nubi-approval-mode-button" data-mode={current.id} aria-label={'승인 방식: '+current.label} aria-haspopup="dialog" aria-expanded={open} title={'승인 방식: '+current.label} disabled={disabled} onClick={()=>setOpen(value=>!value)}><Icon name={current.icon} size={16}/><span>{current.label}</span><Icon name="chevronDown" size={14}/></CxButton>
    {open&&<AnchoredDialog dialogRef={menu} title="승인 방식" className="nubi-approval-mode-menu nubi-approval-mode-layer" initialFocus='[aria-checked="true"]' onClose={()=>setOpen(false)} style={{...position,visibility:position?'visible':'hidden'}}>
      <div className="nubi-approval-mode-header"><strong id={titleId}>승인 방식</strong><CxButton className="nubi-modal-close" aria-label="승인 방식 닫기" title="닫기" onClick={()=>setOpen(false)}><Icon name="xClose" size={18}/></CxButton></div>
      <div role="menu" aria-label="승인 방식" onKeyDown={navigate}>{APPROVAL_MODES.map(mode=><button key={mode.id} type="button" role="menuitemradio" aria-checked={mode.id===current.id} className="nubi-approval-mode-item" title={mode.description} aria-label={`${mode.label}: ${mode.description}`} onClick={()=>select(mode)}>
        <Icon name={mode.icon} size={18}/><span><strong>{mode.label}</strong></span>{mode.id===current.id&&<Icon name="check" size={16}/>}
      </button>)}</div>
      <p className="nubi-approval-mode-description">{current.description}</p>
      <p className="nubi-approval-mode-note"><Icon name="infoCircle" size={14}/>관리자 명령과 앱 조작은 항상 확인해요.</p>
      {allowed.length>0&&<div className="nubi-approval-allowed" role="group" aria-label="항상 허용한 명령">
        <strong>항상 허용한 명령</strong>
        <ul>{allowed.map(item=><li key={item.profile+'\n'+item.script}><code title={item.script}>{item.script}</code><ActionButton action="delete" label={item.script+' 허용 해제'} title="허용 해제" onClick={()=>{menu.current?.querySelector('[aria-checked="true"]')?.focus();onRemove(item);}}/></li>)}</ul>
      </div>}
    </AnchoredDialog>}
  </div>
    {warning&&<DeckConfirmation className="nubi-auto-approval-warning" title={commands?'자동 실행 안내':'자동 반영 안내'} confirmLabel="자동 허용" showActionLabels busy={disabled} onCancel={dismissWarning} onConfirm={confirm}
      message={<><strong>{commands?'파일 변경과 검사 명령을 자동 실행해요.':'파일 변경을 자동 반영해요.'}</strong><br/>{commands?'파일 변경이나 외부 통신이 발생할 수 있어요.':'작업 내용을 잃을 수 있으니 미리 보관해 주세요.'}</>}>
      <p>현재 프로젝트의 모든 대화와 대기 중인 작업에 적용돼요.</p>
      <p className="nubi-muted">관리자 명령과 앱 조작은 계속 확인해요.</p>
      <p className="nubi-muted">되돌리기 어려운 명령은 자동 모드에서도 확인해요.</p>
      <DeckDisclosure title="설정 변경과 허용 범위" icon="infoCircle">
        <p>입력창에서 <strong>매번 확인</strong>으로 되돌릴 수 있어요.</p>
        {commands&&<p>검사 명령은 이 PC에서 테스트, 빌드, 점검을 실행해요. 신뢰하는 프로젝트에서만 허용해 주세요.</p>}
        {allowed.length>0&&<p>항상 허용한 명령은 별도로 유지돼요. 해제는 승인 방식의 명령 목록에서 할 수 있어요.</p>}
      </DeckDisclosure>
    </DeckConfirmation>}
  </>;
}
