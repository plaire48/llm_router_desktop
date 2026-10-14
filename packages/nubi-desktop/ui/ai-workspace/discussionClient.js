import {ghesFetch,talkBase} from './hostFetch.js';
import {GHES_CONFIG,TALK_CONFIG} from './config.js';
import {createTalkClient} from './talkClient.js';
import {TALK_LIMITS,TALK_UUID,talkError,talkOwner,talkCanManage,talkPermalink,talkModerator} from './talkModel.js';
import {commentText} from './commentThread.js';
import {validateTalkComment} from './talkCommentAttachments.js';
import {discussionPost,discussionComment,discussionIdentity,discussionNumber,isDiscussionKey,nodeId,encodeDiscussionBody} from './discussionModel.js';
import {issueTitle} from './issuePresentation.js';
import {createDiscussionPinStore} from './discussionPins.js';
import {githubRequestDiagnostic} from './githubRequestDiagnostic.js';

const actor='login avatarUrl ... on User { databaseId name }';
const pageInfo='pageInfo { hasNextPage endCursor }';
export const DISCUSSION_FIELDS=`id number title body url createdAt updatedAt locked closed isAnswered answer { id }
 author { ${actor} } category { id name slug emoji emojiHTML description isAnswerable }
 comments(first:0) { totalCount } reactionGroups { content viewerHasReacted reactors(first:0) { totalCount } }
 viewerCanUpdate viewerCanDelete viewerCanReact viewerSubscription
 poll { id question totalVoteCount viewerCanVote viewerHasVoted options(first:100) { nodes { id option totalVoteCount viewerHasVoted } pageInfo { hasNextPage } } }`;
const COMMENT_FIELDS=`id body url createdAt updatedAt isAnswer author { ${actor} }
 reactionGroups { content viewerHasReacted reactors(first:0) { totalCount } } viewerCanReact
 replyTo { id author { login } } viewerCanUpdate viewerCanDelete viewerCanMarkAsAnswer viewerCanUnmarkAsAnswer`;
const conflict=()=>talkError('다른 변경이 먼저 반영되었습니다. 새로고침 후 확인하세요.',409);
const pending=(action='저장')=>Object.assign(talkError(action==='삭제'?'삭제 결과를 확인하지 못했습니다. 새로고침 후 확인하세요.':'저장 결과를 확인하지 못했습니다. 결과 확인으로 반영 여부를 확인하세요.',-1),{uncertain:true});
const samePost=(a,b)=>a.updatedAt===b.updatedAt&&a.body===b.body&&a.title===b.title&&a.category?.id===b.category?.id;

