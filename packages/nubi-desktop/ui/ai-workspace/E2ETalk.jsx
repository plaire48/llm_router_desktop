import {agentFeedbackContext,agentFeedbackTag,agentFeedbackDraft,agentFeedbackHash} from './agents/agentModel';
import {TalkTeamNotice,TalkTeamReceipt} from './TalkTeamNotice';
import {skillTalkContext,skillTalkDraft,skillTalkTag,skillTalkHash} from './skills/skillUsage';
import {createTalkTeamNoticeClient} from './talkTeamNotices';
import {CommentComposer} from './CommentComposer';
import {CommentThreadList} from './CommentThreadList';
import {CxSelect} from './CxSelect';
import React,{lazy,Suspense,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {SearchField} from './SearchField';
import {ActionButton,ActionLink} from './ActionButton';
import {NativeAttachmentLink} from './NativeAttachmentLink';
import {CommunityStatus} from './CommunityStatus';
import {Icon} from './Icon';
import {DetailPanel} from './DetailPanel';
import {HelpButton} from './HelpButton';
import {ProfileIdentity} from './AccountProfile';
import {usePagination,TablePagination,PageSizeSelect} from './TableControls';
import {useBeforeUnload} from './useBeforeUnload';
import {confirmAction} from './confirmAction';
import {notifyToast} from './Toast';
import {createDiscussionClient} from './discussionClient';
import {isDiscussionKey,discussionCategoryIcon,discussionCategoryEmoji} from './discussionModel';
import {refreshTalkNotifications} from './talkNotificationRefresh';
import {createTalkMediaClient} from './talkMedia';
import {TALK_LIMITS,talkOwner,talkCanManage,talkModerator,talkPermalink,decodeTalkBody,sortTalkPosts} from './talkModel';
import {talkBase} from './hostFetch.js';
import {sanitizeTalkHtml,markdownToTalkHtml,talkExcerpt} from './talkRichText';
import {relativeNotificationTime} from './notificationTime';
import {TalkContent} from './TalkContent';
export {TalkContent} from './TalkContent';
import './talk.css';
import './community.css';
import './talk-editor.css';
const TalkEditor=lazy(()=>import('./TalkEditor'));
const fullTime=value=>new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const readTarget=()=>{const target=new URLSearchParams(location.hash.slice(1)).get('talk')||'';return /^(?:[a-f\d-]{36}|d?\d+)$/i.test(target)?target:'';};

export function TalkAuthor({user,time,edited=false}) {
  return <div className="talk-author"><ProfileIdentity user={user}/><time dateTime={time} title={fullTime(time)}>{relativeNotificationTime(time,Date.now())}{edited?' 수정':''}</time></div>;
}
const attributeText=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function FeedMedia({items,media,href,onOpen,title,initialIndex=0,onIndexChange}) {
  const [index,setIndex]=useState(initialIndex),touch=useRef(null),swiped=useRef(false),current=Math.min(index,items.length-1),item=items[current];
  if(!item)return null;
  const move=step=>{const next=Math.max(0,Math.min(items.length-1,current+step));setIndex(next);onIndexChange(next);};
  return <figure className="talk-feed-media" aria-label={`${title} 첨부`}>
    <div className="talk-feed-media-stage" onTouchStart={event=>{swiped.current=false;if(item.kind==='image'&&event.touches.length===1)touch.current={x:event.touches[0].clientX,y:event.touches[0].clientY};else touch.current=null;}} onTouchCancel={()=>{touch.current=null;swiped.current=false;}} onTouchEnd={event=>{const start=touch.current;touch.current=null;if(!start)return;const x=event.changedTouches[0].clientX-start.x,y=event.changedTouches[0].clientY-start.y;if(Math.abs(x)>50&&Math.abs(x)>Math.abs(y)){swiped.current=true;move(x<0?1:-1);}}}>
      {item.kind==='image'?<a href={href} onClick={event=>{if(swiped.current){event.preventDefault();swiped.current=false;return;}onOpen(event);}} tabIndex={-1} aria-label={`${title} 글 열기`}><TalkContent separateAttachments={false} key={item.src} body={`<img src="${attributeText(item.src)}" alt="${attributeText(item.alt)}">`} media={media}/></a>:<TalkContent separateAttachments={false} key={item.src} body={`<video src="${attributeText(item.src)}" title="${attributeText(title)}"></video>`} media={media}/>}
    </div>
    {items.length>1&&<figcaption className="talk-feed-media-controls"><ActionButton action="previousMedia" disabled={current===0} onClick={()=>move(-1)}/><span role="status" aria-live="polite" aria-atomic="true" aria-label={`첨부 ${current+1}/${items.length}`}>{current+1}<span aria-hidden="true"> / </span>{items.length}</span><ActionButton action="nextMedia" disabled={current===items.length-1} onClick={()=>move(1)}/></figcaption>}
  </figure>;
}
function TalkFeedItem({post,media,onOpen,onLike,onCopy,reaction,busy,liking,galleryPositions,view}) {
  const card=useRef(null);
  useLayoutEffect(()=>{
    if(view!=='feed')return;
    const element=card.current;
    // Pack unequal image and text cards without fixing their width or height.
    const measure=()=>{const gap=parseFloat(getComputedStyle(element.closest('ol')).rowGap)||0;const span=Math.ceil((element.getBoundingClientRect().height+2+gap)/(4+gap));element.parentElement.style.setProperty('--talk-span',String(span));};
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[view]);
  const excerpt=useMemo(()=>{const parsed=decodeTalkBody(post.body);return talkExcerpt(parsed.html,parsed.format);},[post.body]);
  const href=talkPermalink(talkBase(),post.permalinkId),likes=reaction?.count??post.likes,liked=reaction?.mine??post.viewerHasLiked;
  const navigate=event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();onOpen(post);}};
  return <li className={post.pinned?'is-pinned':''}>
    <article ref={card} className={`talk-feed-item${excerpt.media.length?' has-media':''}`} aria-labelledby={`talk-card-${post.number}`}>
      <header className="talk-feed-card-header"><TalkAuthor user={post.user} time={post.createdAt}/>{post.pinned&&<span className="talk-pin-label" title="상단 고정된 글"><Icon name="pin" size={16}/><span className="visually-hidden">상단 고정된 글</span></span>}</header>
      <div className="talk-preview">
      <FeedMedia key={post.body} items={view==='posts'?excerpt.media.slice(0,1):excerpt.media} media={media} href={href} title={post.title} onOpen={navigate} initialIndex={view==='feed'&&galleryPositions.current.get(post.number)?.body===post.body?galleryPositions.current.get(post.number).index:0} onIndexChange={index=>galleryPositions.current.set(post.number,{body:post.body,index})}/>
      <a className="talk-post-link" data-post-id={post.permalinkId} href={href} onClick={navigate}>
        <div className="talk-title-line"><h2 id={`talk-card-${post.number}`}>{post.title}</h2><DiscussionMeta post={post}/></div>
        {excerpt.text&&<p className="talk-excerpt">{excerpt.text}</p>}
      </a>
      </div>
      <footer className="talk-feed-counts">
        <span className="talk-like-group"><ActionButton action="like" label={liked?'좋아요 취소':'좋아요'} aria-label={`좋아요 ${likes}개${liked?', 취소':''}`} aria-pressed={Boolean(liked)} className={liked?'is-liked':''} busy={liking} disabled={busy} onClick={()=>onLike(post)}/><strong aria-hidden="true">{likes}</strong></span>
        <span className="talk-like-group"><ActionButton action="comment" label={`댓글 ${post.comments}개`} disabled={busy} onClick={()=>onOpen(post,{comments:true})}/><strong aria-hidden="true">{post.comments}</strong></span>
        <ActionButton action="share" label="글 링크 공유" onClick={()=>onCopy(post)}/>
      </footer>
    </article>
  </li>;
}
function DiscussionMeta({post}) {
  return post.category?<div className="discussion-meta">{post.closed&&<span className="discussion-awaiting">종료</span>}<span className="discussion-category" role="img" aria-label={`카테고리: ${post.category.name}`} title={`카테고리: ${post.category.name}`}>{discussionCategoryEmoji(post.category)?<span className="discussion-category-emoji">{discussionCategoryEmoji(post.category)}</span>:<Icon name={discussionCategoryIcon(post.category)} size={14}/>}</span>{post.category.isAnswerable&&<span className={post.isAnswered?'discussion-answer':'discussion-awaiting'}>{post.isAnswered&&<Icon name="check" size={14}/>} {post.isAnswered?'답변 채택':'답변 대기'}</span>}</div>:null;
}
function DiscussionPoll({post,disabled,onVote}) {
  const [selection,setSelection]=useState('');
  const poll=post.poll;if(!poll)return null;
  return <section className="discussion-poll" aria-label="투표"><h3>{poll.question}</h3>
    <fieldset disabled={disabled||!poll.viewerCanVote||post.locked}><legend className="visually-hidden">투표 항목</legend>{poll.options?.nodes?.map(option=>{const ratio=poll.totalVoteCount?Math.round(option.totalVoteCount/poll.totalVoteCount*100):0;return <label key={option.id} className={option.viewerHasVoted?'is-selected':''} style={{'--poll-percent':`${ratio}%`}}><input type="radio" name={`poll-${post.number}`} checked={selection?selection===option.id:option.viewerHasVoted} onChange={()=>setSelection(option.id)}/><span>{option.option}</span><small>{option.totalVoteCount}표</small>{option.viewerHasVoted&&<Icon name="check" size={14}/>}</label>;})}</fieldset>
    <footer><small>{poll.totalVoteCount}명 참여</small>{poll.viewerCanVote&&<ActionButton action="save" label="투표" disabled={disabled||!selection||post.locked} onClick={()=>onVote(selection)}/>}</footer>
  </section>;
}
function LoginPrompt({onClose,intent}) {
  return <DetailPanel title="로그인" variant="modal" className="talk-login-panel" onClose={onClose} helpTopic="talk" footer={<ActionButton action="login" className="cx-button--primary" onClick={()=>{sessionStorage.setItem('e2e-talk:return',location.hash);location.hash='login';}}/>}>
    <div className="talk-login-copy"><Icon name="githubMark" size={28}/><p>{intent==='like'?'좋아요를 누르려면':intent==='comment'?'댓글을 작성하려면':'글을 작성하려면'} 로그인하세요.</p></div>
  </DetailPanel>;
}
function Composer({post,draft,client,media,onClose,onSaved,onPending,agentContext}) {
  const native=client.backend==='discussions'&&(!post||post.source==='discussion');
  const [categories,setCategories]=useState([]),[categoryId,setCategoryId]=useState(post?.category?.id||''),[categoryError,setCategoryError]=useState(''),[categoryLoading,setCategoryLoading]=useState(native),[categoryRevision,setCategoryRevision]=useState(0);
  useEffect(()=>{if(!native)return;let live=true;setCategoryLoading(true);setCategoryError('');client.categories().then(rows=>{if(live)setCategories(rows);}).catch(error=>{if(live)setCategoryError(error.message);}).finally(()=>{if(live)setCategoryLoading(false);});return()=>{live=false;};},[client,native,categoryRevision]);
  const parsed=post?decodeTalkBody(post.body):null;
  const agentId=agentContext?.id||/<!-- ai-workspace-agent:([a-f\d-]{36}) -->/i.exec(post?.body||'')?.[1];
  const [id]=useState(()=>parsed?.id||crypto.randomUUID()),[title,setTitle]=useState(post?.title||draft?.title||'');
  const [initialHtml]=useState(()=>parsed?(parsed.format==='markdown'?markdownToTalkHtml(parsed.html):sanitizeTalkHtml(parsed.html)):sanitizeTalkHtml(draft?.html||''));
  const [html,setHtml]=useState(initialHtml),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const api=useRef(null),titleField=useRef(null),[errorField,setErrorField]=useState(''),dirty=title!==(post?.title||'')||html!==initialHtml||categoryId!==(post?.category?.id||'');
  const leaveMessage=uncertain?'저장 여부를 확인하지 못했습니다.\n내 글에서 확인한 뒤 다시 작성하세요.':'저장하지 않은 내용은 사라집니다.';
  useBeforeUnload(dirty||busy||uploading);
  useEffect(()=>{onPending({dirty,saving:busy||uploading,leaveMessage});return()=>onPending({dirty:false,saving:false});},[dirty,busy,uploading,leaveMessage,onPending]);
  const close=async()=>{if(busy||uploading)return;if(dirty&&!await confirmAction({kind:'leave',title:'작성을 그만둘까요?',message:leaveMessage,confirmLabel:'작성 취소',cancelLabel:'계속 작성'}))return;onClose();};
  const save=async()=>{
    if(busy||uploading)return;
    if(post&&!dirty&&!uncertain){notifyToast('변경 사항이 없습니다.',{source:'talk'});return;}
    if(native&&!categoryId){setError('카테고리를 선택하세요.');setErrorField('category');document.getElementById('talk-compose-category')?.focus();return;}
    const body=api.current?.getHtml()||html,text=talkExcerpt(body).text;
    if(!title.trim()){setError('제목을 입력하세요.');setErrorField('title');titleField.current?.focus();return;}if(!text&&!/<(img|video)\b/i.test(body)){setError('본문을 입력하세요.');setErrorField('body');api.current?.focus();return;}
    if(body.length>TALK_LIMITS.body){setError('본문이 너무 깁니다. 내용을 나누어 등록하세요.');setErrorField('body');api.current?.focus();return;}
    const marker=agentId?`\n\n<!-- ai-workspace-agent:${agentId} -->`:'',clean=value=>String(value||'').replace(/<!-- ai-workspace-agent:[a-f\d-]{36} -->/gi,'').trim(),content={title,html:clean(body)+marker,markdown:clean(api.current?.getMarkdown())+marker,categoryId,id};
    setBusy(true);setError('');setErrorField('');try{const saved=post?await client.update(post,content):await client.create(content);onPending({dirty:false,saving:false});onSaved(saved);refreshTalkNotifications();notifyToast(post?'글을 수정했습니다.':'글을 등록했습니다.',{source:'talk'});}catch(e){setUncertain(Boolean(e.uncertain));notifyToast(e,{source:'talk-save',error:true});}finally{setBusy(false);}
  };
  return <section className="talk-compose-page" aria-labelledby="talk-compose-heading">
    <header className="talk-compose-heading"><div className="talk-compose-heading-title"><ActionButton action="back" label="돌아가기" disabled={busy||uploading} onClick={close}/><h1 id="talk-compose-heading">{post?'글 수정':'글쓰기'}</h1><HelpButton initialTopic="talk"/></div><ActionButton action="save" label={uncertain?'결과 확인':post?'저장':'등록'} busy={busy} disabled={uploading||(native&&(categoryLoading||Boolean(categoryError)))} onClick={save}/></header>
    <div className="talk-compose-surface">
    {native&&<div className="talk-compose-category"><label htmlFor="talk-compose-category">카테고리</label><CxSelect id="talk-compose-category" className="native-select" aria-label="글 카테고리" aria-invalid={errorField==='category'||undefined} aria-describedby={errorField==='category'?'talk-compose-error':undefined} value={categoryId} disabled={busy||uncertain||categoryLoading||Boolean(categoryError)} onChange={event=>{setCategoryId(event.target.value);if(errorField==='category'){setError('');setErrorField('');}}}><option value="">{categoryLoading?'불러오는 중…':'선택'}</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</CxSelect>{categories.find(category=>category.id===categoryId)?.isAnswerable&&<span className="discussion-category-note"><Icon name="check" size={14}/>답변 채택 가능</span>}{categoryError&&<><span role="alert" className="field-error">{categoryError}</span><ActionButton action="refresh" label="카테고리 다시 불러오기" disabled={busy||uploading||uncertain} onClick={()=>setCategoryRevision(value=>value+1)}/></>}</div>}
    <label className="talk-title-field"><span className="visually-hidden">제목</span><input ref={titleField} className="text-input community-compose-title" aria-label="글 제목" aria-invalid={errorField==='title'||undefined} aria-describedby={errorField==='title'?'talk-compose-error':undefined} placeholder="제목을 입력하세요" maxLength={TALK_LIMITS.title} value={title} disabled={busy||uploading||uncertain} onChange={e=>{setTitle(e.target.value);if(errorField==='title'){setError('');setErrorField('');}}}/></label>
    <Suspense fallback={<p role="status">편집기를 불러오는 중…</p>}><TalkEditor githubFormat={native} invalid={errorField==='body'} describedBy={errorField==='body'?'talk-compose-error':undefined} ref={api} initialValue={initialHtml} onChange={value=>{setHtml(value);if(errorField==='body'){setError('');setErrorField('');}}} onBusy={setUploading} upload={file=>media.upload(file,id)} loadMedia={url=>media.storedPath(url)?media.load(url):Promise.resolve(null)} mentionItems={client.mentionItems} profile={client.profile} media={media} disabled={busy||uncertain}/></Suspense>
    {error&&<p id="talk-compose-error" role="alert" className="talk-form-error">{error}</p>}
    </div>
  </section>;
}
const ignorePending=()=>{};
export default function E2ETalk({user,role='user',onPendingChange=ignorePending,client:suppliedClient,media:suppliedMedia,teamNotices:suppliedTeamNotices}) {
  const [agentContext]=useState(()=>agentFeedbackContext(location.hash));
  const [skillContext]=useState(()=>skillTalkContext(location.hash));
  const roleRef=useRef(role);roleRef.current=role;
  const feedRef=useRef(null),feedPosition=useRef(null),galleryPositions=useRef(new Map()),postHeading=useRef(null),commentHeading=useRef(null),focusComments=useRef(false),feedLikeLock=useRef(false),mutationLock=useRef(false),searchField=useRef(null);
  const [clientState]=useState(()=>{try{const client=suppliedClient||createDiscussionClient({role:()=>roleRef.current});return {client,media:suppliedMedia||createTalkMediaClient({session:client.session})};}catch(error){return {error:error.message};}});
  const {client,media}=clientState;
  const [teamNotices]=useState(()=>suppliedTeamNotices||createTalkTeamNoticeClient({session:client?.session,config:client?.config,role:()=>roleRef.current,discussionClient:client?.backend==='discussions'?client:null})),[teamNoticeOpen,setTeamNoticeOpen]=useState(false);

  const [posts,setPosts]=useState([]),[loading,setLoading]=useState(true),[listRevision,setListRevision]=useState(0),[error,setError]=useState(clientState.error||''),[query,setQuery]=useState(()=>skillContext?skillTalkTag(skillContext.name):''),[sort,setSort]=useState('latest'),[mine,setMine]=useState(false);
  const [categories,setCategories]=useState([]),[category,setCategory]=useState(''),[answerFilter,setAnswerFilter]=useState(''),[listWarning,setListWarning]=useState('');
  const [view,setView]=useState(()=>{try{return localStorage.getItem('e2e:talk-view')==='feed'?'feed':'posts';}catch{return 'posts';}});
  const chooseView=value=>{setView(value);try{localStorage.setItem('e2e:talk-view',value);}catch{/* Keep the choice for this visit. */}};
  const [feedReactions,setFeedReactions]=useState({}),[liking,setLiking]=useState(null);
  const [moderation,setModeration]=useState({moderate:false,manageContent:false});
  const [target,setTarget]=useState(readTarget),[active,setActive]=useState(null),[comments,setComments]=useState([]),[reaction,setReaction]=useState({count:0,mine:null}),[busy,setBusy]=useState(false);
  useEffect(()=>setTeamNoticeOpen(false),[role,active?.number]);
  const [editingComment,setEditingComment]=useState(null);
  const [savedCommentId,setSavedCommentId]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('comment')),[replyTo,setReplyTo]=useState(null);useEffect(()=>{setReplyTo(null);setEditingComment(null);},[active?.number]);
  const [compose,setCompose]=useState(null),[login,setLogin]=useState(false),[pending,setPending]=useState({dirty:false,saving:false});
  const sequence=useRef(0),mounted=useRef(true),[reload,setReload]=useState(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;};},[]);
  useEffect(()=>{
    let disposed=false;setModeration({moderate:false,manageContent:false});
    if(client?.signedIn&&talkModerator(role))client.capabilities?.().then(value=>{if(!disposed)setModeration(value);}).catch(()=>{});
    return()=>{disposed=true;};
  },[client,role,reload]);
  useEffect(()=>{onPendingChange({...pending,saving:pending.saving||busy});return()=>onPendingChange({dirty:false,saving:false});},[pending,busy,onPendingChange]);
  const filtered=useMemo(()=>sortTalkPosts(posts.filter(post=>(!agentContext||post.body.includes(agentFeedbackTag(agentContext.id)))&&(!category||post.category?.id===category)&&(!answerFilter||(post.category?.isAnswerable&&(answerFilter==='answered'?post.isAnswered:!post.isAnswered)))),{query,sort,mine:mine?user?.id:null}),[posts,query,sort,mine,user?.id,category,answerFilter,agentContext]);
  const pagination=usePagination('talk',filtered,`${query}:${sort}:${mine}:${category}:${answerFilter}`);
  useLayoutEffect(()=>{if(feedRef.current)feedRef.current.scrollTop=0;},[pagination.page,pagination.size,query,sort,mine,view]);
  useLayoutEffect(()=>{
    if(!target&&!compose&&feedRef.current&&feedPosition.current){
      const {top,id}=feedPosition.current;feedPosition.current=null;feedRef.current.scrollTop=top;
      [...feedRef.current.querySelectorAll('[data-post-id]')].find(link=>link.dataset.postId===id)?.focus({preventScroll:true});
    }
  },[target,compose]);
  useEffect(()=>{if(active&&!compose){const heading=focusComments.current?commentHeading.current:postHeading.current;heading?.focus({preventScroll:true});if(focusComments.current)heading?.scrollIntoView({block:'start'});focusComments.current=false;}},[active?.number,compose]);
  const selectedNumber=isDiscussionKey(target)?target:/^\d+$/.test(target)?Number(target):posts.find(post=>String(post.permalinkId)===target)?.number;
  useEffect(()=>{
    if(!client){setLoading(false);return;}let disposed=false;setLoading(true);setError('');
    client.list().then(items=>{if(!disposed){setPosts(items);setCategories([...new Map(items.filter(post=>post.category).map(post=>[post.category.id,post.category])).values()]);setListWarning(client.warnings?.().join(' ')||'');setFeedReactions({});setListRevision(value=>value+1);}}).catch(e=>{if(!disposed)setError(e.message);}).finally(()=>{if(!disposed)setLoading(false);});return()=>{disposed=true;};
  },[client,reload]);
  useEffect(()=>{
    if(!client||!target||!listRevision)return;const number=selectedNumber;
    if(!number){setError('글을 찾을 수 없습니다. 삭제되거나 내려간 글일 수 있습니다.');return;}
    const seq=++sequence.current;setLoading(true);setError('');setActive(null);setComments([]);
    client.detail(number).then(async value=>{if(seq!==sequence.current)return;setActive(value.post);setComments(value.comments);
      const legacyComments=value.comments.filter(row=>row.source!=='discussion'&&row.likes>0);
      for(let offset=0;offset<legacyComments.length;offset+=4){
        const states=await Promise.all(legacyComments.slice(offset,offset+4).map(async row=>{try{return {id:row.id,...await client.commentReactions(number,row.id)};}catch{return null;}}));
        if(seq!==sequence.current)return;
        setComments(current=>current.map(row=>{const state=states.find(state=>state?.id===row.id);return state?{...row,likes:state.count,viewerHasLiked:Boolean(state.mine)}:row;}));
      }
      setReaction({count:value.post.likes,mine:null});if(client.signedIn){try{const reactions=await client.reactions(number);if(seq===sequence.current)setReaction(reactions);}catch(e){if(seq===sequence.current)notifyToast(e,{source:'talk-likes',error:true});}}}).catch(e=>{if(seq===sequence.current)setError(e.message);}).finally(()=>{if(seq===sequence.current)setLoading(false);});
  },[client,target,selectedNumber,listRevision]);
  const authenticated=(intent='write')=>{if(!user?.login||!client?.signedIn){setLogin(intent);return false;}return true;};
  const open=async (post,options={})=>{if(pending.saving||busy)return;if(pending.dirty&&!await confirmAction({kind:'leave',...(pending.leaveMessage?{message:pending.leaveMessage}:{})}))return;focusComments.current=Boolean(options.comments);sequence.current++;if(active)setFeedReactions(current=>({...current,[active.number]:reaction}));if(post&&feedRef.current)feedPosition.current={top:feedRef.current.scrollTop,id:String(post.permalinkId)};if(active)setPosts(current=>current.map(item=>item.number===active.number?{...active,comments:comments.length,likes:reaction.count}:item));setActive(null);setEditingComment(null);setPending({dirty:false,saving:false});setTarget(post?String(post.permalinkId):'');setError('');history.replaceState(null,'',post?talkPermalink(talkBase(),post.permalinkId):new URL(agentContext?agentFeedbackHash({id:agentContext.id,title:agentContext.title}):skillContext?skillTalkHash(skillContext):'#talk',location.href));};
  const beginCompose=async()=>{if(!authenticated()||pending.saving||busy)return;if(pending.dirty&&!await confirmAction({kind:'leave',...(pending.leaveMessage?{message:pending.leaveMessage}:{})}))return;if(feedRef.current)feedPosition.current={top:feedRef.current.scrollTop};setPending({dirty:false,saving:false});setCompose({draft:agentContext?agentFeedbackDraft(agentContext):query===(skillContext?skillTalkTag(skillContext.name):'')?skillTalkDraft(skillContext):null});};
  const replacePost=saved=>{setPosts(current=>current.map(post=>post.number===saved.number?saved:post));setActive(saved);};
  const mutate=async action=>{if(mutationLock.current)return;mutationLock.current=true;setBusy(true);try{await action();}catch(e){notifyToast(e,{source:'talk',error:true});}finally{mutationLock.current=false;if(mounted.current)setBusy(false);}};
  const likePost=post=>{
    if(busy||feedLikeLock.current||!authenticated('like'))return;
    feedLikeLock.current=true;setLiking(post.number);
    mutate(async()=>{try{
      const current=feedReactions[post.number]||(typeof post.viewerHasLiked==='boolean'?{mine:post.viewerHasLiked}:await client.reactions(post.number));
      const next=await client.like(post.number,current?!current.mine:true);
      if(!mounted.current)return;
      setFeedReactions(values=>({...values,[post.number]:next}));refreshTalkNotifications();
      setPosts(values=>values.map(value=>value.number===post.number?{...value,likes:next.count}:value));
    }finally{feedLikeLock.current=false;if(mounted.current)setLiking(null);}});
  };
  const copy=async post=>{try{await navigator.clipboard.writeText(talkPermalink(talkBase(),post.permalinkId));notifyToast('글 링크를 복사했습니다.',{source:'talk'});}catch{notifyToast('링크를 복사하지 못했습니다. 주소창에서 복사하세요.',{source:'talk',error:true});}};
  const loadStatus=<CommunityStatus loading={loading} error={error} className={`talk-load-status${error?' talk-error':''}`}/>;
  if(compose&&client)return <Composer key={compose.post?.number||'new'} post={compose.post} agentContext={agentContext} draft={compose.draft} client={client} media={media} onClose={()=>setCompose(null)} onPending={setPending} onSaved={saved=>{setCompose(null);setActive(saved);setPending({dirty:false,saving:false});setPosts(current=>[saved,...current.filter(post=>post.number!==saved.number)]);setTarget(String(saved.permalinkId));history.replaceState(null,'',talkPermalink(location.href,saved.permalinkId));}}/>;
  return <div className={`talk-workspace${target?' is-reading':''}`}>
    <header className="talk-heading"><div className="talk-title">{target?<ActionButton action="back" onClick={()=>open(null)} disabled={busy||pending.saving}/>:<Icon name="message" size={24}/>}<h1>AI Talk</h1>{agentContext&&<span className="talk-context-label">{agentContext.title} 개선 의견</span>}<HelpButton initialTopic="talk"/></div><div className="talk-heading-actions"><ActionButton action="refresh" busy={loading} disabled={busy||pending.dirty} onClick={()=>setReload(value=>value+1)}/><ActionButton action="edit" label="글쓰기" disabled={busy||!client} onClick={beginCompose}/></div></header>
    {target?<>{loadStatus}
      {active&&<article className={`talk-post${active.pinned?' is-pinned':''}`}>
        <header className="talk-post-header"><div className="talk-title-line">{active.pinned&&<span className="talk-pin-label"><Icon name="pin" size={15}/><span className="visually-hidden">상단 고정된 글</span></span>}<h2 ref={postHeading} tabIndex={-1}>{active.title}</h2><DiscussionMeta post={active}/></div><div className="talk-post-meta"><TalkAuthor user={active.user} time={active.updatedAt} edited={active.updatedAt!==active.createdAt}/><div className="talk-post-tools">{active.source==='discussion'&&<ActionLink action="openExternal" label="GHES에서 보기" href={client.nativeUrl(active.number)} target="_blank" rel="noopener noreferrer"/>}{client?.signedIn&&media?.nativeAttachments&&<NativeAttachmentLink number={active.number} kind="talk"/>}<ActionButton action="share" label="글 링크 공유" onClick={()=>copy(active)}/>{client?.signedIn&&talkModerator(role)&&moderation.moderate&&<ActionButton action="teamNotify" disabled={busy||pending.dirty} onClick={event=>{event.currentTarget.focus();setTeamNoticeOpen(true);}}/>}{client?.signedIn&&(active.source==='discussion'?moderation.manageContent:moderation.moderate)&&<ActionButton action="pin" label={active.pinned?'상단 고정 해제':'상단 고정'} aria-pressed={active.pinned} disabled={busy||pending.dirty} onClick={()=>mutate(async()=>{replacePost(await client.pin(active,!active.pinned));if(!active.pinned){pagination.setPage(1);feedPosition.current=null;}notifyToast(active.pinned?'상단 고정을 해제했습니다.':'글을 상단에 고정했습니다.',{source:'talk'});})}/>} {client?.signedIn&&talkCanManage(active,user,role)&&<ActionButton action="edit" disabled={busy||pending.dirty||(active.source==='discussion'?!active.canUpdate:!talkOwner(active,user)&&!moderation.manageContent)} onClick={()=>setCompose({post:active})}/>} {client?.signedIn&&talkCanManage(active,user,role)&&<ActionButton action="delete" label={active.source==='discussion'?'글 삭제':'글 내리기'} disabled={busy||pending.dirty||(active.source==='discussion'?!active.canDelete:!talkOwner(active,user)&&!moderation.moderate)} onClick={async()=>{if(await confirmAction({kind:'leave',title:active.source==='discussion'?'글을 삭제할까요?':'글을 내릴까요?',message:active.source==='discussion'?'글과 댓글을 삭제합니다. 삭제 후 복원할 수 없습니다.':'목록에서 숨깁니다. GitHub 이슈에는 내용이 남습니다.',confirmLabel:active.source==='discussion'?'삭제':'글 내리기',cancelLabel:'유지'}))mutate(async()=>{const saved=await client.remove(active);setPosts(current=>current.filter(post=>post.number!==saved.number));await open(null);notifyToast(active.source==='discussion'?'글을 삭제했습니다.':'글을 내렸습니다.',{source:'talk'});refreshTalkNotifications();});}}/>}</div></div></header>
        <TalkContent body={decodeTalkBody(active.body).html} markdown={decodeTalkBody(active.body).format==='markdown'} media={media} profile={client.profile}/>
        <DiscussionPoll key={active.poll?.id} post={active} disabled={busy||pending.dirty} onVote={option=>mutate(async()=>{replacePost(await client.vote(active.number,option));notifyToast('투표를 반영했습니다.',{source:'talk'});})}/><div className="talk-reactions"><div className="talk-like-group"><ActionButton action="like" label={reaction.mine?"좋아요 취소":"좋아요"} aria-label={`좋아요 ${reaction.count}개${reaction.mine?", 취소":""}`} className={`talk-like${reaction.mine?' is-liked':''}`} aria-pressed={Boolean(reaction.mine)} disabled={busy} onClick={()=>{if(authenticated('like'))mutate(async()=>{const next=await client.like(active.number,!reaction.mine);setReaction(next);refreshTalkNotifications();});}}/><strong aria-hidden="true">{reaction.count}</strong></div><span className="talk-comment-count" aria-label={`댓글 ${comments.length}개`}><Icon name="message" size={18}/>{comments.length}</span></div>
        {active.locked&&<p className="discussion-locked">잠긴 글입니다. 새 댓글을 작성할 수 없습니다.</p>}<section className="talk-comments" aria-labelledby="talk-comments-title"><h3 id="talk-comments-title" tabIndex={-1} ref={commentHeading}>댓글 <span>{comments.length}</span></h3>
          {user?.login&&client?.signedIn?<CommentComposer media={media} replyTo={replyTo} onCancelReply={()=>setReplyTo(null)} key={`new-comment-${active.number}-${editingComment?.id||'new'}`} client={client} number={active.number} onPending={setPending} editing={editingComment} onCancelEdit={()=>setEditingComment(null)} disabled={active.locked} onSaved={comment=>{setEditingComment(null);setSavedCommentId(comment.id);setComments(current=>current.some(c=>c.id===comment.id)?current.map(row=>row.id===comment.id?comment:row):[...current,comment]);refreshTalkNotifications();}}/>:<ActionButton action="login" label="로그인하고 댓글 남기기" className="talk-comment-login" onClick={()=>setLogin('comment')}/>}
          <CommentThreadList key={`comments-${active.number}`} comments={comments} popularThreshold={10} revealedCommentId={savedCommentId} renderComment={comment=><><div className="talk-comment-head"><TalkAuthor user={comment.user} time={comment.updatedAt} edited={comment.createdAt!==comment.updatedAt}/>{comment.isAnswer&&<span className="discussion-answer" title="채택한 답변" aria-label="채택한 답변"><Icon name="check" size={14}/></span>}{client?.signedIn&&comment.source==='discussion'&&talkCanManage(comment,user,role)&&<ActionButton action="edit" label="댓글 수정" disabled={busy||pending.dirty||active.locked||!comment.canUpdate} onClick={()=>{setReplyTo(null);setEditingComment(comment);}}/>}{client?.signedIn&&(comment.isAnswer?comment.canUnmarkAnswer:comment.canMarkAnswer)&&<ActionButton action="complete" label={comment.isAnswer?'답변 채택 해제':'답변 채택'} aria-pressed={comment.isAnswer} disabled={busy||pending.dirty} onClick={()=>mutate(async()=>{const result=await client.answer(active,comment,!comment.isAnswer);replacePost(result.post);setComments(result.comments);refreshTalkNotifications();notifyToast(comment.isAnswer?'답변 채택을 해제했습니다.':'답변을 채택했습니다.',{source:'talk'});})}/>} {client?.signedIn&&<ActionButton action="reply" label={`${comment.user.name||comment.user.login} 님에게 답글`} disabled={busy||pending.replyLocked||active.locked} onClick={()=>setReplyTo(comment)}/>} {client?.signedIn&&talkCanManage(comment,user,role)&&<ActionButton action="delete" label="댓글 삭제" disabled={busy||(comment.source==='discussion'?!comment.canDelete:!talkOwner(comment,user)&&!moderation.manageContent)} onClick={async()=>{if(await confirmAction({kind:'leave',title:'댓글을 삭제할까요?',message:'삭제한 댓글은 복원할 수 없습니다.',confirmLabel:'삭제',cancelLabel:'유지'}))mutate(async()=>{await client.deleteComment(comment);if(comment.source==='discussion'){const result=await client.detail(active.number);replacePost(result.post);setComments(result.comments);}else setComments(current=>current.filter(c=>c.id!==comment.id));if(editingComment?.id===comment.id)setEditingComment(null);refreshTalkNotifications();notifyToast('댓글을 삭제했습니다.',{source:'talk'});});}}/>}</div>{comment.replyTo&&<p className="comment-reply-caption">@{comment.replyLogin} 님에게 답글{comment.orphaned?' (원댓글 삭제됨)':''}</p>}<TalkTeamReceipt body={comment.body}><TalkContent body={comment.body} markdown media={media} profile={client.profile}/></TalkTeamReceipt><div className="talk-comment-reactions"><ActionButton action="like" label={comment.viewerHasLiked?'댓글 좋아요 취소':'댓글 좋아요'} aria-label={`댓글 좋아요 ${comment.likes||0}개${comment.viewerHasLiked?', 취소':''}`} aria-pressed={Boolean(comment.viewerHasLiked)} className={comment.viewerHasLiked?'is-liked':''} disabled={busy||(comment.source==='discussion'&&!comment.canReact)} onClick={()=>{if(authenticated('like'))mutate(async()=>{const current=await client.commentReactions(active.number,comment.id),next=await client.likeComment(active.number,comment.id,!current.mine);setComments(rows=>rows.map(row=>row.id===comment.id?{...row,likes:next.count,viewerHasLiked:Boolean(next.mine)}:row));refreshTalkNotifications();});}}/><span aria-hidden="true">{comment.likes||0}</span></div></>}/>
        </section>
      </article>}
    </>:<div className="talk-board"><div className="talk-toolbar"><div className="talk-filter-tools"><SearchField className="talk-search" id="talk-search-input" ref={searchField} label="글 검색" placeholder="글, 작성자 검색" value={query} onChange={setQuery}/>{user?.login&&<ActionButton action="myPosts" label="내 글만 보기" aria-pressed={mine} onClick={()=>setMine(value=>!value)}/>}<CxSelect className="native-select talk-sort" aria-label="글 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="latest">최신순</option><option value="popular">좋아요순</option></CxSelect>{client?.backend==='discussions'&&<><CxSelect className="native-select talk-category-filter" aria-label="카테고리 필터" value={category} onChange={event=>{setCategory(event.target.value);setAnswerFilter('');}}><option value="">모든 카테고리</option>{categories.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</CxSelect>{(!category||categories.find(row=>row.id===category)?.isAnswerable)&&<CxSelect className="native-select talk-answer-filter" aria-label="답변 상태" value={answerFilter} onChange={event=>setAnswerFilter(event.target.value)}><option value="">답변 상태</option><option value="unanswered">답변 대기</option><option value="answered">답변 채택</option></CxSelect>}</>}<PageSizeSelect pagination={pagination}/></div><div className="talk-view-toggle" role="group" aria-label="글 보기 방식"><ActionButton action="postsView" aria-pressed={view==='posts'} onClick={()=>chooseView('posts')}/><ActionButton action="feedView" aria-pressed={view==='feed'} onClick={()=>chooseView('feed')}/></div></div>
      <section ref={feedRef} className={`talk-feed is-${view}`} aria-label="글 목록" aria-busy={loading}>{loadStatus}{listWarning&&<p role="status" className="discussion-locked">{listWarning}</p>}<ol>{pagination.rows.map(post=><TalkFeedItem view={view} key={`${post.number}:${view}`} post={post} media={media} onOpen={open} onLike={likePost} onCopy={copy} reaction={feedReactions[post.number]} busy={busy} liking={liking===post.number} galleryPositions={galleryPositions}/>)}</ol>
        {!loading&&!error&&!filtered.length&&<div className="talk-empty"><Icon name={query||category||answerFilter?'search':'message'} size={32}/><p>{query||category||answerFilter?'검색 결과가 없습니다.':mine?'작성한 글이 없습니다.':'첫 이야기를 남겨보세요.'}</p>{query||category||answerFilter?<ActionButton action="clearFilters" label="검색 조건 해제" onClick={()=>{setQuery('');setMine(false);setCategory('');setAnswerFilter('');searchField.current?.focus();}}/>:<ActionButton action="edit" label="글쓰기" onClick={beginCompose}/>}</div>}
      </section>{!error&&filtered.length>0&&<TablePagination pagination={pagination}/>}
    </div>}
    {teamNoticeOpen&&active&&talkModerator(role)&&<TalkTeamNotice post={active} client={teamNotices} onClose={()=>setTeamNoticeOpen(false)} onSent={()=>setReload(value=>value+1)}/>}
    {login&&<LoginPrompt intent={login} onClose={()=>setLogin(false)}/>}
  </div>;
}
