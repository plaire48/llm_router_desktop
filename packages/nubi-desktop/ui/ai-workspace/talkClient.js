import {issueTitle,displayIssueTitle} from './issuePresentation.js';
import {commentText,encodeReply} from './commentThread.js';
import {validateTalkComment} from './talkCommentAttachments.js';
import {GHES_CONFIG,TALK_CONFIG,STATUS_CONFIG,SERVICE_DESK_CONFIG} from './config.js';
import {getServiceDeskSession,serviceDeskLinks} from './serviceDeskClient.js';
import {profileEmail} from './profileEmail.js';
import {TALK_LOGIN,TALK_UUID,TALK_PIN_LABEL,TALK_LIMITS,encodeTalkBody,talkPost,talkComment,talkError,talkOwner,talkModerator,talkPermalink,isTalkPost} from './talkModel.js';
import {ghesFetch} from './hostFetch.js';

export function talkConfigured(config=TALK_CONFIG) {
  return /^[a-z\d][\w.-]*$/i.test(config.owner||'')&&/^[a-z\d][\w.-]*$/i.test(config.repo||'');
}
export function createTalkClient({session=getServiceDeskSession(),config=TALK_CONFIG,role='user',fetchImpl=ghesFetch,baseUrl=globalThis.location?.href||'https://localhost/'}={}) {
  if(!talkConfigured(config))throw talkError('AI Talk 저장소를 연결하세요. 설치 방법은 도움말에서 확인할 수 있습니다.');
  const host=GHES_CONFIG.host,root=serviceDeskLinks({host,...config}).api.replace(/\/issues$/,'');
  const signedIn=Boolean(session?.token?.trim()&&!['null','undefined'].includes(session.token.trim())&&session.host===host&&Number.isSafeInteger(session.user?.id)&&TALK_LOGIN.test(session.user?.login||''));
  const auth=()=>{if(!signedIn)throw talkError('로그인 후 사용할 수 있습니다.',401);};
  const uncertain=new Set();
  const pendingResult=error=>Object.assign(talkError('저장 결과를 확인하지 못했습니다. 결과 확인을 눌러 등록 여부를 확인하세요.',error?.status||-1),{uncertain:true});
  const recoverRead=async(key,read)=>{try{return await read();}catch(error){if(uncertain.has(key))throw pendingResult(error);throw error;}};
  const request=async(path,{method='GET',body,allow404=false,userProfile=false}={})=>{
    if(method!=='GET')auth();
    if(userProfile&&(!TALK_LOGIN.test(path)||method!=='GET'))throw talkError('사용자 조회 정보를 확인하세요.');
    let response;
    try {response=await fetchImpl(userProfile?`https://${host}/api/v3/users/${encodeURIComponent(path)}`:`${root}${path}`,{method,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Accept:'application/vnd.github+json',...(signedIn?{Authorization:`Bearer ${session.token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch {throw talkError(method==='GET'?'글을 불러오지 못했습니다. 다시 시도하세요.':'반영 결과를 확인하지 못했습니다. 새로고침으로 확인하세요.',-1);}
    if(response.status===404&&allow404){await response.body?.cancel();return null;}
    if(response.status===401&&!signedIn){
      await response.body?.cancel().catch(()=>{});
      throw Object.assign(talkError('게시글의 비로그인 조회가 차단되어 있습니다. 관리자에게 공개 조회 설정을 요청하세요.',401),{publicReadBlocked:true});
    }
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw talkError(({401:'로그인이 필요합니다. 다시 로그인하세요.',403:'게시판 권한을 확인하세요. GitHub App의 Issues 권한과 저장소 접근 권한이 필요합니다.',404:'게시글 또는 게시판 접근 권한을 확인하세요.',410:'게시판의 Issues 기능을 확인하세요.',422:'입력값과 저장소 권한을 확인하세요.',429:'요청이 많습니다. 잠시 후 다시 시도하세요.'})[response.status]||'게시판 응답을 확인하지 못했습니다. 다시 시도하세요.',response.status);}
    if(response.status===204){await response.body?.cancel();return null;}
    try{return await response.json();}catch{throw talkError('게시판 응답 형식을 확인하지 못했습니다.',-1);}
  };
  const all=async(path)=>{
    const values=[];for(let page=1;page<=100;page++){const rows=await request(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);if(!Array.isArray(rows))throw talkError('게시판 목록 형식을 확인하지 못했습니다.');values.push(...rows);if(rows.length<100)return values;}
    throw talkError('게시판 목록이 너무 큽니다. GHES에서 확인하세요.');
  };
  const issue=async number=>{if(!Number.isSafeInteger(number)||number<1)throw talkError('글 번호를 확인하세요.');const current=await request(`/issues/${number}`);if(!isTalkPost(current))throw talkError('AI Talk에서 작성한 글이 아닙니다.',404);return current;};
  const profiles=new Map();
  const profile=async login=>{
    if(!TALK_LOGIN.test(login||''))return null;
    const key=login.toLowerCase();
    if(!profiles.has(key))profiles.set(key,request(login,{userProfile:true,allow404:true}).then(value=>{
      if(!value||!Number.isSafeInteger(value.id)||value.login?.toLowerCase()!==key)return null;
      return {id:value.id,login:value.login,name:typeof value.name==='string'?value.name:null,avatar_url:value.avatar_url,email:profileEmail(value.email),bio:typeof value.bio==='string'?value.bio.slice(0,500):null};
    }).catch(error=>{profiles.delete(key);throw error;}));
    return profiles.get(key);
  };
  const hydrate=async items=>{
    const users=[...new Map(items.map(item=>[item.user.id,item.user])).values()];
    const resolved=new Map();
    for(let offset=0;offset<users.length;offset+=4)await Promise.all(users.slice(offset,offset+4).map(async user=>{try{const value=await profile(user.login);if(value?.id===user.id)resolved.set(user.id,value);}catch{/* Keep issue identity when profile access is unavailable. */}}));
    return items.map(item=>({...item,user:{...item.user,...resolved.get(item.user.id)}}));
  };
  const list=async()=>{
    const raw=await all('/issues?state=open&sort=created&direction=desc');
    return hydrate(raw.filter(isTalkPost).map(talkPost));
  };
  const detail=async number=>{
    const raw=await issue(number);
    if(!raw||raw.state!=='open')throw talkError('내려간 글이거나 찾을 수 없는 글입니다.',404);
    const comments=await all(`/issues/${number}/comments`);
    const [post]=await hydrate([talkPost(raw)]);return {post,comments:await hydrate(comments.map(talkComment))};
  };
  const canModerate=async()=>{
    auth();if(!talkModerator(typeof role==='function'?role():role))throw talkError('관리자만 상단 고정을 변경할 수 있습니다.',403);
    const repo=await request('');if(!repo.permissions?.triage&&!repo.permissions?.push&&!repo.permissions?.admin)throw talkError('AI Talk 저장소에 Triage 이상의 권한이 필요합니다.',403);return repo.permissions;
  };
  const capabilities=async()=>{
    if(!signedIn||!talkModerator(typeof role==='function'?role():role))return {moderate:false,manageContent:false};
    const repo=await request(''),p=repo.permissions||{};
    return {moderate:Boolean(p.triage||p.push||p.admin),manageContent:Boolean(p.push||p.admin)};
  };
  const canManageContent=async()=>{
    const p=await canModerate();
    if(!p.push&&!p.admin)throw talkError('다른 사람의 글과 댓글을 변경하려면 게시판 저장소의 Write 이상 권한이 필요합니다.',403);
  };
  const authorizePost=async(number,{content=false}={})=>{auth();const current=await issue(number);if(!talkOwner(current,session.user))await (content?canManageContent():canModerate());return current;};
  const changed=(current,baseline)=>current.updated_at!==baseline.updatedAt||current.body!==baseline.body||current.title!==(baseline.rawTitle??baseline.title);
  const conflict=()=>talkError('다른 변경이 먼저 반영되었습니다. 글을 다시 열고 수정하세요.',409);
  const mayEdit=async baseline=>{
    const current=await authorizePost(baseline.number);
    if(changed(current,baseline))throw conflict();
    return current;
  };
  const recoverPost=async id=>(await all(`/issues?state=all&creator=${encodeURIComponent(session.user.login)}&sort=created&direction=desc`)).find(item=>!item.pull_request&&item.body?.includes(`<!-- e2e-talk:v1:${id} -->`));
  const create=async({title,html,id})=>{
    auth();title=String(title||'').trim();if(!title||title.length>TALK_LIMITS.title)throw talkError(`제목은 ${TALK_LIMITS.title}자까지 입력하세요.`);
    if(!TALK_UUID.test(id))throw talkError('글 요청 정보를 확인하세요.');
    const body=encodeTalkBody(html,id,baseUrl);
    const recover=async()=>{
      const existing=await recoverRead(id,()=>recoverPost(id));if(!existing)return null;
      if(displayIssueTitle(existing.title)!==title||existing.body!==body||existing.user?.id!==session.user.id)throw talkError('이 요청으로 등록된 글의 내용이 다릅니다. 내 글에서 확인하세요.',409);
      uncertain.delete(id);return talkPost(existing);
    };
    const existing=await recover();if(existing)return existing;
    if(uncertain.has(id))throw pendingResult();
    try{return talkPost(await request('/issues',{method:'POST',body:{title:issueTitle('Talk',title),body}}));}
    catch(error){
      if(error.status!==-1&&error.status<500)throw error;
      uncertain.add(id);const recovered=await recover();if(recovered)return recovered;throw pendingResult(error);
    }
  };
  const update=async(baseline,{title,html,id})=>{
    if(!title?.trim()||title.trim().length>TALK_LIMITS.title)throw talkError(`제목은 ${TALK_LIMITS.title}자까지 입력하세요.`);
    const key=`update:${baseline.number}`,body=encodeTalkBody(html,id,baseUrl);
    const current=await recoverRead(key,()=>authorizePost(baseline.number,{content:true}));
    if(current.state!=='open')throw talkError('내려간 글은 수정할 수 없습니다.',409);
    if(displayIssueTitle(current.title)===title.trim()&&current.body===body){uncertain.delete(key);return talkPost(current);}
    if(changed(current,baseline))throw conflict();
    if(uncertain.has(key))throw pendingResult();
    try{return talkPost(await request(`/issues/${baseline.number}`,{method:'PATCH',body:{title:issueTitle('Talk',title),body}}));}
    catch(error){
      if(error.status!==-1&&error.status<500)throw error;
      uncertain.add(key);
      // A retry can only verify this PATCH. Never replay a write with an unknown outcome.
      return update(baseline,{title,html,id});
    }
  };
  const pin=async(baseline,pinned)=>{
    const permissions=await canModerate();const current=await issue(baseline.number);
    if(current.state!=='open')throw talkError('내려간 글은 상단에 고정할 수 없습니다.');
    if(talkPost(current).pinned===pinned)return talkPost(current);
    if(pinned&&!await request(`/labels/${encodeURIComponent(TALK_PIN_LABEL)}`,{allow404:true})){
      if(!permissions.push&&!permissions.admin)throw talkError('고정 기능의 초기 설정이 필요합니다. 시스템 관리자에게 문의하세요.');
      try{await request('/labels',{method:'POST',body:{name:TALK_PIN_LABEL,color:'DCE9FF',description:'AI Talk 상단 고정'}});}catch(error){if(!await request(`/labels/${encodeURIComponent(TALK_PIN_LABEL)}`,{allow404:true}))throw error;}
    }
    // Do not replace the entire label array: preserve concurrent, unrelated labels.
    await request(`/issues/${baseline.number}/labels${pinned?'':`/${encodeURIComponent(TALK_PIN_LABEL)}`}`,{method:pinned?'POST':'DELETE',...(pinned?{body:{labels:[TALK_PIN_LABEL]}}:{})});
    const saved=talkPost(await issue(baseline.number));if(saved.pinned!==pinned)throw talkError('상단 고정이 반영되지 않았습니다. 저장소 권한을 확인하세요.');return saved;
  };
  const remove=async baseline=>{await mayEdit(baseline);return talkPost(await request(`/issues/${baseline.number}`,{method:'PATCH',body:{state:'closed'}}));};
  const reactions=async number=>{auth();await issue(number);const rows=await all(`/issues/${number}/reactions?content=heart`);return {count:rows.length,mine:rows.find(row=>row.user?.id===session.user.id)?.id||null};};
  const like=async(number,desired)=>{
    auth();const current=await reactions(number);
    if(desired&&!current.mine)await request(`/issues/${number}/reactions`,{method:'POST',body:{content:'heart'}});
    if(!desired&&current.mine)await request(`/issues/${number}/reactions/${current.mine}`,{method:'DELETE'});
    return reactions(number);
  };
  const commentReactions=async(number,id)=>{
    auth();await issue(number);
    if(!Number.isSafeInteger(id)||id<1)throw talkError('댓글 식별자를 확인하세요.');
    const row=await request(`/issues/comments/${id}`);
    if(row.issue_url!==`${root}/issues/${number}`)throw talkError('이 글에 속하지 않는 댓글입니다.',404);
    const rows=await all(`/issues/comments/${id}/reactions?content=heart`);
    return {count:rows.length,mine:rows.find(row=>row.user?.id===session.user.id)?.id||null};
  };
  const likeComment=async(number,id,desired)=>{
    const current=await commentReactions(number,id);
    if(desired&&!current.mine)await request(`/issues/comments/${id}/reactions`,{method:'POST',body:{content:'heart'}});
    if(!desired&&current.mine)await request(`/issues/comments/${id}/reactions/${current.mine}`,{method:'DELETE'});
    return commentReactions(number,id);
  };
  const comment=async(number,{body,id,replyTo=null})=>{
    auth();const text=validateTalkComment(commentText(body));if(replyTo!==null&&(!Number.isSafeInteger(replyTo)||replyTo<1))throw talkError('답글을 받을 댓글을 확인하세요.');if(!TALK_UUID.test(id))throw talkError('댓글 요청 정보를 확인하세요.');
    const marker=`<!-- e2e-talk-comment:${id} -->`;
    const recover=async()=>{
      const existing=await recoverRead(id,async()=>(await all(`/issues/${number}/comments`)).find(row=>row.user?.id===session.user.id&&row.body?.endsWith(marker)));
      if(!existing)return null;
      const saved=talkComment(existing);if(saved.body!==text||saved.replyTo!==replyTo)throw talkError('이 요청으로 등록된 댓글의 내용이 다릅니다. 댓글 목록에서 확인하세요.',409);
      uncertain.delete(id);return saved;
    };
    const existing=await recover();if(existing)return existing;
    if(uncertain.has(id))throw pendingResult();
    if((await issue(number)).state!=='open')throw talkError('내려간 글에는 댓글을 작성할 수 없습니다.');
    const parent=replyTo===null?null:(await all(`/issues/${number}/comments`)).find(row=>row.id===replyTo);
    if(replyTo!==null&&!parent)throw talkError('원댓글이 삭제되었습니다. 답글 선택을 해제하고 다시 등록하세요.',409);
    const content=encodeReply(text,parent,serviceDeskLinks({host,...config}).repository,number);
    try{return talkComment(await request(`/issues/${number}/comments`,{method:'POST',body:{body:`${content}\n\n[AI Talk에서 보기](${talkPermalink(baseUrl,number)})\n\n${marker}`}}));}
    catch(error){
      if(error.status!==-1&&error.status<500)throw error;
      uncertain.add(id);const saved=await recover();if(saved)return saved;throw pendingResult(error);
    }
  };
  const deleteComment=async baseline=>{
    auth();if(!Number.isSafeInteger(baseline.id)||baseline.id<1)throw talkError('댓글 번호를 확인하세요.');const current=await request(`/issues/comments/${baseline.id}`);
    if(!talkOwner(current,session.user))await canManageContent();
    if(current.updated_at!==baseline.updatedAt)throw talkError('댓글이 변경되었습니다. 새로고침 후 다시 확인하세요.',409);
    await request(`/issues/comments/${baseline.id}`,{method:'DELETE'});
  };
  let membersPromise=null;
  const mentionItems=async(query='')=>{
    auth();if(!membersPromise)membersPromise=(async()=>{
      const users=(await all('/assignees')).filter(user=>TALK_LOGIN.test(user.login)&&Number.isSafeInteger(user.id));
      const hydrated=[];
      for(let offset=0;offset<users.length;offset+=4)hydrated.push(...await Promise.all(users.slice(offset,offset+4).map(async user=>{try{const value=await profile(user.login);return value?.id===user.id?{...user,...value}:user;}catch{return user;}})));
      return hydrated;
    })().catch(error=>{membersPromise=null;throw error;});
    return (await membersPromise).filter(user=>TALK_LOGIN.test(user.login)&&`${user.login} ${user.name||''}`.toLowerCase().includes(query.toLowerCase())).slice(0,8);
  };
  return {list,detail,create,update,pin,remove,reactions,like,commentReactions,likeComment,comment,deleteComment,mentionItems,profile,capabilities,signedIn,session,config};
}
