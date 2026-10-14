import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {ActionButton} from './ActionButton';
import {Icon} from './Icon';
import {groupComments,rankCommentGroups} from './commentThread';

const batch=5;
export function CommentThreadList({comments,renderComment,revealedCommentId,locked=false,popularThreshold=null}) {
  const groups=useMemo(()=>popularThreshold?rankCommentGroups(comments,popularThreshold):groupComments(comments),[comments,popularThreshold]),[limits,setLimits]=useState({}),prefix=useId(),handled=useRef(null);
  useEffect(()=>{
    if(!revealedCommentId||handled.current===revealedCommentId)return;
    const group=groups.find(group=>String(group.root.id)===String(revealedCommentId)||group.replies.some(row=>String(row.id)===String(revealedCommentId)));
    if(!group)return;handled.current=revealedCommentId;
    if(String(group.root.id)!==String(revealedCommentId))setLimits(current=>({...current,[group.root.id]:Math.max(batch,group.replies.length-group.replies.findIndex(row=>String(row.id)===String(revealedCommentId)),current[group.root.id]||0)}));
    const timer=setTimeout(()=>{
      const element=document.getElementById(`${prefix}-comment-${revealedCommentId}`);
      element?.focus({preventScroll:true});element?.scrollIntoView({block:'nearest',behavior:'smooth'});
    },0);
    return()=>clearTimeout(timer);
  },[groups,revealedCommentId,prefix]);
  return <ol className="talk-comment-list">{groups.map(({root,replies})=>{
    const firstPopular=popularThreshold?replies.findIndex(row=>row.likes>=popularThreshold):-1,defaultLimit=firstPopular>=0?replies.length-firstPopular:0,limit=limits[root.id]??defaultLimit,shown=limit?replies.slice(-limit):[],remaining=Math.max(0,replies.length-limit),region=`${prefix}-replies-${root.id}`;
    return <li key={root.id}>
      <div id={`${prefix}-comment-${root.id}`} tabIndex={-1} className={`comment-entry${popularThreshold&&root.likes>=popularThreshold?' is-popular':''}`}>{popularThreshold&&root.likes>=popularThreshold&&<span className="comment-popular-label" title={`좋아요 ${popularThreshold}개 이상`}><Icon name="pin" size={14}/>인기 댓글</span>}{renderComment(root)}</div>
      {replies.length>0&&<button type="button" className="comment-thread-toggle" disabled={locked} aria-expanded={limit>0} aria-controls={limit>0?region:undefined} onClick={()=>setLimits(current=>({...current,[root.id]:limit?0:batch}))}><Icon name={limit?'chevronUp':'chevronDown'} size={16}/><span>답글 {replies.length}개</span><span className="visually-hidden">{limit?'접기':'펼치기'}</span></button>}
      {limit>0&&replies.length>0&&<div id={region} className="comment-thread-region">
        {remaining>0&&<ActionButton action="loadMore" iconOnly={false} disabled={locked} className="comment-older-replies" label={`이전 답글 더 보기 (${remaining})`} onClick={()=>setLimits(current=>({...current,[root.id]:(current[root.id]||batch)+batch}))}/>}
        <ol className="comment-replies">{shown.map(comment=><li key={comment.id} id={`${prefix}-comment-${comment.id}`} tabIndex={-1} className={`is-reply comment-entry${popularThreshold&&comment.likes>=popularThreshold?' is-popular':''}`}>{popularThreshold&&comment.likes>=popularThreshold&&<span className="comment-popular-label" title={`좋아요 ${popularThreshold}개 이상`}><Icon name="pin" size={14}/>인기 댓글</span>}{renderComment(comment)}</li>)}</ol>
      </div>}
    </li>;
  })}</ol>;
}
