// Confirmed app changes travel with the existing Role issue, not a profile file.
// This is display metadata, never evidence for granting access.
const loginPattern=/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const receiptPattern=/^<!-- e2e-team-change:v1:(\d+):(\d+):([a-z\d-]+):([a-z\d-]+):(add|remove):(\d+):(\d+) -->$/i;
const rolePattern=/^<!-- e2e-role-notice:[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}:(\d+):(user|editor|system) -->$/i;
const identityId=value=>Number.isSafeInteger(value)&&value>0;

export function encodeTeamHistoryReceipt(changes,{userId,actor,teams}) {
  if(!Array.isArray(changes)||changes.length>3)throw Error('팀 변경 기록을 확인하지 못했습니다.');
  return changes.map(change=>{
    const team=teams.find(team=>team.label===change.team),started=Date.parse(change.startedAt),confirmed=Date.parse(change.date);
    if(change.source!=='save'||change.userId!==userId||!identityId(userId)||!identityId(actor?.id)||
      change.actor?.id!==actor.id||!loginPattern.test(change.actor?.login||'')||!loginPattern.test(actor.login)||change.actor.login.toLowerCase()!==actor.login.toLowerCase()||
      !team||!['team.add_member','team.remove_member'].includes(change.action)||!Number.isSafeInteger(started)||started<=0||!Number.isSafeInteger(confirmed)||confirmed<started)
      throw Error('팀 변경 기록을 확인하지 못했습니다.');
    return `<!-- e2e-team-change:v1:${userId}:${actor.id}:${actor.login}:${team.slug}:${change.action==='team.add_member'?'add':'remove'}:${started}:${confirmed} -->`;
  }).join('\n');
}

export function decodeTeamHistoryReceipt(issue,{users,teams,now=Date.now()}) {
  if(issue.pull_request||!identityId(issue.number)||!identityId(issue.user?.id)||!loginPattern.test(issue.user?.login||''))return [];
  const lines=String(issue.body||'').split('\n'),role=rolePattern.exec(lines[0]);
  if(!role||!users.some(user=>user.id===Number(role[1])))return [];
  const issueTime=Date.parse(issue.created_at);
  if(!Number.isFinite(issueTime))return [];
  return lines.flatMap(line=>{
    const match=receiptPattern.exec(line);if(!match)return [];
    const [,target,actorId,actorLogin,slug,action,start,end]=match;
    const userId=Number(target),started=Number(start),confirmed=Number(end),team=teams.find(team=>team.slug===slug);
    if(target!==role[1]||Number(actorId)!==issue.user.id||!loginPattern.test(actorLogin)||!team||
      !Number.isSafeInteger(started)||started<=0||!Number.isSafeInteger(confirmed)||confirmed<started||confirmed>Math.min(now,issueTime)+300000)return [];
    return [{userId,source:'receipt',startedAt:new Date(started).toISOString(),date:new Date(confirmed).toISOString(),
      action:action==='add'?'team.add_member':'team.remove_member',team:team.label,
      actor:{id:issue.user.id,login:issue.user.login},issueNumber:issue.number}];
  });
}

// Both the user table and its notifications reconstruct the same confirmed
// changes. Retain all receipts here; each caller chooses its own display scope.
export async function loadTeamHistoryReceipts({request,root,teams,users,signal,now=Date.now()}) {
    signal?.throwIfAborted();
    const items=[];let limited=false;
    for(let page=1;page<=10;page++){
      const rows=await request(`${root}/issues?state=all&labels=Role&sort=created&direction=desc&per_page=100&page=${page}`,{signal});
      if(!Array.isArray(rows))throw Error('팀 변경 알림 기록을 불러오지 못했습니다.');
      for(const issue of rows)items.push(...decodeTeamHistoryReceipt(issue,{users,teams,now}));
      if(rows.length<100)break;
      if(page===10)limited=true;
    }
    signal?.throwIfAborted();
    return {items,limited};
}

export function createTeamHistoryReceiptReader({request,requireAdmin,profile,root,teams,now=Date.now}) {
  return async(users,{signal}={})=>{
    await requireAdmin();
    const {items,limited}=await loadTeamHistoryReceipts({request,root,teams,users,signal,now:now()});
    const latest=new Map();
    for(const item of items)if(!latest.has(item.userId)||Date.parse(latest.get(item.userId).date)<Date.parse(item.date))latest.set(item.userId,item);
    const profiles=new Map(users.map(user=>[user.id,user]));
    const missing=[...new Set([...latest.values()].map(item=>item.actor.id))].filter(id=>!profiles.has(id));
    for(let offset=0;offset<missing.length;offset+=4)await Promise.all(missing.slice(offset,offset+4).map(async id=>{
      try{const user=await profile(id,{signal});if(user.id===id)profiles.set(id,user);}catch{/* Keep the issue author's identity. */}
    }));
    signal?.throwIfAborted();
    return {limited,items:[...latest.values()].map(item=>{
      const actor=profiles.get(item.actor.id)||item.actor;
      return {...item,actor:{id:actor.id,login:actor.login,name:actor.name,avatar_url:actor.avatar_url}};
    })};
  };
}
