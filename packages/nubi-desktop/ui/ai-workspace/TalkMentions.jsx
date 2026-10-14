import './user-identity.css';
import {ProfileTooltip} from './ProfileTooltip';
import React,{useEffect,useId,useRef,useState} from 'react';
import {GithubProfilePanel,useAccount} from './AccountProfile';
import {TALK_LOGIN} from './talkModel';

// Convert individual logins only. Code, email addresses, URLs and team mentions stay literal.
export function decorateTalkMentions(html) {
  const root=document.createElement('div');root.innerHTML=html;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];
  while(walker.nextNode())if(!walker.currentNode.parentElement.closest('pre,code,a,[data-type="mention"]'))nodes.push(walker.currentNode);
  for(const node of nodes){
    const pattern=/(^|[^\p{L}\p{N}_@/])@([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)(?![\p{L}\p{N}_@/-])/giu;
    let cursor=0,match,fragment=document.createDocumentFragment();
    while((match=pattern.exec(node.data))){
      const start=match.index+match[1].length;fragment.append(document.createTextNode(node.data.slice(cursor,start)));
      const mention=document.createElement('span');mention.dataset.type='mention';mention.dataset.id=match[2];mention.textContent=`@${match[2]}`;fragment.append(mention);cursor=start+match[2].length+1;
    }
    if(cursor){fragment.append(document.createTextNode(node.data.slice(cursor)));node.replaceWith(fragment);}
  }
  root.querySelectorAll('[data-type="mention"]').forEach(node=>{
    if(!TALK_LOGIN.test(node.dataset.id||''))return;
    node.textContent=`@${node.dataset.id}`;node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label',`${node.textContent} 프로필`);
  });
  return root.innerHTML;
}

export function useTalkMentionPreview(loadProfile) {
  const profileClient=useAccount()?.profileClient;
  const id=useId(),[card,setCard]=useState(null),[selected,setSelected]=useState(null),current=useRef(null),timer=useRef(null),delay=useRef(null),version=useRef(0);
  const close=()=>{clearTimeout(timer.current);clearTimeout(delay.current);version.current++;current.current?.removeAttribute('aria-describedby');current.current=null;setCard(null);};
  useEffect(()=>{close();setSelected(null);},[profileClient,loadProfile]);
  useEffect(()=>()=>{clearTimeout(timer.current);clearTimeout(delay.current);version.current++;current.current?.removeAttribute('aria-describedby');},[]);
  useEffect(()=>{
    if(!card)return;
    const escape=e=>{if(e.key==='Escape')close();};
    const outside=e=>{if(!e.target.closest?.('[data-type="mention"],.cx-profile-tooltip'))close();};
    window.addEventListener('keydown',escape);window.addEventListener('pointerdown',outside);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);
    return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('pointerdown',outside);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};
  },[Boolean(card)]);
  const show=async target=>{
    clearTimeout(timer.current);clearTimeout(delay.current);
    const login=target?.dataset.id;if(!TALK_LOGIN.test(login||'')||(!profileClient?.read&&!loadProfile))return;
    if(current.current===target)return;
    current.current?.removeAttribute('aria-describedby');current.current=target;target.setAttribute('aria-describedby',id);
    const seq=++version.current;
    setCard({login,anchor:target,loading:true});
    try{const user=await (profileClient?.read?profileClient.read({login}):loadProfile(login));const valid=Number.isSafeInteger(user?.id)&&user.id>0&&user.login?.toLowerCase()===login.toLowerCase();if(version.current===seq)setCard({login,anchor:target,user:valid?user:null,loading:false,error:!valid});}
    catch{if(version.current===seq)setCard({login,anchor:target,loading:false,error:true});}
  };
  const leave=e=>{if(e.relatedTarget?.closest?.('[data-type="mention"],.cx-profile-tooltip'))return;clearTimeout(delay.current);timer.current=setTimeout(close,140);};
  const target=e=>e.target.closest?.('[data-type="mention"]');
  const open=node=>{const login=node?.dataset.id;if(!TALK_LOGIN.test(login||''))return;const identity=card?.login===login&&card.user?card.user:{login};node.focus();close();setSelected(identity);};
  return {
    handlers:{
      onMouseOver:e=>{const node=target(e);if(!node||node.contains(e.relatedTarget))return;clearTimeout(delay.current);delay.current=setTimeout(()=>show(node),180);},onMouseOut:leave,
      onFocus:e=>show(target(e)),onBlur:leave,
      onClick:e=>{const node=target(e);if(node){e.preventDefault();open(node);}},
      onKeyDown:e=>{if(['Enter',' '].includes(e.key)&&target(e)){e.preventDefault();open(target(e));}},
    },
    popup:<>{selected&&<GithubProfilePanel account={selected} onClose={()=>setSelected(null)}/>}{card&&<ProfileTooltip id={id} {...card} onMouseEnter={()=>clearTimeout(timer.current)} onMouseLeave={leave}/>}</>,
  };
}
