import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ActionButton} from './ActionButton';
import {SearchField} from './SearchField';
import {Icon} from './Icon';
import {GithubAvatar} from './AccountProfile';
import {githubIdentityLabel} from './githubIdentity';
import {InquiryAssigneeOptions} from './InquiryAssignees';
import {GithubRequestError} from './GithubRequestError';
import {modalControls} from './modalFocus';
import './inquiry.css';

export function InquiryRecipients({client,value,onChange,disabled,error}) {
  const id=useId(),trigger=useRef(null),popup=useRef(null);
  const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[query,setQuery]=useState('');
  const [loading,setLoading]=useState(false),[failure,setFailure]=useState(''),[revision,setRevision]=useState(0),[position,setPosition]=useState({left:0,top:0});
  const close=(focus=true)=>{setOpen(false);if(focus)trigger.current?.focus({preventScroll:true});};
  useEffect(()=>{
    if(!open||disabled)return;
    let active=true;setLoading(true);setFailure('');
    client.creationCandidates().then(users=>{if(active)setRows(users);}).catch(reason=>{if(active)setFailure(reason);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[client,open,disabled,revision]);
  useLayoutEffect(()=>{
    if(!open||disabled){if(open)setOpen(false);return;}
    const place=()=>{
      const box=trigger.current.getBoundingClientRect(),height=popup.current?.offsetHeight||240,width=Math.min(400,innerWidth-24);
      setPosition({left:Math.max(12,Math.min(box.left,innerWidth-width-12)),top:Math.max(12,Math.min(box.bottom+height+6<=innerHeight?box.bottom+6:box.top-height-6,innerHeight-height-12))});
    };
    const outside=event=>{if(!popup.current?.contains(event.target)&&!trigger.current?.contains(event.target))close(false);};
    place();popup.current?.querySelector('input[type="search"],input:not([type="checkbox"])')?.focus({preventScroll:true});
    const observer=new ResizeObserver(place);observer.observe(popup.current);
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{observer.disconnect();document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,disabled]);
  const keyboard=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    if(event.key==='Tab'){
      const controls=modalControls(popup.current),index=controls.indexOf(document.activeElement);
      if(event.shiftKey&&index===0||!event.shiftKey&&index===controls.length-1){event.preventDefault();close();}
    }
  };
  const needle=query.trim().toLowerCase(),filtered=rows.filter(user=>`${user.name||''} ${user.login} ${user.email||''}`.toLowerCase().includes(needle));
  return <div className="service-desk-recipients">
    <div className="inquiry-recipient-values">
      <button ref={trigger} type="button" className="text-input inquiry-recipient-trigger" aria-label="담당자 선택" aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} aria-invalid={Boolean(error)} aria-describedby={error?`${id}-error`:undefined} disabled={disabled} onClick={()=>open?close():setOpen(true)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);}}}><Icon name="user" size={16}/><span>담당자 선택</span><Icon name="chevronDown" size={16}/></button>
      {value.map(user=><span className="inquiry-recipient-chip" key={user.id}><GithubAvatar user={user} size="sm"/><span>{githubIdentityLabel(user)}</span><ActionButton action="close" label={`${githubIdentityLabel(user)} 선택 해제`} disabled={disabled} onClick={()=>onChange(value.filter(item=>item.id!==user.id))}/></span>)}
    </div>
    {error&&<p className="service-desk-field-error" id={`${id}-error`}>{error}</p>}
    {open&&createPortal(<div ref={popup} id={id} className="inquiry-recipient-popover" role="dialog" aria-label="담당자 선택" style={position} onKeyDown={keyboard}>
      <div className="inquiry-assignment-toolbar"><SearchField label="담당자 검색" placeholder="이름, ID, 이메일" value={query} onChange={setQuery}/><ActionButton action="refresh" label="담당자 새로고침" busy={loading} onClick={()=>setRevision(current=>current+1)}/><ActionButton action="close" onClick={()=>close()}/></div>
      {loading?<p className="inquiry-assignment-empty" role="status">불러오는 중…</p>:failure?<GithubRequestError error={failure}/>:<><InquiryAssigneeOptions rows={filtered} chosen={value.map(user=>user.login)} onChange={(user,checked)=>onChange(checked?[...value,user]:value.filter(item=>item.id!==user.id))}/>{!filtered.length&&<p className="inquiry-assignment-empty">{needle?'검색 결과가 없습니다.':'관리자 팀에 등록된 담당자가 없습니다.'}</p>}</>}
    </div>,document.body)}
  </div>;
}
