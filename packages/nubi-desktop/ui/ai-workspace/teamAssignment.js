import {GHES_CONFIG,STATUS_CONFIG,E2E_USER_TEAM,E2E_EDITOR_TEAM,E2E_SYSTEM_TEAM,usesSharedRepository} from './config.js';
import {hasTeamMember} from './teamMemberLookup.js';
const fail=(message,status=0,extra={})=>Object.assign(Error(message),{status,...extra});
const accountPattern=/^[a-z\d][a-z\d-]{0,38}$/i,slugPattern=/^[a-z\d][a-z\d-]{0,99}$/i;
export const ROLE_TEAMS=Object.freeze([
 {key:'user',label:'사용자',slug:E2E_USER_TEAM},
 {key:'editor',label:'관리자',slug:E2E_EDITOR_TEAM},
 {key:'system',label:'시스템 관리자',slug:E2E_SYSTEM_TEAM},
]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const diagnostic=error=>error.diagnosticText?{diagnosticText:error.diagnosticText,teamSlug:error.teamSlug}:{};
export function createTeamAssignment({request,list,requireAdmin,profile,member,hostRoot,session,getActor=async()=>session.user,now=Date.now}) {
 const org=`${hostRoot}/orgs/${encodeURIComponent(GHES_CONFIG.owner)}`;
 const operations=new Map();
 const config=()=>{if(ROLE_TEAMS.some(t=>!slugPattern.test(t.slug))||new Set(ROLE_TEAMS.map(t=>t.slug.toLowerCase())).size!==3)throw fail('배포 설정의 사용자, 관리자, 시스템 관리자 팀을 확인하세요.');};
 const teamPath=team=>`${org}/teams/${encodeURIComponent(team.slug)}`;
 const readMembership=path=>request(hostRoot+path);
 const orgMember=async login=>{
  if(!accountPattern.test(login||''))throw fail('GitHub 계정을 확인하세요.');
  let value;try{value=await request(`${org}/memberships/${encodeURIComponent(login)}`);}catch(error){if(error.status===404)throw fail('조직 가입과 App의 조직 Members 읽기 권한을 확인하세요.',404,diagnostic(error));throw error;}
  if(value.state!=='active'||!['member','admin'].includes(value.role))throw fail('조직 가입이 완료된 사용자만 배정할 수 있습니다.');return value;
 };
 const membership=async(team,login,includePending=false)=>{
  const lookup={owner:GHES_CONFIG.owner,team:team.slug};
  const listed=await hasTeamMember(readMembership,login,lookup);
  if(!listed&&!includePending)return null;
  // Only confirmed members need their exact role. A concurrent removal or access
  // failure stops the operation instead of being mistaken for a successful delete.
  // For new organization users, GHES 3.16 exposes pending membership through
  // this endpoint, but has no Cloud-style team invitations listing endpoint.
  let v;
  try{v=await request(`${teamPath(team)}/memberships/${encodeURIComponent(login)}`);}
  catch(error){
   if(error.status!==404||listed||!includePending)throw error;
   // A 404 means no membership only while the team roster is still readable
   // and still excludes this account. Never turn a hidden team into an empty one.
   if(await hasTeamMember(readMembership,login,lookup))throw error;
   return null;
  }
  if(!['active','pending'].includes(v?.state)||!['member','maintainer'].includes(v?.role))throw fail('팀 소속을 확인하지 못했습니다.');
  return {state:v.state,role:v.role};
 };
 const canManage=async(team,external=false)=>{
  const actor=await orgMember(session.user.login);
  if(actor.role==='admin')return true;
  if(external)return false;
  const own=await membership(team,session.user.login);return own?.state==='active'&&own.role==='maintainer';
 };
 const validateGrant=async team=>{
  const repo=team.key==='editor'&&!usesSharedRepository()?STATUS_CONFIG:GHES_CONFIG;
  const value=await request(`${teamPath(team)}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,{accept:'application/vnd.github.v3.repository+json'});
  const p=value?.permissions;
  if(typeof p?.admin!=='boolean'||typeof p?.push!=='boolean')throw fail('팀의 저장소 권한을 확인하지 못했습니다.');
  if(team.key==='system'?!p.admin:p.admin||!p.push)throw fail(`${team.label} 팀의 저장소 권한을 확인하세요. ${team.key==='system'?'Admin':'Write'} 권한이 필요합니다.`,409);
 };
 const organizationMember=async user=>{
  const rows=await list(`${org}/members`);
  if(!Array.isArray(rows)||rows.some(row=>!Number.isSafeInteger(row?.id)||!accountPattern.test(row?.login||'')))throw fail('조직 사용자 목록을 확인하지 못했습니다.');
  return rows.some(row=>row.id===user.id&&row.login.toLowerCase()===user.login.toLowerCase());
 };
 const teamUser=async userId=>{
  config();await requireAdmin();const user=await profile(userId),external=!await organizationMember(user);
  const teams=[];for(const team of ROLE_TEAMS)teams.push({...team,membership:await membership(team,user.login,external),editable:await canManage(team,external)});
  let actual;try{actual=await member(user);}catch(error){actual={...user,role:null,permissionIssue:error.message};}
  return {user:actual,teams,requiresInvitation:external};
 };
 const saveTeamUser=async({userId,baseline,desired,id})=>{
  config();if(!Number.isSafeInteger(userId)||userId<1||!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id||'')||ROLE_TEAMS.some(t=>typeof desired?.[t.key]!=='boolean'||!Object.hasOwn(baseline||{},t.key)))throw fail('팀 배정 내용을 확인하세요.');
  await requireAdmin();const user=await profile(userId),external=!await organizationMember(user);
  const signature=JSON.stringify({userId,baseline,desired});let op=operations.get(id);
  if(op&&op.signature!==signature)throw fail('확인 중인 팀 배정 내용이 변경되었습니다.',409);
  if(!op){
   const steps=[];
   for(const team of ROLE_TEAMS){const current=await membership(team,user.login,external);if(!same(current,baseline[team.key]))throw fail('다른 관리자가 팀 소속을 변경했습니다. 최신 소속을 다시 확인하세요.',409);
    if(Boolean(current)!==desired[team.key])steps.push({team,before:current,add:desired[team.key],attempted:false,done:false});}
   // Validate every requested change before writing the first one.
   for(const step of steps){if(!await canManage(step.team,external))throw fail(external?'조직 Owner만 새 조직 사용자를 초대할 수 있습니다.':'조직 소유자 또는 해당 팀의 Maintainer만 소속을 변경할 수 있습니다.',403);
    if(!step.add&&step.team.key==='system'&&user.id===session.user.id)throw fail('본인의 시스템 관리자 팀 제거는 다른 시스템 관리자에게 요청하세요.',409);
    if(step.add)await validateGrant(step.team);}
   const currentActor=steps.length?await getActor():null;
   if(currentActor&&(!Number.isSafeInteger(currentActor.id)||currentActor.id!==session.user.id||!accountPattern.test(currentActor.login)))throw fail('로그인 계정을 다시 확인하세요.',401);
   const actor=currentActor?{id:currentActor.id,login:currentActor.login,name:currentActor.name,avatar_url:currentActor.avatar_url}:null;
   op={signature,actor,steps:steps.sort((a,b)=>Number(b.add)-Number(a.add))};operations.set(id,op);
  }
  // A confirmed response plus a verified active membership is local save evidence.
  // It is not an audit-log event and is never persisted as personal data.
  const changes=()=>op.steps.filter(step=>step.change).map(step=>step.change);
  const confirmStep=(step,current)=>{
   step.done=true;step.pending=current?.state==='pending';
   if(step.accepted&&op.actor&&!step.pending&&(step.add||step.before?.state==='active'))step.change={userId,source:'save',startedAt:step.startedAt,date:new Date(now()).toISOString(),action:step.add?'team.add_member':'team.remove_member',team:step.team.label,actor:op.actor};
  };
  try {
  for(const step of op.steps){
   if(step.done)continue;
   await requireAdmin();if(!await canManage(step.team,external))throw fail('팀 관리 권한이 변경되었습니다. 반영된 소속부터 다시 확인하세요.',403,{partial:op.steps.some(s=>s.done)});
   const current=await membership(step.team,user.login,external);
   const achieved=step.add?['active','pending'].includes(current?.state):current===null;
   if(step.attempted){if(achieved){confirmStep(step,current);continue;}throw fail('팀 변경 결과를 아직 확인하지 못했습니다. 결과 확인을 다시 누르세요.',0,{uncertain:true,partial:op.steps.some(s=>s.done)});}
   if(!same(current,step.before))throw fail('팀 소속이 변경되었습니다. 반영된 소속부터 다시 확인하세요.',409,{partial:op.steps.some(s=>s.done)});
   const endpoint=`${teamPath(step.team)}/memberships/${encodeURIComponent(user.login)}`;
   step.attempted=true;step.startedAt=new Date(now()).toISOString();
   try{await request(endpoint,step.add?{method:'PUT',body:{role:'member'}}:{method:'DELETE',empty:true});step.accepted=true;}
   catch(error){if(error.status>0&&error.status<500){step.attempted=false;throw fail(error.status===403?'팀 변경 권한이 없습니다. GitHub App의 조직 Members 쓰기 권한과 팀 동기화 설정을 확인하세요.':error.message,error.status,{partial:op.steps.some(s=>s.done),...diagnostic(error)});}}
   let updated;try{updated=await membership(step.team,user.login,external);}catch{throw fail('팀 변경 결과를 확인하지 못했습니다. 결과 확인을 누르세요.',0,{uncertain:true,partial:op.steps.some(s=>s.done)});}
   if(step.add?!['active','pending'].includes(updated?.state):updated!==null)throw fail('팀 변경 결과를 아직 확인하지 못했습니다. 결과 확인을 다시 누르세요.',0,{uncertain:true,partial:op.steps.some(s=>s.done)});
   confirmStep(step,updated);
  }
  // Team membership and effective repository access can differ (direct grants or other teams).
  let actual;try{actual=await member(user);}catch(error){actual={...user,role:null,permissionIssue:error.message};}
  return {user:actual,changed:op.steps.length>0,pendingTeams:op.steps.filter(step=>step.pending).map(step=>step.team.key),teamChanges:changes()};
  } catch(error) {
   error.partial=Boolean(error.partial||op.steps.some(step=>step.done));
   error.teamChanges=changes();
   if(op.steps.some(step=>step.attempted&&!step.done)&&(!error.status||error.status>=500))error.uncertain=true;
   throw error;
  }
 };
 return {teamUser,saveTeamUser};
}
