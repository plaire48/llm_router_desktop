const validId = id => Number.isSafeInteger(id) && id > 0;
const loginPattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
export const commentText = value => String(value || '').trim().replace(/<!--\s*e2e-(?:reply|talk-comment|discussion-reply|discussion-comment|inquiry-comment|inquiry-notify):/gi, match => match.replace('<', '&lt;'));
export function encodeReply(text, parent, repository, number) {
  if (!parent) return text;
  if (!validId(parent.id) || !loginPattern.test(parent.user?.login || '')) throw Error('답글을 받을 댓글의 작성자를 확인하지 못했습니다.');
  const url = new URL(`${repository}/issues/${number}#issuecomment-${parent.id}`);
  if (!['https:', 'http:'].includes(url.protocol)) throw Error('댓글 주소를 확인하세요.');
  return `<!-- e2e-reply:${parent.id}:${parent.user.login} -->\n@${parent.user.login} 님의 [댓글에 답글](${url.href})\n\n${text}`;
}
export function decodeReply(body) {
  const text = String(body || '');
  const match = /^<!-- e2e-reply:(\d+):([a-z\d-]+) -->\n@\2 님의 \[댓글에 답글\]\(https?:\/\/[^\s)]+#issuecomment-\1\)\n\n/i.exec(text);
  if (!match || !validId(Number(match[1])) || !loginPattern.test(match[2])) return {body:text, replyTo:null, replyLogin:null};
  return {body:text.slice(match[0].length), replyTo:Number(match[1]), replyLogin:match[2]};
}
// All reply depths share one visual indentation. Keep the immediate recipient.
export function orderedComments(comments) {
  const byId = new Map(comments.map(item => [item.id, item]));
  const roots = new Map();
  const rootOf = item => {
    if (roots.has(item.id)) return roots.get(item.id);
    const path = [], seen = new Map(); let current = item, root;
    while (true) {
      if (roots.has(current.id)) { root = roots.get(current.id); break; }
      if (seen.has(current.id)) { root = path.slice(seen.get(current.id)).sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}))[0]; break; }
      seen.set(current.id,path.length);path.push(current.id);
      if (!current.replyTo || !byId.has(current.replyTo)) { root = current.id; break; }
      current = byId.get(current.replyTo);
    }
    for (const id of path) roots.set(id,root);
    return root;
  };
  const groups = new Map();
  for (const item of comments) { const root = rootOf(item); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(item); }
  return [...groups.entries()].flatMap(([root, rows]) => rows.sort((a,b) => (a.id===root?-1:b.id===root?1:Date.parse(a.createdAt)-Date.parse(b.createdAt)||String(a.id).localeCompare(String(b.id)))).map(item => ({...item, rootId:root, nested:item.id!==root, orphaned:Boolean(item.replyTo&&!byId.has(item.replyTo))})));
}

export function groupComments(comments) {
  const groups = new Map();
  for (const comment of orderedComments(comments)) {
    if (!groups.has(comment.rootId)) groups.set(comment.rootId,{root:comment,replies:[]});
    else groups.get(comment.rootId).replies.push(comment);
  }
  return [...groups.values()];
}

// Rank whole conversations so a popular reply never loses its parent context.
export function rankCommentGroups(comments,threshold=10) {
  return groupComments(comments).map((group,index)=>({...group,index,popularLikes:Math.max(0,...[group.root,...group.replies].map(row=>Number(row.likes)||0))}))
    .sort((a,b)=>(b.popularLikes>=threshold?b.popularLikes:0)-(a.popularLikes>=threshold?a.popularLikes:0)||a.index-b.index);
}
