import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './Icon';
import './action-buttons.css';

export const ACTIONS = Object.freeze({
  teamNotify:['users','팀 알림'],
  postsView:['list','게시글로 보기'], feedView:['feed','피드로 보기'], assign:['users','담당자 배정'],
  apply:['check','적용'],
  more:['moreHorizontal','더 보기'],
  myPosts:['user','내 글만 보기'], previousMedia:['chevronLeft','이전 첨부'], nextMedia:['chevronRight','다음 첨부'],
  search:['search','검색'], loadMore:['chevronDown','더 보기'],
  openExternal:['linkExternal','새 탭에서 보기'], inquiry:['message','문의'], share:['share','링크 공유'],
  github:['githubMark','관련 GitHub 열기'],
  markRead:['check','모두 읽음'], login:['logIn','로그인'],
  like:['heart','좋아요'], pin:['pin','상단 고정'], bookmark:['bookmark','보관'], back:['arrowLeft','목록으로'],
  underline:['underline','밑줄'],strike:['strike','취소선'],video:['video','동영상 첨부'],mention:['mention','사용자 언급'],
  attachment:['paperclip','파일 첨부'],
  bold: ['bold','굵게'], italic: ['italic','기울임'], heading: ['heading','제목'],
  list: ['list','목록'], quote: ['quote','인용'], codeBlock: ['code','코드 블록'],
  comment: ['message','댓글'], reply: ['undo','답글'],
  table: ['table','표 삽입'], image: ['image','이미지 첨부'], link: ['link','링크 삽입'],
  addRow: ['rowAdd','행 추가'], addColumn: ['columnAdd','열 추가'],
  removeRow: ['rowRemove','행 삭제'], removeColumn: ['columnRemove','열 삭제'],
  undo: ['undo','실행 취소'], redo: ['redo','다시 실행'],
  add: ['plus','추가'], edit: ['pencil','수정'], complete: ['check','수정 완료'], cancel: ['xClose','수정 취소'],
  delete: ['trash','삭제'], close: ['xClose','닫기'], help: ['helpCircle','도움말'],
  reset: ['resetFilters','초기화'], refresh: ['refresh','새로고침'], resetWidths: ['columnWidth','열 너비 초기화'], selectColumns: ['columns','열 선택'],
  clearFilters: ['filterClear','필터 해제'], clearSelection: ['xClose','선택 해제'], clearSearch: ['xClose','검색 지우기'],
  download: ['download','내보내기'], upload: ['upload','업로드'], copy: ['copy01','복사'],
  detail: ['chevronRight','상세 보기'], expand: ['maximize','크게 보기'], collapse: ['minimize','크기 복원'],
  fit: ['fitView','화면에 맞춤'], zoomIn: ['plus','확대'], zoomOut: ['minus','축소'],
  editAll: ['pencil','전체 수정'], read: ['eye','읽기 모드'], save: ['save','저장'],
  history: ['clockRewind','변경 이력'], notifications: ['bell','알림'], logout: ['logOut','로그아웃'],
  notificationsOff: ['bellOff','알림 꺼짐'],
  workflow: ['workflow','워크플로우 보기'], view: ['eye','보기'], menu: ['menu','메뉴 열기'],
  inherit: ['organization','상위 연결 사용'],
  hideSidebar: ['panelLeftClose','목록 접기'], showSidebar: ['panelLeft','목록 펼치기'],
});

function KeyboardTooltip({id,anchor,children}) {
  const element=useRef(null),[position,setPosition]=useState(null);
  useLayoutEffect(()=>{
    const update=()=>{
      const box=anchor.getBoundingClientRect(),tip=element.current.getBoundingClientRect();
      const left=Math.max(8,Math.min(box.left+(box.width-tip.width)/2,innerWidth-tip.width-8));
      const top=box.top>=tip.height+12?box.top-tip.height-8:Math.min(box.bottom+8,innerHeight-tip.height-8);
      setPosition({left,top,visibility:box.bottom<=0||box.top>=innerHeight?'hidden':'visible'});
    };
    update();
    window.addEventListener('resize',update);document.addEventListener('scroll',update,true);
    return()=>{window.removeEventListener('resize',update);document.removeEventListener('scroll',update,true);};
  },[anchor,children]);
  // Stay in the active modal's backdrop so background inertness never hides help.
  return createPortal(<span ref={element} id={id} role="tooltip" className="cx-action-tooltip" style={position||{visibility:'hidden'}}>{children}</span>,anchor.closest('.cx-panel-backdrop, .agent-mobile-layer')||document.body);
}

// Repeatable utilities use icons. Save and key navigation actions retain labels.
// Native titles explain pointer hover; keyboard focus gets the same visible text.
export function ActionButton({action,label,title,iconOnly=!['save','login','logout','inquiry'].includes(action),tone=action==='save'?'primary':'neutral',busy=false,success=false,className='',disabled,as:Tag='button',ref:forwardedRef,onClick,onFocus,onBlur,onKeyDown,onPointerDown,...props}) {
  const [icon,name]=ACTIONS[action],id=useId(),button=useRef(null),[hint,setHint]=useState(false);
  const text=label||(busy&&action==='save'?'저장 중…':name),description=title||text;
  const link=Tag==='a',blocked=disabled||busy;
  useEffect(()=>{if(disabled||busy)setHint(false);},[disabled,busy]);
  return <><Tag {...props} ref={node=>{button.current=node;if(typeof forwardedRef==='function')forwardedRef(node);else if(forwardedRef)forwardedRef.current=node;}}
    type={link?undefined:props.type||'button'} href={link&&!blocked?props.href:undefined} role={link?'link':props.role} tabIndex={link&&blocked?-1:props.tabIndex}
    className={`${iconOnly?'cx-icon-button':'cx-button'}${tone==='primary'?' cx-button--primary':''} cx-action-button ${link?'cx-action-link ':''}${className}`.trim()}
    data-action={action} data-tone={tone} data-icon-only={iconOnly||undefined} aria-label={props['aria-label']||text} title={description} disabled={link?undefined:blocked} aria-disabled={link&&blocked?true:props['aria-disabled']}
    aria-busy={busy||undefined} aria-describedby={[props['aria-describedby'],hint?id:null].filter(Boolean).join(' ')||undefined}
    onFocus={event=>{if(iconOnly&&event.currentTarget.matches(':focus-visible'))setHint(true);onFocus?.(event);}}
    onBlur={event=>{setHint(false);onBlur?.(event);}}
    onPointerDown={event=>{setHint(false);onPointerDown?.(event);}}
    onClick={event=>{if(blocked){event.preventDefault();return;}setHint(false);onClick?.(event);}}
    onKeyDown={event=>{if(event.key==='Escape'&&hint){event.preventDefault();event.stopPropagation();setHint(false);}onKeyDown?.(event);}}>
    {busy?<span className="status-spinner" aria-hidden="true"/>:<Icon name={success?'check':icon} size={20}/>}
    <span className={iconOnly?'visually-hidden':undefined}>{text}</span>
  </Tag>{hint&&button.current&&<KeyboardTooltip id={id} anchor={button.current}>{description}</KeyboardTooltip>}</>;
}

export function ActionLink(props) { return <ActionButton {...props} as="a"/>; }
