import React,{useEffect,useRef,useState} from 'react';
import {MentionTextInput} from './MentionTextInput';
import {UserIdentity} from './UserIdentity';
import {ActionButton} from './ActionButton';
import {useBeforeUnload} from './useBeforeUnload';
import {notifyToast} from './Toast';
import {confirmAction} from './confirmAction';
import {prepareTalkAttachment} from './talkMedia';
import {joinTalkComment,splitTalkComment} from './talkCommentAttachments';
import {AttachmentList} from './AttachmentList';

export function CommentComposer({client,media,number,kind='talk',onSaved,onPending,replyTo,onCancelReply,editing=null,onCancelEdit,disabled=false}) {
  const [initial]=useState(()=>kind==='talk'?splitTalkComment(editing?.body):{text:editing?.body||'',attachments:[]});
  const [text,setText]=useState(initial.text),[attachments,setAttachments]=useState(initial.attachments),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[uploading,setUploading]=useState(false),[uploadAllowed,setUploadAllowed]=useState(false);
  const input=useRef(null),uploadLock=useRef(false),live=useRef(true);
  const id=useRef(crypto.randomUUID()),field=useRef(null),label=kind==='talk'?'댓글':'답변';
  const dirty=text!==initial.text||JSON.stringify(attachments)!==JSON.stringify(initial.attachments),blocked=disabled||busy||uncertain||uploading;
  useBeforeUnload(dirty||busy||uploading);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{let active=true;setUploadAllowed(false);if(kind==='talk'&&media?.attachments)media.canUpload().then(allowed=>{if(active)setUploadAllowed(allowed);}).catch(()=>{});return()=>{active=false;};},[media,kind]);
  useEffect(()=>{onPending({dirty,saving:busy||uploading,replyLocked:busy||uploading||uncertain||Boolean(editing),leaveMessage:uncertain?`반영 여부를 확인하지 못했습니다.\n${label} 목록을 확인한 뒤 다시 작성하세요.`:undefined});return()=>onPending({dirty:false,saving:false});},[dirty,busy,uploading,uncertain,editing,onPending,label]);
  useEffect(()=>{if(replyTo){field.current?.focus();field.current?.scrollIntoView({block:'nearest',behavior:'smooth'});}},[replyTo?.id]);
  useEffect(()=>{if(editing){field.current?.focus();field.current?.scrollIntoView({block:'nearest'});}},[editing?.id]);
  const submit=async event=>{
    event.preventDefault();if(busy||disabled||uploading||(!text.trim()&&!attachments.length))return;setBusy(true);
    try {
      const body=kind==='talk'?joinTalkComment(text,attachments):text;
      const saved=editing?await client.updateComment(number,editing,body):kind==='talk'?await client.comment(number,{body,id:id.current,replyTo:replyTo?.id??null}):await client.comment(number,body,id.current,replyTo?.id??null);
      setText('');setAttachments([]);setUncertain(false);id.current=crypto.randomUUID();onCancelReply?.();onSaved(saved);notifyToast(`${label}을 ${editing?'수정':'등록'}했습니다.`,{source:`${kind}-comment`});
    } catch(error) {setUncertain(value=>value||Boolean(error.uncertain));notifyToast(error,{source:`${kind}-comment`,error:true});}
    finally {setBusy(false);}
  };
  const addFiles=async event=>{
    const files=Array.from(event.target.files||[]);event.target.value='';if(!files.length||blocked||uploadLock.current||!uploadAllowed)return;
    if(files.length+attachments.length>8){notifyToast('첨부는 댓글마다 8개까지 추가할 수 있습니다.',{source:'comment-upload',error:true});return;}
    uploadLock.current=true;setUploading(true);
    try{const prepared=[];for(const file of files)prepared.push(await prepareTalkAttachment(file));for(const file of prepared){const saved=await media.upload(file,id.current);if(live.current)setAttachments(current=>[...current,{name:saved.name,size:saved.size,url:saved.url}]);}}
    catch(error){if(live.current)notifyToast(error,{source:'comment-upload',error:true});}
    finally{uploadLock.current=false;if(live.current)setUploading(false);}
  };
  return <form className={`talk-comment-form cx-editor-field${kind==='inquiry'?' inquiry-reply':''}`} aria-disabled={blocked||undefined} onSubmit={submit}>
    {editing&&<div className="comment-reply-target"><span>{label} 수정</span><ActionButton action="close" label="수정 취소" disabled={busy||uploading} onClick={async()=>{if(!dirty||await confirmAction({kind:'leave',title:'수정을 취소할까요?',message:uncertain?'반영 여부를 확인하지 못했습니다. 최신 답변을 다시 확인하세요.':'수정한 내용은 저장되지 않습니다.',confirmLabel:'수정 취소',cancelLabel:'계속 수정'}))onCancelEdit?.();}}/></div>}
    {replyTo&&<div className="comment-reply-target"><span><UserIdentity user={replyTo.user} chip/> 님에게 답글</span><ActionButton action="close" label="답글 선택 해제" disabled={busy||uploading||uncertain} onClick={onCancelReply}/></div>}
    <MentionTextInput initialValue={initial.text} resetKey={id.current} onChange={setText} client={client} disabled={blocked} inputRef={field} label={kind==='inquiry'?'답변':'댓글 내용'} placeholder={`${label}을 입력하세요. @로 사용자 검색`} maxLength={500}/>
    {kind==='talk'&&media?.attachments&&<AttachmentList compact files={attachments} disabled={blocked} onRemove={index=>setAttachments(current=>current.filter((_,i)=>i!==index))}/>}
    {uploading&&<p className="talk-upload-status" role="status">첨부 중…</p>}
    <div className="talk-comment-submit">{kind==='talk'&&media?.attachments&&<><ActionButton className="talk-comment-add" action="attachment" label={uploadAllowed?'댓글 파일 첨부':'첨부 저장소 쓰기 권한 필요'} disabled={blocked||!uploadAllowed} onClick={()=>input.current.click()}/><input ref={input} type="file" multiple hidden aria-label="댓글 첨부 파일 선택" disabled={blocked||!uploadAllowed} onChange={addFiles}/></>}<small>{text.length}/500</small><ActionButton action="save" label={uncertain?'결과 확인':editing?'저장':'등록'} type="submit" busy={busy} disabled={disabled||uploading||(!text.trim()&&!attachments.length)||(editing&&!dirty)}/></div>
  </form>;
}