// New posts use Discussions. Existing issue posts keep their original IDs and links.
// Inquiry continues to use the separate Issues client; no inquiry data is migrated.
export function createDiscussionClient(options={}) {
  const legacy=options.legacy||createTalkClient(options),{session,signedIn}=legacy;
  // Nubi: GitHub calls go through the host, which holds the SSO token (a direct fetch carried only the placeholder and
  // failed: "게시판 응답을 확인하지 못했습니다", user report 2026-10-14).
  const config=options.config||TALK_CONFIG,fetchImpl=options.fetchImpl||ghesFetch,baseUrl=options.baseUrl||talkBase();
  const variables={owner:config.owner,name:config.repo},uncertain=new Map(),locks=new Set();
  const pinStore=options.pinStore||createDiscussionPinStore({host:GHES_CONFIG.host,owner:config.owner,repo:config.repo,branch:config.branch||GHES_CONFIG.branch,token:session?.token,fetchImpl});
  let pinOverrides=new Map();
  const pinState=id=>({pinned:pinOverrides.has(id)?pinOverrides.get(id):Boolean(settings?.pins?.has(id)),pinOrder:settings?.pins?.get(id)});
  let warnings=[],settings=null;
  const auth=()=>{if(!signedIn)throw Object.assign(talkError('게시글을 보려면 로그인하세요.',401),{publicReadBlocked:true});};
  const request=async(query,values={},signal,{allowMissingDiscussion=false}={})=>{
    auth();let response;
    try {response=await fetchImpl(`https://${GHES_CONFIG.host}/api/graphql`,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
      headers:{Authorization:`Bearer ${session.token}`,Accept:'application/json','Content-Type':'application/json'},
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),body:JSON.stringify({query,variables:values})});}
    // The host's error code is shown so a failure on the company PC says why (2026-10-14).
    catch(cause){signal?.throwIfAborted();throw talkError('게시판 응답을 확인하지 못했습니다. 다시 시도하세요.'+(cause?.code?` (${cause.code})`:cause?.message&&/^[a-z_]+$/.test(cause.message)?` (${cause.message})`:''),-1);}
    const diagnostic=githubRequestDiagnostic(`https://${GHES_CONFIG.host}/api/graphql`,'POST',response,session.token).diagnosticText;
    const operation=/^(?:query|mutation) (E2E[A-Za-z]+)\(/.exec(query)?.[1]||'확인 불가';
    const diagnose=error=>Object.assign(error,{diagnosticText:`${diagnostic}\n작업: ${operation}`});
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw diagnose(talkError(({401:'로그인이 만료되었습니다. 다시 로그인하세요.',403:'GitHub App의 Discussions 권한과 저장소 접근 권한을 확인하세요.',404:'Discussions 연결과 GitHub App 설치 범위를 확인하세요.',429:'요청이 많습니다. 잠시 후 다시 시도하세요.'})[response.status]||'게시판 응답을 확인하지 못했습니다.',response.status));}
    let result;try{result=await response.json();}catch{throw diagnose(talkError('게시판 응답 형식을 확인하지 못했습니다.',-1));}
    // A deleted discussion can be null with a field-scoped NOT_FOUND error.
    // Accept only that lookup result; repository/permission errors and partial writes still fail.
    const missingDiscussion=allowMissingDiscussion&&result.data?.repository?.discussion===null&&result.errors?.length&&result.errors.every(error=>
      (error.type||error.extensions?.code)==='NOT_FOUND'&&Array.isArray(error.path)&&error.path.length===2&&error.path[0]==='repository'&&error.path[1]==='discussion');
    if(result.errors?.length&&!missingDiscussion){
      const types=result.errors.map(error=>error.type||error.extensions?.code||'');
      const status=types.includes('NOT_FOUND')?404:types.some(type=>['FORBIDDEN','UNAUTHORIZED'].includes(type))?403:types.some(type=>['INTERNAL','INTERNAL_SERVER_ERROR'].includes(type))?500:422;
      const error=talkError(status===403?'Discussions 권한과 카테고리 작성 권한을 확인하세요.':status===404?'게시글 또는 Discussions 접근 권한을 확인하세요.':'Discussions 요청을 처리하지 못했습니다. 입력값과 GHES 설정을 확인하세요.',status);
      // A resolver can fail after its mutation has already committed. Partial
      // mutation data must enter result verification, never a blind resubmit.
      error.partialMutation=query.startsWith('mutation ')&&result.data!=null;
      diagnose(error);
      const safeTypes=types.filter(type=>['NOT_FOUND','FORBIDDEN','UNAUTHORIZED','INTERNAL','INTERNAL_SERVER_ERROR','GRAPHQL_VALIDATION_FAILED','BAD_USER_INPUT'].includes(type));
      error.diagnosticText+=`\nGraphQL: ${[...new Set(safeTypes)].join(', ')||'요청 오류'}`;
      throw error;
    }
    if(!result.data||typeof result.data!=='object')throw diagnose(talkError('게시판 응답 형식을 확인하지 못했습니다.',-1));
    return result.data;
  };
  const paginate=async(read)=>{
    let after=null;const all=[],seen=new Set();
    for(let page=0;page<100;page++){
      const connection=await read(after);
      if(!Array.isArray(connection?.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean')throw talkError('목록 응답을 확인하지 못했습니다.',-1);
      all.push(...connection.nodes.filter(Boolean));if(!connection.pageInfo.hasNextPage)return all;
      const next=connection.pageInfo.endCursor;
      if(typeof next!=='string'||!next||seen.has(next))throw talkError('다음 목록을 확인하지 못했습니다.',-1);
      seen.add(next);after=next;
    }
    throw talkError('목록이 너무 큽니다. GHES에서 확인하세요.');
  };
  const metadata=async()=>{
    const data=await request(`query E2EDiscussionSetup($owner:String!,$name:String!) { repository(owner:$owner,name:$name) {
      id hasDiscussionsEnabled viewerPermission discussionCategories(first:100) { nodes { id name slug emoji emojiHTML description isAnswerable } ${pageInfo} }
      pinnedDiscussions(first:100) { nodes { discussion { id } } ${pageInfo} }
    } }`,variables);
    const repo=data.repository;
    if(!repo)throw talkError('Discussions 저장소와 접근 권한을 확인하세요.',404);
    if(!repo.hasDiscussionsEnabled)throw talkError('저장소 Settings에서 Discussions를 켜주세요.',422);
    if(!Array.isArray(repo.discussionCategories?.nodes)||repo.discussionCategories.pageInfo?.hasNextPage||!Array.isArray(repo.pinnedDiscussions?.nodes)||repo.pinnedDiscussions.pageInfo?.hasNextPage)throw talkError('카테고리와 고정 글을 확인하지 못했습니다.',-1);
    settings={id:repo.id,categories:repo.discussionCategories.nodes,pins:new Map(repo.pinnedDiscussions.nodes.map((pin,index)=>[pin.discussion?.id,index])),permission:repo.viewerPermission};
    try{pinOverrides=(await pinStore.read()).values;}catch{warnings.push('상단 고정 정보를 불러오지 못했습니다. 새로고침 후 다시 확인하세요.');}
    return settings;
  };
  const nativeList=async({signal}={})=>{
    const rows=await paginate(async after=>(await request(`query E2EDiscussions($owner:String!,$name:String!,$after:String) { repository(owner:$owner,name:$name) {
      discussions(first:50,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${DISCUSSION_FIELDS} } ${pageInfo} }
    } }`,{...variables,after},signal)).repository?.discussions);
    return rows.map(row=>discussionPost(row,pinState(row.id)));
  };
  const activity=async({since,signal}={})=>{
    let after=null;const posts=[];
    for(let page=0;page<3;page++){
      const connection=(await request(`query E2EDiscussionActivity($owner:String!,$name:String!,$after:String) { repository(owner:$owner,name:$name) {
        discussions(first:30,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${DISCUSSION_FIELDS} } ${pageInfo} }
      } }`,{...variables,after},signal)).repository?.discussions;
      if(!Array.isArray(connection?.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean')throw talkError('게시글 알림을 확인하지 못했습니다.',-1);
      const rows=connection.nodes.map(row=>discussionPost(row));posts.push(...rows.filter(row=>Date.parse(row.updatedAt)>=since));
      if(rows.some(row=>Date.parse(row.updatedAt)<since)||!connection.pageInfo.hasNextPage)return {posts,limited:false};
      if(!connection.pageInfo.endCursor||connection.pageInfo.endCursor===after)throw talkError('다음 알림을 확인하지 못했습니다.',-1);
      after=connection.pageInfo.endCursor;
    }return {posts,limited:true};
  };
  // Reactions do not reliably change discussion.updatedAt. Include the user's
  // older conversations without an updated-date filter when collecting likes.
  const reactionPosts=async({signal}={})=>{
    let after=null;const posts=[],seen=new Set();
    for(let page=0;page<20;page++){
      const result=(await request(`query E2EReactionPosts($query:String!,$after:String) { search(query:$query,type:DISCUSSION,first:50,after:$after) { nodes { ... on Discussion { ${DISCUSSION_FIELDS} repository { nameWithOwner } } } ${pageInfo} } }`,{query:`repo:${config.owner}/${config.repo} involves:${session.user.login} sort:updated-desc`,after},signal)).search;
      if(!Array.isArray(result?.nodes)||typeof result.pageInfo?.hasNextPage!=='boolean')throw talkError('좋아요 알림의 글 목록을 확인하지 못했습니다.');
      for(const row of result.nodes){if(row?.repository?.nameWithOwner?.toLowerCase()===`${config.owner}/${config.repo}`.toLowerCase())posts.push(discussionPost(row));}
      if(!result.pageInfo.hasNextPage)return {posts,limited:false};
      after=result.pageInfo.endCursor;if(!after||seen.has(after))throw talkError('좋아요 알림의 다음 목록을 확인하지 못했습니다.');seen.add(after);
    }
    return {posts,limited:true};
  };
  const reactionHistory=async(id,{signal}={})=>{
    if(!nodeId(id))throw talkError('좋아요 대상 정보를 확인하세요.');
    const rows=await paginate(async after=>(await request(`query E2EReactionHistory($id:ID!,$after:String) { node(id:$id) { ... on Reactable { reactions(first:100,after:$after,content:HEART,orderBy:{field:CREATED_AT,direction:ASC}) { nodes { id createdAt user { ${actor} } } ${pageInfo} } } } }`,{id,after},signal)).node?.reactions);
    return rows.map(row=>({id:row.id,createdAt:row.createdAt,user:discussionIdentity(row.user)}));
  };
  const list=async()=>{
    warnings=[];await metadata();
    const [native,old]=await Promise.allSettled([nativeList(),legacy.list()]);
    if(native.status==='rejected')throw native.reason;
    if(old.status==='rejected')warnings.push('기존 이슈 글을 불러오지 못했습니다. 새로고침으로 다시 확인하세요.');
    // Converted discussions retain the app UUID. Prefer them over their old issue.
    const ids=new Set(native.value.map(post=>String(post.permalinkId)));
    return [...native.value,...(old.status==='fulfilled'?old.value:[]).filter(post=>!ids.has(String(post.permalinkId)))];
  };
  const post=async key=>{
    const data=await request(`query E2EDiscussion($owner:String!,$name:String!,$number:Int!) { repository(owner:$owner,name:$name) { discussion(number:$number) { ${DISCUSSION_FIELDS} } } }`,{...variables,number:discussionNumber(key)},undefined,{allowMissingDiscussion:true});
    if(!data.repository)throw talkError('저장소 접근 권한을 확인하세요.',403);
    const row=data.repository.discussion;
    if(row===null)return null;
    if(!row||typeof row!=='object')throw talkError('게시글 응답 형식을 확인하지 못했습니다.',-1);
    return discussionPost(row,pinState(row.id));
  };
  const requirePost=async key=>{const value=await post(key);if(!value)throw talkError('삭제되었거나 찾을 수 없는 글입니다.',404);return value;};
  const comments=async key=>{
    const roots=await paginate(async after=>(await request(`query E2EDiscussionComments($owner:String!,$name:String!,$number:Int!,$after:String) { repository(owner:$owner,name:$name) { discussion(number:$number) {
      comments(first:50,after:$after) { nodes { ${COMMENT_FIELDS} replies(first:50) { nodes { ${COMMENT_FIELDS} } ${pageInfo} } } ${pageInfo} }
    } } }`,{...variables,number:discussionNumber(key),after})).repository?.discussion?.comments);
    const rows=[];
    for(const root of roots){
      rows.push(discussionComment(root,key));const replies=root.replies;
      if(!Array.isArray(replies?.nodes)||typeof replies.pageInfo?.hasNextPage!=='boolean')throw talkError('답글을 확인하지 못했습니다.',-1);
      rows.push(...replies.nodes.filter(Boolean).map(row=>discussionComment(row,key)));
      if(replies.pageInfo.hasNextPage){
        const more=await paginate(async after=>(await request(`query E2EDiscussionReplies($id:ID!,$after:String) { node(id:$id) { ... on DiscussionComment { replies(first:50,after:$after) { nodes { ${COMMENT_FIELDS} } ${pageInfo} } } } }`,{id:root.id,after:after||replies.pageInfo.endCursor})).node?.replies);
        rows.push(...more.map(row=>discussionComment(row,key)));
      }
    }
    return [...new Map(rows.map(row=>[row.id,row])).values()];
  };
  const detail=async key=>isDiscussionKey(key)?{post:await requirePost(key),comments:await comments(key)}:legacy.detail(key);
  const owner=(value,permission)=>{auth();const role=typeof options.role==='function'?options.role():options.role;if(!talkCanManage(value,session.user,role))throw talkError('작성자 또는 관리자만 수정하거나 삭제할 수 있습니다.',403);if(!permission)throw talkError('GitHub의 수정 또는 삭제 권한을 확인하세요.',403);};
  const mutation=(name,type,input,selection)=>request(`mutation E2E${name[0].toUpperCase()+name.slice(1)}($input:${type}!) { ${name}(input:$input) { ${selection} } }`,{input});
  const verified=async(key,signature,{read,matches,validate,write,action})=>{
    if(locks.has(key))throw talkError('반영 중입니다. 잠시 후 확인하세요.');locks.add(key);
    try{
      if(uncertain.has(key)&&uncertain.get(key)!==signature)throw pending(action);
      let current;try{current=await read();}catch(error){if(uncertain.has(key))throw pending(action);throw error;}
      if(matches(current)){uncertain.delete(key);return current;}
      if(uncertain.has(key))throw pending(action);
      await validate(current);
      try{await write(current);}catch(error){if(error.status>=400&&error.status<500&&!error.partialMutation)throw error;uncertain.set(key,signature);}
      // A successful response is verified too. An unknown write is never replayed.
      uncertain.set(key,signature);
      try{const saved=await read();if(matches(saved)){uncertain.delete(key);return saved;}}catch{/* Keep recovery-only state. */}
      throw pending(action);
    }finally{locks.delete(key);}
  };
  const validateContent=({title,markdown,id,categoryId})=>{
    if(!title?.trim()||title.trim().length>TALK_LIMITS.title||!nodeId(categoryId))throw talkError('제목과 카테고리를 확인하세요.');
    return {title:title.trim(),body:encodeDiscussionBody(markdown,id,baseUrl),categoryId};
  };
  const create=async input=>{
    auth();const content=validateContent(input);
    return verified(`create:${input.id}`,JSON.stringify(content),{
      read:async()=>(await nativeList()).find(row=>row.permalinkId===input.id),
      matches:row=>{if(!row)return false;if(row.title!==content.title||row.body!==content.body||row.category?.id!==content.categoryId||!talkOwner(row,session.user))throw conflict();return true;},
      validate:async()=>{const meta=await metadata();if(!meta.categories.some(category=>category.id===content.categoryId))throw conflict();},
      write:()=>mutation('createDiscussion','CreateDiscussionInput',{...content,title:issueTitle('Talk',content.title),repositoryId:settings.id,clientMutationId:input.id},'discussion { id }')
    });
  };
  const update=async(baseline,input)=>{
    if(!isDiscussionKey(baseline.number))return legacy.update(baseline,input);
    const content=validateContent(input);
    return verified(`edit:${baseline.number}`,JSON.stringify(content),{
      read:()=>requirePost(baseline.number),matches:row=>{owner(row,row.canUpdate);return row.title===content.title&&row.body===content.body&&row.category?.id===content.categoryId;},
      validate:async row=>{if(!samePost(row,baseline))throw conflict();const meta=await metadata();if(!meta.categories.some(c=>c.id===content.categoryId))throw conflict();},
      write:row=>mutation('updateDiscussion','UpdateDiscussionInput',{discussionId:row.nodeId,...content,title:issueTitle('Talk',content.title)},'discussion { id }')
    });
  };
  const remove=async baseline=>{
    if(!isDiscussionKey(baseline.number))return legacy.remove(baseline);
    await verified(`delete:${baseline.number}`,baseline.nodeId,{action:'삭제',read:()=>post(baseline.number),matches:row=>!row,
      validate:row=>{owner(row,row.canDelete);if(!samePost(row,baseline))throw conflict();},write:row=>mutation('deleteDiscussion','DeleteDiscussionInput',{id:row.nodeId},'clientMutationId')});
    return baseline;
  };
  const reactions=async key=>{
    if(!isDiscussionKey(key))return legacy.reactions(key);const row=await requirePost(key);return {count:row.likes,mine:row.viewerHasLiked};
  };
  const like=async(key,desired)=>{
    if(!isDiscussionKey(key))return legacy.like(key,desired);
    const row=await verified(`like:${key}`,String(desired),{read:()=>requirePost(key),matches:row=>row.viewerHasLiked===desired,
      validate:row=>{if(!row.canReact)throw talkError('이 글에 반응할 권한이 없습니다.',403);},
      write:row=>mutation(desired?'addReaction':'removeReaction',desired?'AddReactionInput':'RemoveReactionInput',{subjectId:row.nodeId,content:'HEART'},'clientMutationId')});
    return {count:row.likes,mine:row.viewerHasLiked};
  };
  const requireComment=async(key,id)=>{
    await requirePost(key);
    const row=(await comments(key)).find(row=>row.id===id);
    if(!row)throw talkError('삭제되었거나 이 글에 속하지 않는 댓글입니다.',404);
    return row;
  };
  const commentReactions=async(key,id)=>{
    if(!isDiscussionKey(key))return legacy.commentReactions(key,id);
    const row=await requireComment(key,id);return {count:row.likes,mine:row.viewerHasLiked};
  };
  const likeComment=async(key,id,desired)=>{
    if(!isDiscussionKey(key))return legacy.likeComment(key,id,desired);
    const row=await verified(`comment-like:${key}:${id}`,String(desired),{read:()=>requireComment(key,id),matches:row=>row.viewerHasLiked===desired,
      validate:row=>{if(!row.canReact)throw talkError('이 댓글에 반응할 권한이 없습니다.',403);},
      write:row=>mutation(desired?'addReaction':'removeReaction',desired?'AddReactionInput':'RemoveReactionInput',{subjectId:row.nodeId,content:'HEART'},'clientMutationId')});
    return {count:row.likes,mine:row.viewerHasLiked};
  };
  const addComment=async(key,{body,id,replyTo=null,teamNotice=false})=>{
    auth();if(!TALK_UUID.test(id)||!String(body).trim())throw talkError('댓글 내용을 확인하세요.');
    const marker=`<!-- e2e-discussion-comment:${id} -->`,keyId=`comment:${key}:${id}`;
    let content;
    const read=()=>comments(key);
    return verified(keyId,JSON.stringify({body,replyTo}),{
      read:async()=>{const rows=await read();return {rows,saved:rows.find(row=>row.rawBody.endsWith(marker)&&talkOwner(row,session.user))};},
      matches:value=>{if(!value.saved)return false;if(!content){content=composeComment(value.rows);}if(value.saved.rawBody!==content)throw conflict();return true;},
      validate:async value=>{const row=await requirePost(key);if(row.locked)throw talkError('잠긴 글에는 댓글을 작성할 수 없습니다.',403);content=composeComment(value.rows);},
      write:async value=>{
        const current=await requirePost(key),parent=value.rows.find(row=>row.id===replyTo),root=parent?.replyTo||parent?.id;
        return mutation('addDiscussionComment','AddDiscussionCommentInput',{discussionId:current.nodeId,body:content,...(root?{replyToId:root}:{}),clientMutationId:id},'comment { id }');
      }
    }).then(value=>value.saved);
    function composeComment(rows){
      const parent=replyTo===null?null:rows.find(row=>row.id===replyTo);
      if(replyTo!==null&&!parent)throw talkError('원댓글이 삭제되었습니다. 답글 선택을 해제하세요.',409);
      const text=teamNotice?body:commentText(body);
      if(!teamNotice)validateTalkComment(text);
      return `${parent?`<!-- e2e-discussion-reply:${parent.user.login} -->\n@${parent.user.login}\n\n`:''}${text}\n\n[AI Talk에서 보기](${talkPermalink(baseUrl,key)})\n\n${marker}`;
    }
  };
  const comment=async(key,input)=>isDiscussionKey(key)?addComment(key,input):legacy.comment(key,input);
  const updateComment=async(key,baseline,text)=>{
    if(!isDiscussionKey(key))throw talkError('기존 이슈 댓글은 GHES에서 수정하세요.');
    const body=validateTalkComment(commentText(text));
    const prefix=/^<!-- e2e-discussion-reply:[a-z\d-]{1,39} -->\n@[a-z\d-]+\n\n/i.exec(baseline.rawBody||'')?.[0]||'';
    const suffix=/\n\n\[(?:AI|E2E) Talk에서 보기\]\(https?:\/\/[^\s)]+\)\n\n<!-- e2e-discussion-comment:[a-f\d-]{36} -->$/i.exec(baseline.rawBody||'')?.[0]||'';
    const content=`${prefix}${body}${suffix}`;
    const saved=await verified(`comment-edit:${baseline.id}`,body,{read:async()=>(await comments(key)).find(row=>row.id===baseline.id),
      matches:row=>{if(!row)throw talkError('삭제된 댓글입니다.',404);owner(row,row.canUpdate);return row.rawBody===content;},
      validate:row=>{if(row.updatedAt!==baseline.updatedAt||row.rawBody!==baseline.rawBody)throw conflict();},
      write:row=>mutation('updateDiscussionComment','UpdateDiscussionCommentInput',{commentId:row.id,body:content},'comment { id }')});return saved;
  };
  const deleteComment=async baseline=>{
    if(baseline.source!=='discussion')return legacy.deleteComment(baseline);
    await verified(`comment-delete:${baseline.id}`,baseline.updatedAt,{read:async()=>(await comments(baseline.number)).find(row=>row.id===baseline.id),matches:row=>!row,
      validate:row=>{owner(row,row.canDelete);if(row.updatedAt!==baseline.updatedAt||row.rawBody!==baseline.rawBody)throw conflict();},
      write:row=>mutation('deleteDiscussionComment','DeleteDiscussionCommentInput',{id:row.id},'clientMutationId')});
  };
  const answer=async(baseline,comment,desired)=>{
    const saved=await verified(`answer:${baseline.number}`,`${comment.id}:${desired}`,{read:()=>detail(baseline.number),
      matches:value=>desired?value.post.answerId===comment.id:value.post.answerId===null,
      validate:value=>{const current=value.comments.find(row=>row.id===comment.id);if(!value.post.category?.isAnswerable||!current||(desired?!current.canMarkAnswer:!current.canUnmarkAnswer))throw talkError('답변 채택 권한을 확인하세요.',403);if(value.post.answerId!==baseline.answerId)throw conflict();},
      write:()=>mutation(desired?'markDiscussionCommentAsAnswer':'unmarkDiscussionCommentAsAnswer',desired?'MarkDiscussionCommentAsAnswerInput':'UnmarkDiscussionCommentAsAnswerInput',{id:comment.id},'discussion { id }')});return saved;
  };
  const vote=async(key,optionId)=>verified(`vote:${key}`,optionId,{read:()=>requirePost(key),matches:row=>Boolean(row.poll?.options?.nodes?.find(option=>option.id===optionId)?.viewerHasVoted),
    validate:row=>{if(!row.poll?.viewerCanVote||row.poll.options?.pageInfo?.hasNextPage||!row.poll.options?.nodes?.some(option=>option.id===optionId)||row.locked)throw talkError('투표 권한과 선택 항목을 확인하세요.',403);},
    write:()=>mutation('addDiscussionPollVote','AddDiscussionPollVoteInput',{pollOptionId:optionId},'clientMutationId')});
  const pin=async(baseline,desired)=>{
    if(!isDiscussionKey(baseline.number))return legacy.pin(baseline,desired);
    auth();const role=typeof options.role==='function'?options.role():options.role;
    if(!talkModerator(role)||!(await legacy.capabilities()).manageContent)throw talkError('관리자만 글을 상단에 고정할 수 있습니다.',403);
    const current=await requirePost(baseline.number);
    pinOverrides=(await pinStore.save(current.nodeId,desired)).values;
    return {...current,...pinState(current.nodeId)};
  };
  return {...legacy,backend:'discussions',list,nativeList,activity,reactionPosts,reactionHistory,detail,create,update,remove,reactions,like,commentReactions,likeComment,comment,updateComment,deleteComment,answer,vote,pin,
    metadata,categories:async()=>(await metadata()).categories,warnings:()=>warnings,
    sendTeamNotice:(key,body,id)=>addComment(key,{body:body.replace(/\n\n\[(?:AI|E2E) Talk에서 보기\]\(https?:\/\/[^\s)]+\)$/,''),id,teamNotice:true}),
    nativeUrl:key=>`https://${GHES_CONFIG.host}/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/discussions/${discussionNumber(key)}`};
}
