import {displayIssueTitle} from './issuePresentation.js';
import {decodeReply} from './commentThread.js';
export const TALK_PIN_LABEL = 'e2e-talk:pinned';
export const TALK_LIMITS = Object.freeze({title:120, body:50000, comment:500, files:8, imageBytes:10*1024*1024, videoBytes:25*1024*1024});
export const TALK_LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
export const TALK_UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const start = /<!-- e2e-talk:v[12]:([a-f\d-]{36}) -->\n?/i;
const end = '\n<!-- /e2e-talk -->';
export const talkError = (message,status=0) => Object.assign(new Error(message),{status});
export const talkModerator = role => role === 'editor' || role === 'system';
export const isTalkPost = issue => !issue?.pull_request&&/^<!-- e2e-talk:v1:[a-f\d-]{36} -->\n/i.test(issue?.body||'');
export const talkOwner = (item,user) => Boolean(item?.user?.id && item.user.id === user?.id);
export const talkCanManage = (item,user,role) => Boolean(Number.isSafeInteger(user?.id)&&user.id>0)&&(talkOwner(item,user)||talkModerator(role));
export function talkPermalink(base,id) {
  const url = new URL(base);
  if(!['https:','http:'].includes(url.protocol)) throw talkError('게시판 주소를 확인하세요.');
  if(!TALK_UUID.test(String(id))&&!/^(?:d)?[1-9]\d*$/.test(String(id)))throw talkError('글 주소를 확인하세요.');
  url.hash=`talk=${id}`;return url.href;
}
export function encodeTalkBody(html,id,base) {
  if(!TALK_UUID.test(id))throw talkError('글의 요청 정보를 확인하세요.');
  const text=String(html||'').trim();
  if(!text||text.length>TALK_LIMITS.body)throw talkError(`본문은 ${TALK_LIMITS.body.toLocaleString()}자까지 입력하세요.`);
  // The permalink is visible in GitHub notification emails as well as on the issue page.
  const mentionText=text.replace(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ');
  const mentions=[...new Set([...mentionText.matchAll(/(?:^|[\s(])@([a-z\d][a-z\d-]{0,38})(?=$|[\s),.!?:;])/gi)].map(match=>match[1].toLowerCase()))];
  if(mentions.length>20)throw talkError('한 글에서는 최대 20명까지 언급할 수 있습니다.');
  // Raw HTML is separated from plain Markdown mentions so GHES can notify users.
  const result=`<!-- e2e-talk:v1:${id} -->\n${text}${end}${mentions.length?'\n\n'+mentions.map(login=>'@'+login).join(' '):''}\n\n[AI Talk에서 보기](${talkPermalink(base,id)})`;
  if(new TextEncoder().encode(result).length>65000)throw talkError('본문 용량이 큽니다. 내용을 줄이거나 글을 나누세요.');
  return result;
}
export function decodeTalkBody(body) {
  const text=String(body||''),match=text.match(start),stop=text.lastIndexOf(end);
  if(match&&stop>match.index){
    const core=text.slice(match.index+match[0].length,stop);
    const extra=text.slice(stop+end.length).replace(/\[(?:AI|E2E) Talk에서 보기\]\(https?:\/\/[^\s)]+\)/g,'').replace(/^\s*(?:@[a-z\d][a-z\d-]*\s*)+$/gim,'').trim();
    return {id:match[1],html:extra?`${core}\n\n${extra}`:core,format:extra||match[0].includes(':v2:')?'markdown':'html'};
  }
  return {id:match?.[1]||null,html:text.replace(start,'').replace(end,''),format:'markdown'};
}
export function talkIdentity(user) {
  if(!user||!TALK_LOGIN.test(user.login||'')||!Number.isSafeInteger(user.id))throw talkError('작성자 정보를 확인하지 못했습니다.');
  return {id:user.id,login:user.login,name:typeof user.name==='string'?user.name:null,avatar_url:typeof user.avatar_url==='string'?user.avatar_url:null};
}
export function talkPost(issue) {
  if(!Number.isSafeInteger(issue?.number)||issue.number<1||typeof issue.title!=='string'||!Number.isFinite(Date.parse(issue.created_at))||!Number.isFinite(Date.parse(issue.updated_at)))throw talkError('글 정보를 확인하지 못했습니다.');
  return {number:issue.number,nodeId:issue.node_id, title:displayIssueTitle(issue.title),rawTitle:issue.title,body:issue.body||'',user:talkIdentity(issue.user),createdAt:issue.created_at,updatedAt:issue.updated_at,
    state:issue.state, comments:Math.max(0,Number(issue.comments)||0),likes:Math.max(0,Number(issue.reactions?.heart)||0),
    pinned:Array.isArray(issue.labels)&&issue.labels.some(label=>(typeof label==='string'?label:label.name)===TALK_PIN_LABEL),
    permalinkId:decodeTalkBody(issue.body).id||issue.number};
}
export function talkComment(item) {
  if(!Number.isSafeInteger(item?.id)||typeof item.body!=='string'||!Number.isFinite(Date.parse(item.created_at))||!Number.isFinite(Date.parse(item.updated_at)))throw talkError('댓글 정보를 확인하지 못했습니다.');
  return {id:item.id,likes:Math.max(0,Number(item.reactions?.heart)||0),...decodeReply(item.body.replace(/(?:\n\n\[(?:AI|E2E) Talk에서 보기\]\(https?:\/\/[^\s)]+\))?\n\n<!-- e2e-talk-comment:[a-f\d-]{36} -->$/i,'')),user:talkIdentity(item.user),createdAt:item.created_at,updatedAt:item.updated_at};
}
export function sortTalkPosts(posts,{query='',sort='latest',mine=null}={}) {
  const needle=query.trim().toLocaleLowerCase();
  return posts.filter(post=>post.state==='open'&&(!mine||post.user.id===mine)&&(!needle||`${post.title} ${decodeTalkBody(post.body).html.replace(/<[^>]*>/g,' ')} ${post.user.login} ${post.user.name||''}`.toLocaleLowerCase().includes(needle)))
    .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(a.pinned&&b.pinned?(a.pinOrder??99)-(b.pinOrder??99):0)||(sort==='popular'?b.likes-a.likes:0)||Date.parse(b.createdAt)-Date.parse(a.createdAt)||String(b.number).localeCompare(String(a.number),undefined,{numeric:true}));
}
