import React,{createContext,useContext,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import DOMPurify from 'dompurify';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {CxSelect} from './WorkspaceSelect.jsx';
import {CompanySkillSignIn} from './CompanySkillSignIn.jsx';
import './workspace-community.css';
import {LoadingNote} from './LoadingNote.jsx';
const errors={community_disabled:'저장소에서 Discussions를 켜야 Talk를 사용할 수 있어요.',community_graphql:'Discussions 접근 권한과 GitHub App의 읽기 및 쓰기 권한을 확인해 주세요.',community_pending:'게시 여부를 확인하고 있어요. 다시 보내기 전에 확인해 주세요.',community_locked:'댓글 작성이 잠긴 글이에요.',community_input:'제목, 내용과 카테고리를 확인해 주세요.',community_changed:'저장소 내용이 바뀌었어요. 새로고침해 주세요.',community_missing:'글 또는 앱을 찾지 못했어요.',community_storage:'작성 기록을 보관하지 못했어요. 저장 공간을 확인해 주세요.'};
const errorText=e=>errors[e.message]||'사내망 연결과 GitHub 접근 권한을 확인해 주세요.';
const loginNeeded=e=>/ghes_(login_required|session_expired|session_changed)/.test(e?.message||'');
const date=value=>{const d=new Date(value);return Number.isFinite(+d)?d.toLocaleString('ko-KR',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'';};
// Same wording as ai_workspace notificationTime.js: people read "3일 전" faster than a timestamp (user decision 2026-10-14).
import {relativeTime} from './relative-time.js';export {relativeTime};
const iconCache=new Map();
const toBase64=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
// Port of ai_workspace importWorkspaceImage: ICO passes through, any other image becomes a 64px PNG.
async function importIcon(file){
 if(!file?.size||file.size>5*1024*1024)throw Error('이미지는 5MB 이하로 선택하세요.');
 if(/\.ico$/i.test(file.name||'')||['image/x-icon','image/vnd.microsoft.icon'].includes(file.type)){if(file.size>128*1024)throw Error('ICO 아이콘은 128KB 이하로 선택하세요.');const content=toBase64(new Uint8Array(await file.arrayBuffer()));return {content,preview:'data:image/x-icon;base64,'+content};}
 if(file.type&&!file.type.startsWith('image/'))throw Error('이미지 파일을 선택하세요.');
 const source=URL.createObjectURL(file);
 try{const image=new Image();image.decoding='async';await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('이미지를 읽지 못했어요. 다른 파일을 선택하세요.'));image.src=source;});
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>8192||image.naturalHeight>8192)throw Error('가로와 세로 8,192px 이하의 이미지를 선택하세요.');
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');if(!context)throw Error('이미지를 준비하지 못했어요.');
  const scale=Math.min(64/image.naturalWidth,64/image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale;context.drawImage(image,(64-width)/2,(64-height)/2,width,height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('이미지를 준비하지 못했어요.');
  const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length>128*1024)throw Error('아이콘은 128KB 이하여야 해요.');const content=toBase64(bytes);return {content,preview:'data:image/png;base64,'+content};
 }finally{URL.revokeObjectURL(source);}
}
// GHES avatars are protected; the host reads them through the SSO session and hands back image bytes, and the
// same lookup fills the hover card (user request 2026-10-14). Results are shared across the Talk screens.
const PeopleContext=createContext(null);
const people=new Map();
function usePerson(api,login){
 const [value,setValue]=useState(()=>login?people.get(login.toLowerCase())?.value||null:null);
 useEffect(()=>{if(!login)return;const key=login.toLowerCase(),known=people.get(key);let live=true;
  if(known?.value){setValue(known.value);return;}
  const pending=known?.pending||api('workspaceCommunity',{action:'person',login}).then(v=>{const entry={value:v&&typeof v==='object'&&v.login?v:null};people.set(key,entry);return entry.value;}).catch(()=>{people.delete(key);return null;});
  if(!known)people.set(key,{pending});
  pending.then(v=>{if(live)setValue(v);});return()=>{live=false;};},[api,login]);
 return value;
}
function Avatar({person,profile,size}){const [failed,setFailed]=useState(false);const src=profile?.avatar||person?.avatarUrl||null;useEffect(()=>setFailed(false),[src]);const initials=String(profile?.name||person?.name||person?.login||'?').trim().slice(0,2).toUpperCase();return <span className="nubi-talk-avatar" data-size={size} aria-hidden="true">{src&&!failed?<img src={src} alt="" onError={()=>setFailed(true)}/>:initials}</span>;}
function PersonCard({person,profile,anchor,id}){
 const [position,setPosition]=useState(null),card=useRef(null);
 useLayoutEffect(()=>{const place=()=>{const box=anchor.current?.getBoundingClientRect();if(!box)return;const width=Math.min(300,window.innerWidth-24),height=card.current?.getBoundingClientRect().height||140;const top=box.bottom+8+height<=window.innerHeight?box.bottom+8:Math.max(12,box.top-height-8);setPosition({left:Math.max(12,Math.min(box.left,window.innerWidth-width-12)),top,width});};place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};},[anchor]);
 const name=profile?.name||person?.name||person?.login||'사용자',login=profile?.login||person?.login||'',email=profile?.email||person?.email||null;
 return createPortal(<div id={id} role="tooltip" ref={card} className="nubi-person-card" style={position||{visibility:'hidden'}}>
  <div className="nubi-person-card-head"><Avatar person={person} profile={profile} size="lg"/><div><strong>{name}</strong>{login&&login!==name&&<small>@{login}</small>}</div></div>
  {(email||profile?.company||profile?.location)&&<dl>{email&&<div><dt><Icon name="mail" size={14}/><span className="visually-hidden">이메일</span></dt><dd>{email}</dd></div>}{profile?.company&&<div><dt><Icon name="organization" size={14}/><span className="visually-hidden">소속</span></dt><dd>{profile.company}</dd></div>}{profile?.location&&<div><dt><Icon name="pin" size={14}/><span className="visually-hidden">위치</span></dt><dd>{profile.location}</dd></div>}</dl>}
  {profile===null&&!email&&<LoadingNote size={18}>프로필을 읽는 중</LoadingNote>}
 </div>,document.body);
}
function AppIcon({api,item}){
 const [src,setSrc]=useState(()=>item.icon?iconCache.get(item.icon.hash)||null:null);
 useEffect(()=>{let live=true;if(!item.icon){setSrc(null);return;}const cached=iconCache.get(item.icon.hash);if(cached){setSrc(cached);return;}api('workspaceCommunity',{action:'appIcon',id:item.id}).then(v=>{if(live&&v?.dataUrl){iconCache.set(item.icon.hash,v.dataUrl);setSrc(v.dataUrl);}}).catch(()=>{});return()=>{live=false;};},[api,item.id,item.icon?.hash]);
 return <span className="nubi-app-symbol">{src?<img src={src} alt=""/>:<Icon name="layoutGrid02" size={24}/>}</span>;
}
// Same fields and wording as ai_workspace LinkWorkspace WorkspaceForm (link apps), shown in place instead of a dialog.
function AppRegisterForm({api,draft,onChange,onClose,onSaved}){
 const [busy,setBusy]=useState(false),[iconBusy,setIconBusy]=useState(false),[error,setError]=useState(''),id=useId(),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const change=(key,value)=>onChange({...draft,[key]:value});
 async function chooseIcon(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;setIconBusy(true);setError('');try{const icon=await importIcon(file);if(live.current)change('icon',icon);}catch(e){if(live.current)setError(e.message||'아이콘을 준비하지 못했어요.');}finally{if(live.current)setIconBusy(false);}}
 async function save(event){event?.preventDefault();if(busy||iconBusy)return;setBusy(true);setError('');try{const v=await api('workspaceCommunity',{action:'registerApp',title:draft.title,url:draft.url,description:draft.description,icon:draft.icon?.content||null});if(live.current)onSaved(v.item);}catch(e){if(live.current)setError(e.message==='community_icon'?'아이콘은 128KB 이하의 ICO 또는 PNG 파일을 선택하세요.':e.message==='community_input'?'제목, URL과 내용을 확인해 주세요.':errorText(e));}finally{if(live.current)setBusy(false);}}
 const ready=draft.title.trim()&&draft.url.trim()&&draft.description.trim();
 return <section className="nubi-community nubi-compose-page" aria-label="앱 등록">
  <header className="nubi-compose-heading"><WorkspaceAction action="back" label="돌아가기" disabled={busy} onClick={onClose}/><h3>앱 등록</h3><WorkspaceAction action="save" iconOnly={false} visibleLabel="등록" label="앱 등록 저장" busy={busy} disabled={busy||iconBusy||!ready} onClick={()=>void save()}/></header>
  <form className="nubi-compose-form" onSubmit={save} noValidate>
   <label htmlFor={id+'-title'}>제목<CxInput id={id+'-title'} aria-label="앱 제목" value={draft.title} maxLength={100} placeholder="예: 사내 AI 도우미" disabled={busy} onChange={e=>change('title',e.target.value)}/></label>
   <label htmlFor={id+'-url'}>URL<CxInput id={id+'-url'} aria-label="앱 URL" type="url" value={draft.url} maxLength={2048} placeholder="https://" disabled={busy} onChange={e=>change('url',e.target.value)}/></label>
   <label htmlFor={id+'-description'}>내용<textarea id={id+'-description'} aria-label="앱 내용" rows={4} value={draft.description} maxLength={1000} placeholder="사용할 수 있는 기능을 간단히 적어주세요." disabled={busy} onChange={e=>change('description',e.target.value)}/></label>
   <details className="nubi-compose-options"><summary><Icon name="sliders" size={18}/><span>추가 설정</span><small>선택</small><Icon name="chevronDown" size={16}/></summary>
    <div className="nubi-app-icon-field"><span>아이콘 <small>선택</small></span><div><span className="nubi-app-symbol">{draft.icon?<img src={draft.icon.preview} alt=""/>:<Icon name="layoutGrid02" size={24}/>}</span><label className="nubi-app-icon-upload" title="이미지 선택"><input type="file" accept="image/*,.ico" aria-label="아이콘 이미지 선택" disabled={busy||iconBusy} onChange={chooseIcon}/><Icon name="image" size={18}/><span className="visually-hidden">{iconBusy?'준비 중':'이미지 선택'}</span></label>{draft.icon&&<WorkspaceAction action="delete" label="아이콘 삭제" disabled={busy||iconBusy} onClick={()=>change('icon',null)}/>}</div></div>
   </details>
   {error&&<p role="alert" className="nubi-community-error">{error}</p>}
  </form>
 </section>;
}
const plain=body=>String(body||'').replace(/<[^>]*>/g,'').replace(/[#*`\[\]]/g,'').slice(0,180);
function Author({person,at}){
 const api=useContext(PeopleContext),profile=usePerson(api,person?.login),[open,setOpen]=useState(false),anchor=useRef(null),timer=useRef(null),id=useId();
 const name=String(profile?.name||person?.name||'').trim()||person?.login||'사용자',email=profile?.email||person?.email||null;
 const show=()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>setOpen(true),180);},hide=()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>setOpen(false),120);};
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 return <span className="nubi-talk-author"><span ref={anchor} className="nubi-talk-person" tabIndex={0} aria-describedby={open?id:undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}><Avatar person={person} profile={profile}/><strong>{name}</strong>{email&&<small>{email}</small>}</span><time dateTime={at} title={date(at)}>{relativeTime(at)}</time>{open&&<PersonCard person={person} profile={profile} anchor={anchor} id={id}/>}</span>;
}
function TalkBody({item}){return item.format==='html'?<div className="nubi-talk-html" dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(item.body,{ALLOWED_TAGS:['p','br','strong','em','s','blockquote','ul','ol','li','h2','h3','pre','code','a'],ALLOWED_ATTR:['href','title']})}}/>:<MessageBody role="assistant" content={item.body}/>;}
export function WorkspaceApps({api,onSignIn}){
 const [items,setItems]=useState([]),[query,setQuery]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[login,setLogin]=useState(false),[opening,setOpening]=useState(null),[register,setRegister]=useState(null),[notice,setNotice]=useState(''),live=useRef(true);
 async function load(){setLoading(true);setError('');try{const v=await api('workspaceCommunity',{action:'apps'});if(live.current){setItems(v.items);setLogin(false);}}catch(e){if(live.current){setError(errorText(e));setLogin(loginNeeded(e));}}finally{if(live.current)setLoading(false);}}
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[api]);
 async function open(id){if(opening)return;setOpening(id);setError('');try{await api('openWorkspaceApp',{id});}catch(e){if(live.current)setError(errorText(e));}finally{if(live.current)setOpening(null);}}
 if(register)return <AppRegisterForm api={api} draft={register} onChange={setRegister} onClose={()=>setRegister(null)} onSaved={item=>{setRegister(null);setItems(current=>[item,...current.filter(entry=>entry.id!==item.id)]);setNotice('앱을 등록했어요. AI Workspace 페이지에도 보여요.');}}/>;
 return <section className="nubi-community" aria-label="앱 목록">{login?<CompanySkillSignIn onConnect={onSignIn} busy={loading}/>:<>
  <div className="nubi-community-toolbar"><label className="nubi-community-search"><Icon name="search" size={18}/><CxInput aria-label="앱 검색" placeholder="앱 찾기" value={query} onChange={e=>setQuery(e.target.value)}/></label><WorkspaceAction action="refresh" label="앱 새로고침" onClick={load} disabled={loading}/><CxButton variant="primary" disabled={loading} onClick={()=>{setNotice('');setRegister({title:'',url:'',description:'',icon:null});}}><Icon name="plus" size={16}/>등록</CxButton></div>
  {error&&<p role="alert" className="nubi-community-error">{error}</p>}{notice&&<p role="status" className="nubi-community-notice">{notice}</p>}
  <div className="nubi-app-grid" aria-busy={loading}>{items.filter(i=>(i.title+' '+i.description).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item=><button key={item.id} className="nubi-app-card" disabled={!!opening} onClick={()=>open(item.id)}><AppIcon api={api} item={item}/><strong>{item.title}</strong><span className="nubi-app-description" title={item.description}>{item.description}</span><small>{opening===item.id?'여는 중':item.kind==='site'?'등록된 페이지':'웹앱'}<Icon name="arrowRight" size={16}/></small></button>)}</div>
  {loading&&<LoadingNote>앱을 불러오는 중</LoadingNote>}{!loading&&!error&&!items.length&&<p className="nubi-muted nubi-note"><Icon name="infoCircle" size={14}/>등록된 앱이 없어요.</p>}
 </>}</section>;
}
export function WorkspaceTalk({api,onSignIn}){
 const [items,setItems]=useState([]),[setup,setSetup]=useState(null),[view,setView]=useState('feed'),[legacy,setLegacy]=useState(false),[cursor,setCursor]=useState(null),[pages,setPages]=useState([null]),[index,setIndex]=useState(0),[query,setQuery]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[login,setLogin]=useState(false),[detail,setDetail]=useState(null),[composer,setComposer]=useState(null),[comment,setComment]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null),[notice,setNotice]=useState('');
 const run=useRef(0),live=useRef(true),draft=useRef({commentNonce:null});
 const call=args=>api('workspaceCommunity',args);
 const fail=e=>{setError(errorText(e));setLogin(loginNeeded(e));};
 async function load(at=pages[index],old=legacy){const id=++run.current;setLoading(true);setError('');try{const [catalog,meta]=await Promise.all([call(old?{action:'legacy',page:at||1}:{action:'list',cursor:at}),call({action:'setup'}).catch(e=>{if(!old)throw e;return {categories:[],pending:[]};})]);if(live.current&&id===run.current){setItems(catalog.items);setCursor(catalog.cursor);setSetup(meta);setPending(meta.pending?.[0]||null);setLogin(false);}}catch(e){if(live.current&&id===run.current)fail(e);}finally{if(live.current&&id===run.current)setLoading(false);}}
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;run.current++;};},[api]);
 async function open(key){const id=++run.current;setLoading(true);setError('');try{const v=await call({action:'detail',key});if(live.current&&run.current===id){setDetail(v);setComment('');draft.current.commentNonce=null;}}catch(e){if(live.current&&run.current===id)fail(e);}finally{if(live.current&&run.current===id)setLoading(false);}}
 async function publish(action){if(busy)return;setBusy(true);setError('');setNotice('');const value=action==='post'?{...composer,action}:{action,key:detail.item.key,body:comment,nonce:draft.current.commentNonce||(draft.current.commentNonce=crypto.randomUUID())};try{const v=await call(value);if(!live.current)return;if(v.saved){setComposer(null);setComment('');setPending(null);setNotice(action==='post'?'글을 게시했어요.':'댓글을 등록했어요.');await open(v.key);}else setPending({nonce:value.nonce,action,key:value.key});}catch(e){if(live.current){fail(e);if(e.message==='community_pending')setPending({nonce:value.nonce,action,key:value.key});}}finally{if(live.current)setBusy(false);}}
 async function verify(){if(!pending||busy)return;setBusy(true);setError('');try{const v=await call({action:'verify',nonce:pending.nonce});if(!live.current)return;if(v.saved){setPending(null);setComposer(null);setComment('');setNotice('게시된 내용을 확인했어요.');setBusy(false);await open(v.key);}else setError('아직 게시 여부를 확인하지 못했어요. 초안을 유지하고 있습니다.');}catch(e){if(live.current)fail(e);}finally{if(live.current)setBusy(false);}}
 async function moreComments(){setBusy(true);try{const v=await call({action:'comments',key:detail.item.key,cursor:detail.comments.cursor});if(live.current)setDetail(d=>({...d,comments:{items:[...d.comments.items,...v.items],cursor:v.cursor}}));}catch(e){if(live.current)fail(e);}finally{if(live.current)setBusy(false);}}
 if(composer)return <section className="nubi-community nubi-compose-page" aria-label="Talk 글쓰기">
  <header className="nubi-compose-heading"><WorkspaceAction action="back" label="돌아가기" disabled={busy} onClick={()=>{if(!busy)setComposer(null);}}/><h3>글쓰기</h3><WorkspaceAction action="save" iconOnly={false} visibleLabel={pending?'결과 확인':'등록'} label={pending?'게시 여부 확인':'글 등록'} busy={busy} disabled={busy||(!pending&&(!composer.title.trim()||!composer.body.trim()))} onClick={()=>pending?void verify():void publish('post')}/></header>
  <div className="nubi-compose-form">
   <label>카테고리<CxSelect aria-label="글 카테고리" value={composer.category} disabled={busy||!!pending} onChange={e=>setComposer({...composer,category:e.target.value})}>{setup.categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</CxSelect></label>
   <label>제목<CxInput aria-label="글 제목" placeholder="제목을 입력하세요" value={composer.title} maxLength={120} disabled={busy||!!pending} onChange={e=>setComposer({...composer,title:e.target.value})}/></label>
   <label>내용<textarea aria-label="글 내용" placeholder="내용을 입력하세요" value={composer.body} maxLength={50000} disabled={busy||!!pending} onChange={e=>setComposer({...composer,body:e.target.value})}/></label>
   {error&&<p role="alert" className="nubi-community-error">{error}</p>}
  </div>
 </section>;
 return <PeopleContext.Provider value={api}><section className="nubi-community" aria-label="Talk">
 {login?<CompanySkillSignIn onConnect={onSignIn} busy={loading}/>:<>
 {error&&<p role="alert" className="nubi-community-error">{error}</p>}{notice&&<p role="status" className="nubi-community-notice">{notice}</p>}{pending&&<div className="nubi-talk-pending"><Icon name="infoCircle" size={18}/><span>게시 여부를 먼저 확인해 주세요.</span><CxButton onClick={verify} disabled={busy}>확인하기</CxButton></div>}
 <div className="nubi-talk-toolbar">{detail&&<WorkspaceAction action="back" label="Talk 목록" disabled={busy} onClick={()=>{setDetail(null);void load();}}/>}{!detail&&<label className="nubi-community-search"><Icon name="search" size={16}/><CxInput aria-label="Talk 검색" placeholder="현재 목록에서 찾기" value={query} onChange={e=>setQuery(e.target.value)}/></label>}{!detail&&<div role="group" aria-label="Talk 보기"><CxButton aria-label="줄글 보기" title="줄글 보기" aria-pressed={view==='feed'} onClick={()=>setView('feed')}><Icon name="list" size={18}/></CxButton><CxButton aria-label="격자 보기" title="격자 보기" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><Icon name="layoutGrid02" size={18}/></CxButton></div>}{!detail&&<CxButton aria-pressed={legacy} onClick={()=>{const next=!legacy;setLegacy(next);setIndex(0);setPages([null]);void load(null,next);}}>이전 글</CxButton>}<WorkspaceAction action="refresh" label="Talk 새로고침" disabled={loading||busy} onClick={()=>detail?open(detail.item.key):load()}/><CxButton variant="primary" disabled={!setup?.categories?.length||busy||!!pending} onClick={()=>setComposer({title:'',body:'',category:setup.categories[0]?.id,nonce:crypto.randomUUID()})}><Icon name="pencil" size={16}/>글쓰기</CxButton></div>
 {detail?<article className="nubi-talk-detail"><h3>{detail.item.title}</h3><Author person={detail.item.author} at={detail.item.createdAt}/><TalkBody item={detail.item}/><section className="nubi-talk-comments" aria-label="댓글"><h4><Icon name="message" size={18}/>댓글</h4>{detail.comments.items.map(c=><article key={c.id}><Author person={c.author} at={c.createdAt}/><MessageBody role="assistant" content={c.body}/>{c.replies?.map(r=><blockquote key={r.id}><Author person={r.author} at={r.createdAt}/><MessageBody role="assistant" content={r.body}/></blockquote>)}{c.moreReplies&&<p className="nubi-muted">답글은 먼저 50개까지 표시했어요.</p>}</article>)}{detail.comments.cursor&&<CxButton onClick={moreComments} disabled={busy}>댓글 더 보기</CxButton>}{!detail.item.locked&&<form onSubmit={e=>{e.preventDefault();void publish('comment');}}><textarea aria-label="댓글 내용" placeholder="의견을 나눠 보세요." value={comment} maxLength={4000} disabled={busy||!!pending} onChange={e=>setComment(e.target.value)}/><CxButton type="submit" variant="primary" disabled={!comment.trim()||busy||!!pending}><Icon name="send" size={16}/>댓글 등록</CxButton></form>}</section></article>:<>
 <div className="nubi-talk-list" data-view={view} aria-busy={loading}>{items.filter(i=>(i.title+' '+plain(i.body)).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item=><button key={item.key} onClick={()=>open(item.key)}><Author person={item.author} at={item.updatedAt}/><strong title={item.title}>{item.title}</strong><span className="nubi-talk-excerpt" title={plain(item.body)}>{plain(item.body)}</span><small><span>{item.category.name}</span><span><Icon name="message" size={14}/>{item.comments}</span></small></button>)}</div>
 {!loading&&!items.length&&!error&&<p className="nubi-muted nubi-note"><Icon name="infoCircle" size={14}/>아직 글이 없어요.</p>}<nav className="nubi-community-pagination" aria-label="Talk 페이지"><CxButton aria-label="이전 페이지" disabled={!index||loading} onClick={()=>{setIndex(index-1);void load(pages[index-1]);}}><Icon name="chevronLeft" size={16}/></CxButton><span>{index+1}</span><CxButton aria-label="다음 페이지" disabled={!cursor||loading} onClick={()=>{setPages([...pages.slice(0,index+1),cursor]);setIndex(index+1);void load(cursor);}}><Icon name="chevronRight" size={16}/></CxButton></nav>
 </>}{loading&&<LoadingNote>글을 불러오는 중</LoadingNote>}
 </>}

 </section></PeopleContext.Provider>;
}
