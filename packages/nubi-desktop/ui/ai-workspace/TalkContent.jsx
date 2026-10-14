import React,{useEffect,useMemo,useRef} from 'react';
import {sanitizeTalkHtml,markdownToTalkHtml} from './talkRichText';
import {highlightSafeTalkHtml} from './talkCode';
import {decorateTalkMentions,useTalkMentionPreview} from './TalkMentions';
import {hydrateMentionIdentities} from './mentionIdentity';
import {notifyToast} from './Toast';
import {useGithubProfileReader} from './AccountProfile';
import {AttachmentList} from './AttachmentList';
import {splitTalkAttachmentHtml,downloadTalkAttachment} from './talkAttachments';
import {splitTalkComment} from './talkCommentAttachments';

export const TalkContent=React.memo(function TalkContent({body,media,profile:providedProfile,markdown=false,className='',separateAttachments=true}) {
  const profile=useGithubProfileReader(providedProfile);
  const ref=useRef(null),content=useMemo(()=>{
    const comment=markdown&&media?.attachments?splitTalkComment(body):null;
    const html=markdown?markdownToTalkHtml(comment?.attachments.length?comment.text:body):sanitizeTalkHtml(body);
    const split=separateAttachments&&media?.attachments?splitTalkAttachmentHtml(html,media.storedPath):{html,files:[]};
    return {...split,files:[...new Map([...split.files,...(comment?.attachments||[])].map(file=>[file.url,file])).values()]};
  },[body,markdown,media,separateAttachments]);
  const html=useMemo(()=>highlightSafeTalkHtml(decorateTalkMentions(content.html)),[content.html]);
  const mention=useTalkMentionPreview(profile);
  useEffect(()=>hydrateMentionIdentities(ref.current,profile),[html,profile]);
  const markup=useMemo(()=>({__html:html}),[html]);
  useEffect(()=>{
    let active=true;const urls=[];
    if(media)ref.current?.querySelectorAll('a[href]').forEach(node=>{
      if(!media.storedPath(node.href))return;
      node.title=node.getAttribute('data-name')||node.textContent;
      node.classList.add('talk-file-link');
    });
    if(media)ref.current?.querySelectorAll('img[src],video[src]').forEach(async node=>{
      try {const src=node.getAttribute('src');if(!media.storedPath(src))return;const blob=await media.load(src);if(!blob||!active)return;const url=URL.createObjectURL(blob);urls.push(url);node.src=url;}catch{if(active){node.setAttribute('title','첨부를 불러오지 못했습니다. 저장소 읽기 권한을 확인하세요.');}}
    });
    return()=>{active=false;urls.forEach(url=>URL.revokeObjectURL(url));};
  },[html,media]);
  const download=async event=>{
    const anchor=event.target.closest('a[href]');if(!anchor||!media?.storedPath(anchor.href))return;event.preventDefault();
    try {const blob=await media.load(anchor.href);if(!blob)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=anchor.getAttribute('data-name')||anchor.textContent||'첨부 파일';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){notifyToast(error,{source:'talk-download',error:true});}
  };
  return <><div ref={ref} className={`talk-rich-content ${className}`} {...mention.handlers} onClick={event=>{mention.handlers.onClick(event);download(event);}} dangerouslySetInnerHTML={markup}/><AttachmentList compact files={content.files} onDownload={file=>downloadTalkAttachment(media,file)}/>{mention.popup}</>;
});
