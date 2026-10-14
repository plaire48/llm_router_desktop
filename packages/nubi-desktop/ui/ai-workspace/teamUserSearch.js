import {githubDisplayIdentity} from './githubIdentity.js';
import {profileEmail} from './profileEmail.js';

const query = `query E2ETeamUserSearch($query: String!, $after: String) {
  search(query: $query, type: USER, first: 20, after: $after) {
    nodes { ... on User { databaseId login name avatarUrl email } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export function createTeamUserSearch({request,requireAdmin,hostRoot,profile}) {
  return async (value,{after=null,signal}={}) => {
    const term=String(value||'').trim().normalize('NFC');
    if(!term)return {users:[],next:null};
    if(term.length>100||/[\u0000-\u001f\u007f]/u.test(term))throw Error('검색어는 100자 이내로 입력하세요.');
    if(after!==null&&(typeof after!=='string'||!after||after.length>512))throw Error('검색 결과를 다시 불러오세요.');
    await requireAdmin();signal?.throwIfAborted();
    // An authenticated GHES search, not a local filter of the current organization.
    // Keep the user's input inside a quoted search term and explicitly include names.
    const result=await request(hostRoot.replace(/\/api\/v3$/,'/api/graphql'),{method:'POST',signal,body:{query,variables:{query:`${JSON.stringify(term)} in:login,fullname,email type:user`,after}}});
    signal?.throwIfAborted();
    if(result?.errors?.length)throw Error('사용자를 검색하지 못했습니다. GHES 검색 권한과 상태를 확인하세요.');
    const data=result?.data?.search;
    if(!Array.isArray(data?.nodes)||data.nodes.length>20||typeof data.pageInfo?.hasNextPage!=='boolean')throw Error('사용자 검색 결과를 확인하지 못했습니다.');
    const users=new Map();
    for(const row of data.nodes){
      if(!Number.isSafeInteger(row?.databaseId)||row.databaseId<1||!/^[a-z\d][a-z\d-]{0,38}$/i.test(row.login||''))throw Error('사용자 검색 결과를 확인하지 못했습니다.');
      users.set(row.databaseId,{...githubDisplayIdentity({...row,id:row.databaseId,avatar_url:row.avatarUrl}),email:profileEmail(row.email)});
    }
    const next=data.pageInfo.hasNextPage?data.pageInfo.endCursor:null;
    if(next!==null&&(typeof next!=='string'||!next||next.length>512||next===after))throw Error('다음 검색 결과를 확인하지 못했습니다.');
    // Search can omit an email that the public REST profile exposes. Use the
    // same profile reader as the directory before treating it as unavailable.
    const records=[...users.values()],missing=records.filter(user=>!user.email);
    for(let offset=0;offset<missing.length;offset+=4){
      signal?.throwIfAborted();
      await Promise.all(missing.slice(offset,offset+4).map(async user=>{
        try{
          const detail=await profile(user.id,{signal});
          signal?.throwIfAborted();
          if(detail?.id!==user.id)throw Error('사용자 계정을 확인하세요.');
          user.email=profileEmail(detail.email);
        }catch(error){
          signal?.throwIfAborted();
          if(error?.name==='AbortError')throw error;
          user.emailUnavailable=true;
        }
      }));
    }
    signal?.throwIfAborted();
    return {users:records,next};
  };
}
