const loginPattern=/^[a-z\d][a-z\d-]{0,38}$/i;
const slugPattern=/^[a-z\d][a-z\d-]{0,99}$/i;
const pending=new WeakMap();

// Share only simultaneous reads. Keep no completed roster or personal profile cache.
// An absent login in a complete 200 response is not a failed HTTP request.
export async function teamMemberLogins(request,{owner,team}) {
  if(!slugPattern.test(owner||'')||!slugPattern.test(team||''))throw Error('관리자 팀과 조직을 확인하세요.');
  const path=`/orgs/${encodeURIComponent(owner)}/teams/${encodeURIComponent(team)}/members`;
  let reads=pending.get(request);if(!reads){reads=new Map();pending.set(request,reads);}
  if(reads.has(path))return reads.get(path);
  const load=(async()=>{
    const logins=new Set();
    for(let page=1;page<=100;page++) {
      const rows=await request(`${path}?per_page=100&page=${page}`);
      if(!Array.isArray(rows)||rows.length>100)throw Error('팀 소속을 확인하지 못했습니다. 다시 조회하세요.');
      for(const row of rows) {
        if(row?.type==='Bot')continue;
        if(!Number.isSafeInteger(row?.id)||row.id<1||row.type!=='User'||!loginPattern.test(row.login||''))throw Error('팀 소속을 확인하지 못했습니다. 다시 조회하세요.');
        logins.add(row.login.toLowerCase());
      }
      if(rows.length<100)return logins;
    }
    throw Error('팀 사용자 목록이 너무 큽니다. GHES에서 확인하세요.');
  })();
  reads.set(path,load);
  try{return await load;}finally{if(reads.get(path)===load)reads.delete(path);}
}

export async function hasTeamMember(request,login,team) {
  if(!loginPattern.test(login||''))throw Error('GitHub ID를 확인하세요.');
  return (await teamMemberLogins(request,team)).has(login.toLowerCase());
}
