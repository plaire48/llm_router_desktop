import {GHES_CONFIG} from './config.js';
import {ghesFetch} from './hostFetch.js';

// Repository Admin and team Maintainer do not imply organization audit access.
// Check only the signed-in user's own membership; keep no organization directory.
export function createOrganizationAuditAccess({session,fetchImpl=ghesFetch,owner=GHES_CONFIG.owner}={}) {
  let permission;
  const canRead=async (signal,{refresh=false}={})=>{
    if(!session?.token?.trim()||['null','undefined'].includes(session.token.trim())||session.host!==GHES_CONFIG.host||!session.user?.login)return false;
    if(!/^[a-z\d][a-z\d-]{0,38}$/i.test(owner||''))return false;
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(refresh)permission=undefined;
    if(permission===undefined) {
      const controller=new AbortController(),abort=()=>controller.abort();
      signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(abort,15000);
      try {
        const response=await fetchImpl(`https://${session.host}/api/v3/user/memberships/orgs/${encodeURIComponent(owner)}`,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${session.token}`}});
        if([403,404].includes(response.status)){await response.body?.cancel().catch(()=>{});permission=false;}
        else if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(Error('조직 감사 로그 조회 권한을 확인하지 못했습니다.'),{status:response.status});}
        else {
          const member=await response.json();
          const organization=member?.organization?.login;
          permission=member?.state==='active'&&member.role==='admin'&&(organization==null||typeof organization==='string'&&organization.toLowerCase()===owner.toLowerCase());
        }
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    return permission;
  };
  return {canRead};
}
