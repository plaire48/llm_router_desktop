// Read GHES evidence only. Team history never determines effective permissions.
const loginPattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const actions = ['team.add_member', 'team.remove_member'];
const days90 = 90 * 24 * 60 * 60 * 1000;

export function createTeamChangeHistory({request, requireAdmin, profile, hostRoot, owner, teams, now = Date.now,canReadAudit=async()=>false}) {
  let auditDenied=false;
  return async (users,{refresh=false,signal}={}) => {
    await requireAdmin();
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(refresh)auditDenied=false;
    if(auditDenied||!await canReadAudit(signal,{refresh}))return {items:[],limited:false,available:false};
    const targets = new Map(users.map(user => [user.login.toLowerCase(), user.id]));
    const allowedTeams = new Set(teams.map(team => `${owner}/${team.slug}`.toLowerCase()));
    const latest = new Map(), cutoff = now() - days90;
    let limited = false;
    for (const action of actions) {
      for (let page = 1; page <= 3; page++) {
        const query = new URLSearchParams({phrase:`action:${action} created:>=${new Date(cutoff).toISOString().slice(0,10)}`, include:'web', order:'desc', per_page:'100', page:String(page)});
        let rows;
        try {rows=await request(`${hostRoot}/orgs/${encodeURIComponent(owner)}/audit-log?${query}`,{signal});}
        catch(error){
          // An owner can still lack token permissions. Stop optional audit reads
          // for this session while leaving the user list and team editing usable.
          if([403,404].includes(error.status)){auditDenied=true;return {items:[],limited:false,available:false};}
          throw error;
        }
        if (!Array.isArray(rows)) throw Error('팀 변경 기록의 응답 형식을 확인하지 못했습니다.');
        for (const row of rows) {
          const id = targets.get(String(row.user || '').toLowerCase());
          const rawTime = row.created_at ?? row['@timestamp'];
          const time = typeof rawTime === 'number' ? rawTime : Date.parse(rawTime);
          if (!id || row.action !== action || !allowedTeams.has(String(row.team || '').toLowerCase()) ||
              String(row.org || '').toLowerCase() !== owner.toLowerCase() ||
              (row.user_id != null && row.user_id !== id) || !Number.isFinite(time) || time < cutoff || time > now()) continue;
          if ((latest.get(id)?.time ?? -Infinity) >= time) continue;
          // Exclude IPs, token metadata and device information from retained data.
          const actor = typeof row.actor==='string'&&loginPattern.test(row.actor) ? {login:row.actor, ...(Number.isSafeInteger(row.actor_id) ? {id:row.actor_id} : {})} : null;
          latest.set(id, {userId:id, time, date:new Date(time).toISOString(), action, team:teams.find(team=>`${owner}/${team.slug}`.toLowerCase()===row.team.toLowerCase()).label, actor});
        }
        if (rows.length < 100) break;
        if (page === 3) limited = true;
      }
    }
    const actors = [...new Map([...latest.values()].filter(item=>item.actor).map(item=>[item.actor.login.toLowerCase(),item.actor])).values()];
    const profiles = new Map(users.map(user=>[user.login.toLowerCase(),user]));
    const missing = actors.filter(actor=>!profiles.has(actor.login.toLowerCase()));
    for (let offset=0;offset<missing.length;offset+=4) {
      await Promise.all(missing.slice(offset,offset+4).map(async actor=>{
        try {const value=await profile(actor.id||actor.login);profiles.set(actor.login.toLowerCase(),value);} catch {/* Keep the recorded ID when its public profile is unavailable. */}
      }));
    }
    const items=[...latest.values()].map(({time,...item})=>{
      const candidate=item.actor&&profiles.get(item.actor.login.toLowerCase());
      const actor=candidate&&(!item.actor.id||candidate.id===item.actor.id)?candidate:item.actor;
      return {...item,actor:actor?{id:actor.id,login:actor.login,name:actor.name,avatar_url:actor.avatar_url}:null};
    });
    return {items,limited};
  };
}
