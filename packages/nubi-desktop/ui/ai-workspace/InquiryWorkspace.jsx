import {CommentComposer} from './CommentComposer';
import {CommentThreadList} from './CommentThreadList';
import {InquiryAssignees} from './InquiryAssignees';
import {createInquiryAssignmentClient} from './inquiryAssignment';
import {ProfileIdentity} from './AccountProfile';
import {CxSelect} from './CxSelect';
import {CxTabs} from './CxTabs';
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {SearchField} from './SearchField';
import {ServiceDesk,InquiryPage} from './ServiceDesk';
import {ActionButton,ActionLink} from './ActionButton';
import {CommunityStatus} from './CommunityStatus';
import {NativeAttachmentLink} from './NativeAttachmentLink';
import {Icon} from './Icon';
import {TalkAuthor,TalkContent} from './E2ETalk';
import {usePagination,TablePagination} from './TableControls';
import {createInquiryClient,inquiryCanChangeState} from './inquiryClient';
import {talkCanManage} from './talkModel';
import {filterInquiries,inquiryStatus} from './inquiryList';
import {talkExcerpt} from './talkRichText';
import {createTalkMediaClient} from './talkMedia';
import {SERVICE_DESK_ATTACHMENT_CONFIG} from './config';
import {inquiryOrigin,rememberInquiryReturn,workspaceViewFromHash} from './inquiryNavigation';
import {confirmAction} from './confirmAction';
import {notifyToast} from './Toast';
import {refreshInquiryNotifications} from './inquiryNotificationRefresh';
import './inquiry.css';
import {ghesImageUrl} from './ghesImage.js';
const readRoute=()=>location.hash==='#support=new'?'new':/^#support=([1-9]\d*)$/.exec(location.hash)?.[1]||'list';
const noPending=()=>{};
const empty={dirty:false,saving:false};
function InquirySidebar({id,posts,rows,pagination,query,setQuery,mine,setMine,status,setStatus,category,setCategory,client,selected,loading,failure,locked,refreshLocked,onRefresh,onOpen,scrollPosition}) {
  const excerpts=useMemo(()=>new Map(pagination.rows.map(post=>[post.number,talkExcerpt(post.body,'markdown').text])),[pagination.rows]);
  const counts=useMemo(()=>Object.fromEntries(['','open','completed','closed'].map(key=>[key,rows.filter(post=>!key||inquiryStatus(post).key===key).length])),[rows]);
  const scroll=useRef(null),scope=useRef(`${query}:${mine}:${status}:${category}:${pagination.page}`);
  useEffect(()=>{if(scroll.current)scroll.current.scrollTop=scrollPosition.current;},[scrollPosition]);
  useEffect(()=>{const next=`${query}:${mine}:${status}:${category}:${pagination.page}`;if(scope.current!==next)scroll.current?.scrollTo({top:0});scope.current=next;},[query,mine,status,category,pagination.page]);
  return <aside id={id} className="inquiry-sidebar" aria-label="문의 목록">
    <div className="inquiry-sidebar-heading"><h2>문의 목록 <span>{posts.length}</span></h2><ActionButton action="refresh" disabled={loading||locked||refreshLocked} onClick={onRefresh}/></div>
    <CxTabs className="inquiry-status-tabs" label="처리 상태" active={status} onChange={setStatus} idPrefix={`${id}-status`} panelId={`${id}-results`} items={['','open','completed','closed'].map((key,index)=>({key,label:<><span>{['전체','진행 중','완료','종료'][index]}</span><span className="inquiry-tab-count">{counts[key].toLocaleString()}</span></>}))}/>
    <div className="inquiry-toolbar">
      <SearchField label="문의 검색" placeholder="제목, 내용, 작성자 검색" value={query} onChange={setQuery}/>
      <div className="inquiry-filters"><CxSelect className="native-select" aria-label="문의 유형 필터" value={category} onChange={event=>setCategory(event.target.value)}><option value="">모든 유형</option>{[...new Set(posts.map(post=>post.type))].filter(Boolean).map(type=><option key={type}>{type}</option>)}</CxSelect>{client.signedIn&&<ActionButton action="myPosts" label="내 문의" aria-pressed={mine} onClick={()=>setMine(!mine)}/>}</div>
    </div>
    <div className="inquiry-results" id={`${id}-results`} role="tabpanel" aria-labelledby={`${id}-status-${status}`} tabIndex={0}>
    <CommunityStatus error={failure} className="inquiry-load-error"/>
    {loading&&!posts.length?<CommunityStatus loading label="문의를 불러오는 중…" className="inquiry-load-status"/>:<div className="inquiry-list-scroll" ref={scroll} onScroll={event=>{scrollPosition.current=event.currentTarget.scrollTop;}} aria-busy={loading}>
      <ol className="inquiry-feed">{pagination.rows.map(post=>{const state=inquiryStatus(post),name=post.user.name||post.user.login;return <li key={post.number}>
        <button type="button" className="inquiry-select" aria-label={post.title} aria-current={selected===String(post.number)?'true':undefined} disabled={locked} onClick={()=>onOpen(String(post.number))}>
          <span className="inquiry-feed-meta"><span className={`inquiry-status is-${state.key}`}>{state.label}</span><span className="inquiry-feed-type">{post.type}</span><small>#{post.number}</small></span>
          <span className="inquiry-post-link">{post.title}</span>
          {excerpts.get(post.number)&&<span className="inquiry-excerpt">{excerpts.get(post.number)}</span>}
          <span className="inquiry-feed-bottom"><span className="inquiry-list-author" title={`${name} (${post.user.login})`}>{post.user.avatar_url?<img src={ghesImageUrl(post.user.avatar_url)} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<Icon name="user" size={18}/>}<span>{name}</span></span><span className="inquiry-comment-count" aria-label={`답변 ${post.comments}개`}><Icon name="message" size={14}/>{post.comments}</span><time dateTime={post.updatedAt} title={new Date(post.updatedAt).toLocaleString('ko-KR')}>{Number.isFinite(Date.parse(post.updatedAt))?new Date(post.updatedAt).toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'}):''}</time></span>
        </button>
      </li>;})}</ol>
      {!pagination.rows.length&&!failure&&<p className="inquiry-empty">{posts.length?'조건에 맞는 문의가 없습니다.':'등록된 문의가 없습니다.'}</p>}
    </div>}
    <TablePagination pagination={pagination} as="div"/>
    </div>
  </aside>;
}

export default function InquiryWorkspace({user,role='user',onPendingChange=noPending,client:suppliedClient,media:suppliedMedia,assignmentClient:suppliedAssignment}){
  const roleRef=useRef(role);roleRef.current=role;
  const [client]=useState(()=>suppliedClient||createInquiryClient({role:()=>roleRef.current})),[origin]=useState(inquiryOrigin);
  const [media]=useState(()=>suppliedMedia||createTalkMediaClient({session:client.session,config:SERVICE_DESK_ATTACHMENT_CONFIG,namespace:'inquiry'}));
  const [route,setRoute]=useState(readRoute),[posts,setPosts]=useState([]),[detail,setDetail]=useState(null),[loading,setLoading]=useState(true),[failure,setFailure]=useState(''),[revision,setRevision]=useState(0);
  const [detailLoading,setDetailLoading]=useState(false),[detailFailure,setDetailFailure]=useState('');
  const [query,setQuery]=useState(''),[mine,setMine]=useState(false),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[pending,setPending]=useState(empty);
  const [editingPost,setEditingPost]=useState(null),[editingComment,setEditingComment]=useState(null),[mutating,setMutating]=useState(false),[pendingRemoval,setPendingRemoval]=useState(null),mutation=useRef(false);
  const [pendingState,setPendingState]=useState(null);
  const [assignment]=useState(()=>suppliedAssignment||createInquiryAssignmentClient());
  const [canAssign,setCanAssign]=useState(false),[assigning,setAssigning]=useState(false),[assignBusy,setAssignBusy]=useState(false);
  useEffect(()=>{let active=true;setCanAssign(false);if(role==='editor'||role==='system')assignment.canAssign().then(value=>{if(active)setCanAssign(value);}).catch(()=>{});return()=>{active=false;};},[assignment,role,revision]);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false),sidebarId=useId();
  const sequence=useRef(0),scrollPosition=useRef(0),reader=useRef(null);
  useEffect(()=>{onPendingChange({...pending,dirty:pending.dirty||assigning||Boolean(pendingRemoval)||Boolean(pendingState),saving:pending.saving||assignBusy||mutating});return()=>onPendingChange(empty);},[pending,assigning,assignBusy,mutating,pendingRemoval,pendingState,onPendingChange]);
  const [savedCommentId,setSavedCommentId]=useState(null),[replyTo,setReplyTo]=useState(null);useEffect(()=>setReplyTo(null),[route]);
  const canLeave=async()=>!assigning&&!assignBusy&&!pending.saving&&!mutation.current&&(!(pending.dirty||pendingRemoval||pendingState)||await confirmAction({kind:'leave',title:pendingRemoval||pendingState?'처리 결과를 확인하지 않고 나갈까요?':route==='new'||editingPost?'작성 중인 문의에서 나갈까요?':'작성 중인 답변에서 나갈까요?',message:pendingRemoval||pendingState?'반영 여부를 확인하지 못했습니다. 최신 문의를 다시 확인하세요.':pending.leaveMessage||'작성한 내용은 저장되지 않습니다.',confirmLabel:'나가기',cancelLabel:pendingRemoval||pendingState?'돌아가기':'계속 작성'}));
  const current=useRef({route,canLeave});current.current={route,canLeave};
  const open=async(next,confirmed=false)=>{if(next===route)return;if(!confirmed&&!await canLeave())return;setPending(empty);setEditingPost(null);setEditingComment(null);setPendingRemoval(null);setPendingState(null);history.replaceState(null,'',next==='list'?`#support=${origin.view}`:`#support=${next}`);setRoute(next);};
  useEffect(()=>{
    let token=0;
    const change=async event=>{if(workspaceViewFromHash(location.hash)!=='support')return;const next=readRoute();if(next===current.current.route)return;const id=++token;history.replaceState(null,'',event.oldURL);if(await current.current.canLeave()&&id===token){history.replaceState(null,'',event.newURL);setPending(empty);setEditingPost(null);setEditingComment(null);setPendingRemoval(null);setPendingState(null);setRoute(next);}};
    window.addEventListener('hashchange',change);return()=>{token++;window.removeEventListener('hashchange',change);};
  },[]);
  useEffect(()=>{
    let active=true;setLoading(true);setFailure('');
    client.list().then(result=>{if(active)setPosts(result);}).catch(error=>{if(active)setFailure(error.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[client,revision]);
  useEffect(()=>{
    const token=++sequence.current;setDetailFailure('');
    if(route==='new'||route==='list'){setDetail(null);setDetailLoading(false);return;}
    setDetailLoading(true);
    client.detail(Number(route)).then(result=>{if(sequence.current!==token)return;setDetail(result);setPosts(previous=>previous.map(post=>post.number===result.post.number?{...result.post,comments:result.comments.length}:post));}).catch(error=>{if(sequence.current===token)setDetailFailure(error.message);}).finally(()=>{if(sequence.current===token)setDetailLoading(false);});
    return()=>{sequence.current++;};
  },[client,route,revision]);
  useEffect(()=>{
    if(detail?.post.number===Number(route)){
      reader.current?.closest('.service-desk-page-body')?.scrollTo({top:0});
      if(matchMedia('(max-width:1000px)').matches)reader.current?.focus({preventScroll:true});
    }
  },[route,detail?.post.number]);
  const scoped=useMemo(()=>filterInquiries(posts,{mine,userId:user?.id,query,type:category}),[posts,mine,user?.id,query,category]);
  const rows=useMemo(()=>scoped.filter(post=>!status||inquiryStatus(post).key===status),[scoped,status]);
  const pagination=usePagination('inquiries',rows,`${mine}:${status}:${category}:${query}`);
  const login=()=>{rememberInquiryReturn();location.hash='login';};
  const refresh=()=>setRevision(value=>value+1);
  const remove=async(kind,baseline)=>{
    if(mutation.current||pending.saving||pending.dirty||assigning)return;
    if(!pendingRemoval&&!await confirmAction({kind:'leave',title:kind==='post'?'문의를 목록에서 내릴까요?':'답변을 삭제할까요?',message:kind==='post'?'문의 목록에서 숨깁니다. GHES 이슈와 답변은 보관됩니다.':'삭제한 답변은 복원할 수 없습니다. 달린 답글은 유지됩니다.',confirmLabel:kind==='post'?'목록에서 내리기':'삭제',cancelLabel:'취소'}))return;
    mutation.current=true;setMutating(true);
    try{if(kind==='post'){await client.remove(baseline);setPosts(rows=>rows.filter(row=>row.number!==baseline.number));setDetail(null);await open('list',true);}else{await client.deleteComment(Number(route),baseline);setDetail(value=>({...value,comments:value.comments.filter(row=>row.id!==baseline.id)}));if(replyTo?.id===baseline.id)setReplyTo(null);refresh();}setPendingRemoval(null);refreshInquiryNotifications();notifyToast(kind==='post'?'문의를 목록에서 내렸습니다.':'답변을 삭제했습니다.',{source:'inquiry-change'});}
    catch(error){setPendingRemoval(error.uncertain?{kind,id:baseline.id||baseline.number}:null);notifyToast(error,{source:'inquiry-change',error:true});}
    finally{mutation.current=false;setMutating(false);}
  };
  const changeState=async baseline=>{
    if(mutation.current||pending.saving||pending.dirty||assigning||assignBusy||pendingRemoval||editingComment)return;
    const target=pendingState?.target||(baseline.state==='open'?'completed':'open'),source=pendingState?.baseline||baseline;
    if(!pendingState&&!await confirmAction({title:target==='completed'?'문의를 완료 처리할까요?':'문의를 다시 열까요?',message:target==='completed'?'완료 목록으로 이동합니다. 필요하면 다시 열 수 있습니다.':'진행 중 목록으로 이동합니다.',confirmLabel:target==='completed'?'완료 처리':'다시 열기',cancelLabel:'취소'}))return;
    if(mutation.current)return;mutation.current=true;setMutating(true);
    try{const post=await client.setState(source,target);setDetail(value=>({...value,post}));setPosts(rows=>rows.map(row=>row.number===post.number?{...post,comments:row.comments}:row));setPendingState(null);refreshInquiryNotifications();notifyToast(target==='completed'?'문의를 완료 처리했습니다.':'문의를 다시 열었습니다.',{source:'inquiry-state'});}
    catch(error){setPendingState(error.uncertain?{baseline:source,target}:null);notifyToast(error,{source:'inquiry-state',error:true});}
    finally{mutation.current=false;setMutating(false);}
  };
  const locked=pending.saving||mutating||Boolean(pendingRemoval)||Boolean(pendingState);
  const sidebar=<InquirySidebar id={sidebarId} posts={posts} rows={scoped} pagination={pagination} query={query} setQuery={setQuery} mine={mine} setMine={setMine} status={status} setStatus={setStatus} category={category} setCategory={setCategory} client={client} selected={route} loading={loading} failure={failure} locked={pending.saving||mutating} refreshLocked={pending.dirty||detailLoading||Boolean(pendingRemoval)||Boolean(pendingState)} onRefresh={refresh} onOpen={open} scrollPosition={scrollPosition}/>;
  const pageLayout={sidebar,sidebarId,sidebarCollapsed,onToggleSidebar:()=>setSidebarCollapsed(value=>!value),showList:route==='list'};
  const selected=detail?.post.number===Number(route)?detail:null;
  const commentSaved=comment=>{setSavedCommentId(comment.id);setEditingComment(null);setPending(empty);refresh();refreshInquiryNotifications();};
  return <div className="inquiry-workspace">{editingPost?<ServiceDesk key={`edit-${editingPost.number}`} editing={editingPost} page={editingPost.source} session={client.session} onClose={()=>{setEditingPost(null);setPending(empty);}} onPendingChange={setPending} request={({payload,types})=>client.update(editingPost,{title:payload.title,type:payload.type,body:payload.description},types)} onSaved={post=>{setDetail(value=>({...value,post}));setPosts(rows=>rows.map(row=>row.number===post.number?post:row));setEditingPost(null);setPending(empty);refresh();}} media={media} pageLayout={pageLayout} assignmentClient={assignment}/>:route==='new'?<ServiceDesk page={origin.page} onClose={()=>open('list',true)} onPendingChange={setPending} onSaved={receipt=>{refresh();open(String(receipt.number),true);}} media={media} pageLayout={pageLayout} assignmentClient={assignment}/>:<InquiryPage {...pageLayout} onClose={route==='list'?undefined:()=>open('list')} busy={pending.saving||mutating} actions={<><ActionButton className="inquiry-mobile-refresh" action="refresh" disabled={loading||detailLoading||locked||pending.dirty} onClick={refresh}/><ActionButton action="edit" label="문의하기" disabled={locked} onClick={()=>open('new')}/></>}>
    {selected&&<article className="inquiry-detail"><header className="inquiry-detail-header"><div className="inquiry-feed-meta"><span className={`inquiry-status is-${inquiryStatus(selected.post).key}`}>{inquiryStatus(selected.post).label}</span>{client.signedIn&&inquiryCanChangeState(selected.post,user)&&<ActionButton action={pendingState?'refresh':selected.post.state==='open'?'complete':'undo'} label={pendingState?'처리 결과 확인':selected.post.state==='open'?'문의 완료':'문의 다시 열기'} disabled={pending.saving||mutating||pending.dirty||Boolean(pendingRemoval)||Boolean(editingComment)||assigning||assignBusy||detailLoading||Boolean(detailFailure)} onClick={()=>changeState(selected.post)}/>}<span>{selected.post.type}</span><small>#{selected.post.number}</small>{client.signedIn&&media?.nativeAttachments&&<NativeAttachmentLink number={selected.post.number}/>}<ActionLink action="openExternal" label="GitHub에서 보기" className="inquiry-external-link" href={selected.post.url} target="_blank" rel="noreferrer"/>{client.signedIn&&talkCanManage(selected.post,user,role)&&<><ActionButton action="edit" label="문의 수정" disabled={locked} onClick={async()=>{if(await canLeave()){setEditingComment(null);setReplyTo(null);setPending(empty);setEditingPost(selected.post);}}}/><ActionButton action="delete" label={pendingRemoval?.kind==='post'?'삭제 결과 확인':'문의 내리기'} disabled={pending.saving||mutating||pending.dirty||Boolean(pendingState)||(pendingRemoval&&pendingRemoval.kind!=='post')} onClick={()=>remove('post',selected.post)}/></>}</div><h2 ref={reader} tabIndex={-1}>{selected.post.title}</h2><TalkAuthor user={selected.post.user} time={selected.post.createdAt}/>{(selected.post.assignees.length>0||canAssign)&&<div className="inquiry-assignees"><span>담당자</span>{selected.post.assignees.map(person=><ProfileIdentity key={person.login} user={person}/>)}{canAssign&&<ActionButton action="assign" disabled={locked||pending.dirty} onClick={()=>setAssigning(true)}/>}</div>}</header>
      <TalkContent markdown body={selected.post.body} media={media} profile={client.profile}/>
      <section className="inquiry-answers" aria-label="답변">
        <h3>답변 <span>{selected.comments.length}</span></h3>
        {!editingComment&&(client.signedIn?(selected.post.locked?<p className="admin-note">답변 작성이 잠긴 문의입니다.</p>:<CommentComposer kind="inquiry" replyTo={replyTo} onCancelReply={()=>setReplyTo(null)} key={`new-answer-${selected.post.number}`} number={selected.post.number} client={client} disabled={mutating||Boolean(pendingRemoval)||Boolean(pendingState)} onPending={setPending} onSaved={commentSaved}/>):<ActionButton action="login" label="로그인하고 답변 남기기" onClick={login}/>)}
        <CommentThreadList key={`answers-${selected.post.number}`} comments={selected.comments} revealedCommentId={savedCommentId} locked={Boolean(editingComment)||locked} renderComment={comment=><>
          <div className="talk-comment-head"><TalkAuthor user={comment.user} time={comment.updatedAt} edited={comment.updatedAt!==comment.createdAt}/><div className="inquiry-comment-actions">
            {client.signedIn&&!selected.post.locked&&<ActionButton action="reply" label={`${comment.user.name||comment.user.login} 님에게 답글`} disabled={locked||pending.replyLocked} onClick={()=>setReplyTo(comment)}/>}
            {client.signedIn&&talkCanManage(comment,user,role)&&<><ActionButton action="edit" label="답변 수정" disabled={locked||Boolean(editingComment)} onClick={async()=>{if(await canLeave()){setReplyTo(null);setPending(empty);setEditingComment(comment);}}}/><ActionButton action="delete" label={pendingRemoval?.id===comment.id?'삭제 결과 확인':'답변 삭제'} disabled={pending.saving||mutating||pending.dirty||Boolean(pendingState)||Boolean(editingComment)||Boolean(pendingRemoval&&(pendingRemoval.kind!=='comment'||pendingRemoval.id!==comment.id))} onClick={()=>remove('comment',comment)}/></>}
          </div></div>
          {comment.replyTo&&<p className="comment-reply-caption">@{comment.replyLogin} 님에게 답글{comment.orphaned?' (원댓글 삭제됨)':''}</p>}
          {editingComment?.id===comment.id?<CommentComposer key={`edit-${comment.id}`} kind="inquiry" editing={editingComment} onCancelEdit={()=>{setEditingComment(null);setPending(empty);}} number={selected.post.number} client={client} onPending={setPending} onSaved={commentSaved}/>:<TalkContent markdown body={comment.body} media={media} profile={client.profile}/>}
        </>}/>
      </section>
    </article>}
    <CommunityStatus loading={detailLoading&&!selected} label="문의를 불러오는 중…"/>
    {assigning&&selected&&<InquiryAssignees post={selected.post} client={assignment} onBusy={setAssignBusy} onClose={()=>setAssigning(false)} onSaved={post=>{setDetail(current=>({...current,post}));setPosts(current=>current.map(row=>row.number===post.number?post:row));setAssigning(false);refreshInquiryNotifications();}}/>}
    <CommunityStatus error={detailFailure} className="inquiry-load-error"/>
    {route==='list'&&<div className="inquiry-reader-empty"><Icon name="message" size={28}/><p>문의를 선택하세요</p></div>}
  </InquiryPage>}</div>;
}
