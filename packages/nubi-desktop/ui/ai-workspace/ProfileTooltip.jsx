import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './Icon';
import {createTalkClient} from './talkClient';
import {profileEmail} from './profileEmail';
import {GithubAvatar} from './GithubAvatar';
import './profile-tooltip.css';

export function ProfileTooltip({id,user,login,anchor,loading,error,onMouseEnter,onMouseLeave}) {
  const email=profileEmail(user?.email);
  const ref=useRef(null),[position,setPosition]=useState({visibility:'hidden'});
  useLayoutEffect(()=>{
    if(!anchor?.isConnected)return;
    const rect=anchor.getBoundingClientRect(),box=ref.current.getBoundingClientRect();
    setPosition({left:Math.max(8,Math.min(rect.left,innerWidth-box.width-8)),top:Math.max(8,Math.min(rect.bottom+box.height+6<innerHeight?rect.bottom+6:rect.top-box.height-6,innerHeight-box.height-8))});
  },[anchor,user,loading,error]);
  return createPortal(<div ref={ref} id={id} role="tooltip" className="cx-profile-tooltip" style={position} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <GithubAvatar user={user||{login}}/>
    <div><div className="cx-profile-tooltip-name"><strong>{user?.name||user?.login||login}</strong>{user?.name&&user.name!==(user.login||login)&&<span>({user?.login||login})</span>}</div>{email&&<div className="cx-profile-tooltip-email"><Icon name="mail" size={14}/><span>{email}</span></div>}{user?.bio&&<p>{user.bio}</p>}{!user&&<p>{loading?'프로필 불러오는 중…':error?'프로필을 불러오지 못했습니다.':'프로필을 찾을 수 없습니다.'}</p>}</div>
  </div>,anchor?.closest('.cx-panel-backdrop, .agent-mobile-layer')||document.body);
}
export function usePublicProfileHover(user,profileReader) {
  const [card,setCard]=useState(null),timer=useRef(null),hideTimer=useRef(null),version=useRef(0),client=useRef(null);
  const close=()=>{clearTimeout(timer.current);clearTimeout(hideTimer.current);version.current++;setCard(null);};
  useEffect(()=>{close();},[user?.id,user?.login,profileReader]);
  useEffect(()=>()=>{clearTimeout(timer.current);clearTimeout(hideTimer.current);version.current++;},[]);
  useEffect(()=>{if(!card)return;const escape=e=>{if(e.key==='Escape')close();};window.addEventListener('keydown',escape);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};},[Boolean(card)]);
  const show=anchor=>{
    clearTimeout(timer.current);clearTimeout(hideTimer.current);const seq=++version.current;
    timer.current=setTimeout(async()=>{
      setCard({anchor,user,loading:true});
      try{if(!profileReader)client.current ||= createTalkClient();const loaded=await (profileReader?profileReader.read(user):client.current.profile(user.login));const matches=loaded?.id===user.id&&loaded?.login?.toLowerCase()===user.login?.toLowerCase();if(seq===version.current)setCard({anchor,user:matches?{...user,...loaded}:user,error:!matches});}catch{if(seq===version.current)setCard({anchor,user,error:true});}
    },180);
  };
  const leave=()=>{clearTimeout(timer.current);hideTimer.current=setTimeout(close,140);};
  return {card,close,handlers:{onMouseEnter:e=>show(e.currentTarget),onMouseLeave:leave,onFocus:e=>show(e.currentTarget),onBlur:leave},keep:()=>clearTimeout(hideTimer.current),leave};
}
