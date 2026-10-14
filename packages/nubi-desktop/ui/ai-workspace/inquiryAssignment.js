import {GHES_CONFIG,SERVICE_DESK_CONFIG,SERVICE_DESK_TEAMS} from './config.js';
import {getServiceDeskSession} from './serviceDeskClient.js';
import {isInquiry,inquiryRecord} from './inquiryClient.js';
import {githubDisplayIdentity} from './githubIdentity.js';
import {createAdminClient} from './adminClient.js';
import {editorMembership} from './editorMembership.js';
import {githubAccessMessage} from './githubAccessMessage.js';
import {githubRequestDiagnostic} from './githubRequestDiagnostic.js';
import {ghesFetch} from './hostFetch.js';

const loginPattern=/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const fail=(message,status=0)=>Object.assign(Error(message),{status});
export function createInquiryAssignmentClient({session=getServiceDeskSession(),config=SERVICE_DESK_CONFIG,teams=SERVICE_DESK_TEAMS,fetchImpl=ghesFetch}={}) {
  const signedIn=Boolean(session?.token?.trim()&&!['null','undefined'].includes(session.token.trim())&&session.host===GHES_CONFIG.host&&loginPattern.test(session.user?.login||''));
  const base=`https://${GHES_CONFIG.host}/api/v3`,root=`${base}/repos/${config.owner}/${config.repo}`;
  const request=async(path,{method='GET',body,empty=false}={})=>{
    if(!signedIn)throw fail('로그인 후 담당자를 배정하세요.',401);
    let response;
    try {response=await fetchImpl(path,{method,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${session.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});}
    catch {throw fail(method==='GET'?'담당자를 불러오지 못했습니다.':'배정 결과를 확인하지 못했습니다. 문의를 새로고침해 확인하세요.');}
    if(!response.ok){
      const diagnostic=githubRequestDiagnostic(path,method,response,session.token);
      await response.body?.cancel().catch(()=>{});
      throw Object.assign(fail(githubAccessMessage(path,method,response.status)||({401:'로그인이 만료되었습니다.',403:'문의 저장소 접근 권한과 App의 설치 범위를 확인하세요. (HTTP 403)',404:'문의 저장소와 App의 설치 범위를 확인하세요. (HTTP 404)',422:'담당자 계정과 문의 배정 가능 여부를 확인하세요.'})[response.status]||'담당자 정보를 확인하지 못했습니다. 문의를 새로고침하세요.',response.status),diagnostic);
    }
    if(empty){await response.body?.cancel().catch(()=>{});return;}
    try{return await response.json();}catch{throw fail('담당자 응답을 확인하지 못했습니다. 문의를 새로고침하세요.');}
  };
  const canAssign=async()=>signedIn&&['editor','system'].includes(await createAdminClient({session,fetchImpl}).role())&&(await request(root)).permissions?.push===true;
  const requireManager=async()=>{if(!await canAssign())throw fail('문의 담당자는 관리자와 시스템 관리자가 배정할 수 있습니다.',403);};
  // Ordinary image writers can assign their own new inquiry. Reassigning an
  // existing inquiry still requires an E2E manager role in this application.
  const requireCreator=async()=>{if(!signedIn||(await request(root)).permissions?.push!==true)throw fail('접수 시 담당자 배정에는 문의 저장소의 Write 권한이 필요합니다.',403);};
  const roster=async()=>{
    if(!teams.length||teams.some(slug=>!/^[a-z\d][a-z\d-]{0,99}$/i.test(slug)))throw fail('문의 담당자 팀 설정을 확인하세요.');
    const users=new Map();
    for(const team of [...new Set(teams)]) {
      for(let page=1;page<=100;page++) {
        const rows=await request(`${base}/orgs/${encodeURIComponent(config.owner)}/teams/${encodeURIComponent(team)}/members?per_page=100&page=${page}`);
        if(!Array.isArray(rows))throw fail('팀 사용자 목록을 확인하지 못했습니다.');
        for(const row of rows){
          if(row.type==='Bot')continue;
          if(row.type!=='User'||!Number.isSafeInteger(row.id)||!loginPattern.test(row.login||''))throw fail('팀 사용자 계정을 확인하지 못했습니다.');
          const current=users.get(row.id);
          users.set(row.id,{...githubDisplayIdentity(row),teams:[...(current?.teams||[]),team]});
        }
        if(rows.length<100)break;
        if(page===100)throw fail('팀 사용자 목록이 너무 큽니다. GHES에서 확인하세요.');
      }
    }
    const values=[...users.values()];
    const membershipRequest=path=>request(base+path);
    for(let i=0;i<values.length;i+=4)await Promise.all(values.slice(i,i+4).map(async user=>{
      const permission=await request(`${base}/repos/${GHES_CONFIG.owner}/${GHES_CONFIG.repo}/collaborators/${encodeURIComponent(user.login)}/permission`);
      if(!['read','triage','write','maintain','admin','none'].includes(permission.permission))throw fail('담당자의 저장소 권한을 확인하지 못했습니다.');
      user.role=permission.permission==='admin'?'system':['write','maintain'].includes(permission.permission)&&await editorMembership(membershipRequest,user.login)?'editor':'user';
      // Public names are optional; never persist the directory in browser storage.
      try{const profile=await request(`${base}/users/${encodeURIComponent(user.login)}`);if(profile.id===user.id)Object.assign(user,githubDisplayIdentity(profile),{email:typeof profile.email==='string'&&profile.email.length<=254&&/^[^\s@]+@[^\s@]+$/.test(profile.email)?profile.email:null});}catch{/* Retain the authenticated team identity. */}
    }));
    return values.filter(user=>user.role!=='user').sort((a,b)=>a.login.localeCompare(b.login));
  };
  const candidates=async()=>{await requireManager();return roster();};
  const creationCandidates=async()=>{await requireCreator();return roster();};
  const prepareCreation=async(logins)=>{
    if(!Array.isArray(logins)||!logins.length||logins.length>10||logins.some(login=>typeof login!=='string'||!loginPattern.test(login)))throw fail('담당자를 1~10명 선택하세요.');
    const names=[...new Set(logins.map(login=>login.toLowerCase()))],users=await creationCandidates();
    if(names.some(login=>!users.some(user=>user.login.toLowerCase()===login)))throw fail('팀 구성이 변경되었습니다. 담당자 목록을 새로고침하세요.');
    for(const login of names)await request(`${root}/assignees/${encodeURIComponent(login)}`,{empty:true});
    return names;
  };
  const assign=async(number,logins)=>{
    if(!Number.isSafeInteger(number)||number<1||!Array.isArray(logins)||!logins.length||logins.length>10||logins.some(login=>!loginPattern.test(login)))throw fail('담당자를 1~10명 선택하세요.');
    const names=[...new Set(logins.map(login=>login.toLowerCase()))];
    const roster=await candidates(); // Recheck permission and membership immediately before writing.
    if(names.some(login=>!roster.some(user=>user.login.toLowerCase()===login)))throw fail('팀 구성이 변경되었습니다. 담당자 목록을 새로고침하세요.');
    const current=await request(`${root}/issues/${number}`);
    if(!isInquiry(current)||current.number!==number)throw fail('배정할 문의를 확인하세요.');
    const existing=(current.assignees||[]).map(user=>user.login.toLowerCase());
    if(new Set([...existing,...names]).size>10)throw fail('담당자는 최대 10명입니다. 현재 담당자를 확인하세요.');
    const added=names.filter(login=>!existing.includes(login));
    if(!added.length)return inquiryRecord(current,`https://${GHES_CONFIG.host}/${config.owner}/${config.repo}`);
    for(const login of added)await request(`${root}/assignees/${encodeURIComponent(login)}`,{empty:true});
    // Additive API preserves assignments made concurrently by another manager.
    // Do not retry a write after a lost response; the UI refreshes the inquiry.
    const result=await request(`${root}/issues/${number}/assignees`,{method:'POST',body:{assignees:added}});
    if(result.number!==number||names.some(login=>!result.assignees?.some(user=>user.login.toLowerCase()===login)))throw fail('배정 결과가 일치하지 않습니다. 문의를 새로고침해 확인하세요.');
    return inquiryRecord(result,`https://${GHES_CONFIG.host}/${config.owner}/${config.repo}`);
  };
  return {canAssign,candidates,creationCandidates,prepareCreation,assign};
}
