import React,{useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {useNotices,markNoticesRead,clearNotices} from './notice-store.js';
import {relativeTime} from './relative-time.js';
const KIND_ICON={decision:'decision',mail:'mail',host:'infoCircle',info:'infoCircle'};
// Rail bell with an unread dot; opens the list of notices (toasts, Windows notifications, host events). Each notice
// keeps its action, so a decision request can still be opened from here after its toast has gone.
export function NotificationBell(){
  const {notices,unread}=useNotices(),[open,setOpen]=useState(false);
  const show=()=>{setOpen(true);markNoticesRead();};
  return <>
    <CxButton data-tone="blue" className="nubi-rail-notice" aria-label={unread?`알림 ${unread}개`:'알림'} title={unread?`확인할 알림 ${unread}개`:'알림'} aria-pressed={open} data-icon-only onClick={show}><Icon name={unread?'bell':'bellOff'} size={18}/>{unread>0&&<i className="nubi-rail-notice-dot" aria-hidden="true"/>}</CxButton>
    {open&&<DetailPanel className="deck-dialog nubi-panel nubi-notice-panel" variant="modal" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon"><Icon name="bell" size={20}/></span><span>알림</span></span>} onClose={()=>setOpen(false)}>
      {notices.length===0?<p className="nubi-notice-empty"><Icon name="bellOff" size={18}/><span>받은 알림이 없어요.</span></p>:<>
        <ul className="nubi-notice-list">
          {notices.map(item=><li key={item.id} className="nubi-notice-item" data-error={item.error||undefined} data-success={item.success||undefined} data-kind={item.kind}>
            <span className="nubi-notice-icon" aria-hidden="true"><Icon name={item.error?'alertCircle':item.success?'check':KIND_ICON[item.kind]||'infoCircle'} size={16}/></span>
            <span className="nubi-notice-text">{item.text}</span>
            <time className="nubi-notice-time" dateTime={new Date(item.at).toISOString()} title={new Date(item.at).toLocaleString('ko-KR')}>{relativeTime(new Date(item.at).toISOString())}</time>
            {item.action&&<CxButton className="nubi-notice-action" onClick={()=>{setOpen(false);item.action.onClick();}}>{item.action.label}</CxButton>}
          </li>)}
        </ul>
        <div className="nubi-notice-footer"><CxButton aria-label="알림 비우기" title="알림 비우기" data-icon-only onClick={clearNotices}><Icon name="trash" size={16}/></CxButton></div>
      </>}
    </DetailPanel>}
  </>;
}
