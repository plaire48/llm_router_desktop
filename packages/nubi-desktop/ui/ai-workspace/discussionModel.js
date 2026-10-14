import {TALK_LIMITS,TALK_UUID,TALK_LOGIN,talkError,talkPermalink,decodeTalkBody} from './talkModel.js';
import {displayIssueTitle} from './issuePresentation.js';

export const discussionKey = number => `d${number}`;
export const isDiscussionKey = value => /^d[1-9]\d*$/.test(String(value));
export function discussionNumber(key) {
  const number=Number(String(key).slice(1));
  if(!isDiscussionKey(key)||!Number.isSafeInteger(number))throw talkError('글 주소를 확인하세요.');
  return number;
}
export const nodeId = value => typeof value==='string'&&value.length>0&&value.length<256;
// The emoji the category owner picked in GHES, as a unicode character (emojiHTML wraps it in <g-emoji>); empty when
// only a :shortcode: is known, in which case the icon table below applies (user request 2026-10-14).
export function discussionCategoryEmoji(category) {
  const fromHtml=String(category?.emojiHTML||'').replace(/<[^>]*>/g,'').trim();
  if(fromHtml&&!/^:[\w+-]+:$/.test(fromHtml))return fromHtml.slice(0,8);
  const raw=String(category?.emoji||'').trim();
  return raw&&!/^:[\w+-]+:$/.test(raw)?raw.slice(0,8):'';
}
export function discussionCategoryIcon(category) {
  const key=String(category?.slug||category?.name||'').toLowerCase().replace(/[\s_&-]/g,'');
  if(['announcement','announcements','공지','공지사항','안내'].includes(key))return 'megaphone';
  if(['idea','ideas','아이디어','제안'].includes(key))return 'lightbulb';
  if(['poll','polls','투표','설문'].includes(key))return 'chartColumn';
  if(['qanda','qa','질문','질문과답변'].includes(key))return 'helpCircle';
  if(['showandtell','showtell','공유','사례공유'].includes(key))return 'presentation';
  if(['general','discussion','discussions','일반','이야기','자유게시판'].includes(key))return 'message';
  const emoji=String(category?.emoji||'').replace(/\uFE0F/g,'');
  const icons={':mega:':'megaphone',':loudspeaker:':'megaphone','📣':'megaphone','📢':'megaphone',':bulb:':'lightbulb','💡':'lightbulb',':bar_chart:':'chartColumn','📊':'chartColumn',':question:':'helpCircle','❓':'helpCircle',':pray:':'helpCircle','🙏':'helpCircle',':speech_balloon:':'message','💬':'message',':raised_hands:':'presentation','🙌':'presentation'};
  return Object.hasOwn(icons,emoji)?icons[emoji]:(category?.isAnswerable?'helpCircle':'tag');
}
export function discussionIdentity(author) {
  if(!author)return {id:0,login:'ghost',name:'삭제된 사용자',avatar_url:null};
  if(!TALK_LOGIN.test(author.login||''))throw talkError('작성자 정보를 확인하지 못했습니다.');
  return {id:Number.isSafeInteger(author.databaseId)?author.databaseId:0,login:author.login,name:author.name||null,avatar_url:author.avatarUrl||null};
}
export function discussionPost(row,{pinned=false,pinOrder=null}={}) {
  if(!nodeId(row?.id)||!Number.isSafeInteger(row.number)||row.number<1||typeof row.title!=='string'||typeof row.body!=='string'||!Number.isFinite(Date.parse(row.updatedAt))||!Number.isFinite(Date.parse(row.createdAt)))throw talkError('게시글 응답 형식을 확인하지 못했습니다.');
  const heart=row.reactionGroups?.find(group=>group.content==='HEART');
  return {source:'discussion',number:discussionKey(row.number),discussionNumber:row.number,nodeId:row.id,url:row.url,
    title:displayIssueTitle(row.title),rawTitle:row.title,body:row.body,user:discussionIdentity(row.author),createdAt:row.createdAt,updatedAt:row.updatedAt,
    state:'open',comments:row.comments?.totalCount||0,likes:heart?.reactors?.totalCount||0,viewerHasLiked:Boolean(heart?.viewerHasReacted),pinned,pinOrder,
    category:row.category,answerId:row.answer?.id||null,isAnswered:Boolean(row.isAnswered),locked:Boolean(row.locked),closed:Boolean(row.closed),poll:row.poll||null,
    canUpdate:Boolean(row.viewerCanUpdate),canDelete:Boolean(row.viewerCanDelete),canReact:Boolean(row.viewerCanReact),
    subscription:row.viewerSubscription,
    permalinkId:decodeTalkBody(row.body).id||discussionKey(row.number)};
}
export function discussionComment(row,number) {
  if(!nodeId(row?.id)||typeof row.body!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))throw talkError('댓글 응답 형식을 확인하지 못했습니다.');
  const text=row.body.replace(/\n\n\[(?:AI|E2E) Talk에서 보기\]\(https?:\/\/[^\s)]+\)\n\n<!-- e2e-discussion-comment:[a-f\d-]{36} -->$/i,'');
  const mention=/^<!-- e2e-discussion-reply:([a-z\d-]{1,39}) -->\n@\1\n\n/i.exec(text);
  const body=mention?text.slice(mention[0].length):text,heart=row.reactionGroups?.find(group=>group.content==='HEART');
  return {source:'discussion',likes:heart?.reactors?.totalCount||0,viewerHasLiked:Boolean(heart?.viewerHasReacted),canReact:Boolean(row.viewerCanReact),id:row.id,nodeId:row.id,number,rawBody:row.body,body,user:discussionIdentity(row.author),
    createdAt:row.createdAt,updatedAt:row.updatedAt,replyTo:row.replyTo?.id||null,replyLogin:mention?.[1]||row.replyTo?.author?.login||null,
    isAnswer:Boolean(row.isAnswer),canMarkAnswer:Boolean(row.viewerCanMarkAsAnswer),canUnmarkAnswer:Boolean(row.viewerCanUnmarkAsAnswer),
    canUpdate:Boolean(row.viewerCanUpdate),canDelete:Boolean(row.viewerCanDelete),url:row.url};
}
export function encodeDiscussionBody(markdown,id,baseUrl) {
  const text=String(markdown||'').trim();
  if(!TALK_UUID.test(id)||!text||text.length>TALK_LIMITS.body)throw talkError('제목과 본문 길이를 확인하세요.');
  // Native Markdown keeps mentions, fenced code, tables and task lists meaningful in GHES.
  const body=`<!-- e2e-talk:v2:${id} -->\n${text}\n<!-- /e2e-talk -->\n\n[AI Talk에서 보기](${talkPermalink(baseUrl,id)})`;
  if(new TextEncoder().encode(body).length>65000)throw talkError('본문 용량이 큽니다. 내용을 나누어 등록하세요.');
  return body;
}
