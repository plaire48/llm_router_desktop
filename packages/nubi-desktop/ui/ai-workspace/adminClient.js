import {createRoleNoticeSender} from './roleNotice.js';
import {createTeamAssignment, ROLE_TEAMS} from './teamAssignment.js';
import {createTeamUserSearch} from './teamUserSearch.js';
import {createTeamChangeHistory} from './teamChangeHistory.js';
import {createTeamHistoryReceiptReader} from './teamHistoryReceipt.js';
import {createRestoredTeamHistory} from './teamHistoryRefresh.js';
import {createOrganizationAuditAccess} from './organizationAuditAccess.js';
import {githubAccessMessage} from './githubAccessMessage.js';
import {githubRequestDiagnostic} from './githubRequestDiagnostic.js';
import { GHES_CONFIG, SERVICE_DESK_CONFIG, STATUS_CONFIG, hasIsolatedStatusRepository, usesSharedRepository, SERVICE_DESK_SETTINGS_PATH } from './config.js';
import { getServiceDeskSession, serviceDeskLinks } from './serviceDeskClient.js';
import { githubDisplayIdentity } from './githubIdentity.js';
import {profileEmail} from './profileEmail.js';
import {commitGithubFiles} from './githubTransaction.js';
import {editorMembership} from './editorMembership.js';
import {ghesFetch} from './hostFetch.js';

const loginPattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const key = value => value.toLowerCase();
const fail = (message, status) => Object.assign(new Error(message), { status });
export const GHES_TEAMS_URL = `https://${GHES_CONFIG.host}/orgs/${encodeURIComponent(GHES_CONFIG.owner)}/teams`;
export const E2E_ROLES = Object.freeze([
  {key:'user',label:'사용자'},
  {key:'editor',label:'관리자'},
  {key:'system',label:'시스템 관리자'},
]);
export function roleFromPermissions(configuration, status, {sharedRepository=usesSharedRepository(),editorTeamMember=false}={}) {
  if (typeof configuration?.admin !== 'boolean' || typeof configuration?.push !== 'boolean') throw fail('기준정보 저장소 권한을 확인하지 못했습니다.');
  if (configuration.admin) return 'system';
  if(sharedRepository)return configuration.push&&editorTeamMember===true?'editor':'user';
  if (configuration.push) throw fail('기준정보 저장소의 쓰기 권한이 남아 있습니다. GHES에서 팀과 개인 권한을 확인하세요.');
  if (!status) return 'user';
  if (typeof status.push !== 'boolean') throw fail('현황 저장소 권한을 확인하지 못했습니다.');
  return status.push ? 'editor' : 'user';
}
export function roleCapabilities(role) {
  const managesData=role==='editor'||role==='system';
  return {edit:managesData,settings:managesData,admin:role==='system'};
}
export function assigneeLogins(value) {
  const names = (Array.isArray(value) ? value : String(value || '').split(',')).map(v => v.trim()).filter(Boolean);
  if (names.length > 10 || names.some(name => !loginPattern.test(name))) throw fail('GitHub ID를 확인하세요. 담당자는 최대 10명까지 등록할 수 있습니다.');
  if (new Set(names.map(key)).size !== names.length) throw fail('같은 담당자가 중복되어 있습니다.');
  return names;
}

export function createAdminClient({ session = getServiceDeskSession(), fetchImpl = ghesFetch, baseUrl=globalThis.location?.href||'https://localhost/' } = {}) {
  if (!session?.token?.trim() || ['null','undefined'].includes(session.token.trim()) || session.host !== GHES_CONFIG.host || !loginPattern.test(session.user?.login || '')) throw fail('사내 GitHub에 다시 로그인하세요.', 401);
  const appSession = { ...session, owner: GHES_CONFIG.owner, repo: GHES_CONFIG.repo };
  const supportSession = { ...session, ...SERVICE_DESK_CONFIG };
  const appRoot = serviceDeskLinks(appSession).api.replace(/\/issues$/, '');
  const supportRoot = serviceDeskLinks(supportSession).api.replace(/\/issues$/, '');
  const statusRoot = hasIsolatedStatusRepository() ? serviceDeskLinks({...session,...STATUS_CONFIG}).api.replace(/\/issues$/, '') : null;
  const hostRoot = `https://${session.host}/api/v3`;
  const headers = { Authorization: `Bearer ${session.token}`, Accept: 'application/vnd.github+json' };
  const request = async (url, { method = 'GET', body, empty = false, accept = headers.Accept, signal } = {}) => {
    let response;
    try {
      response = await fetchImpl(url, { method, headers: { ...headers, Accept:accept, ...(body ? {'Content-Type':'application/json'} : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), credentials:'omit', cache:'no-store', redirect:'error', signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000) });
    } catch { signal?.throwIfAborted();throw fail(method === 'GET'||url.endsWith('/api/graphql') ? '관리자 정보를 불러오지 못했습니다. 다시 시도하세요.' : '반영 여부를 확인하지 못했습니다. 다시 저장하면 현재 권한부터 확인합니다.'); }
    if (!response.ok) {
      const diagnostic=githubRequestDiagnostic(url,method,response,session.token);
      await response.body?.cancel().catch(()=>{});
      const message=githubAccessMessage(url,method,response.status)||`${({
      401:'로그인이 만료되었습니다. 다시 로그인하세요.',
      403:'GHES 저장소 접근 권한과 GitHub App 권한을 확인하세요.',
      404:'저장소 접근 권한과 GitHub App 설치 범위를 확인하세요.',
      422:'계정과 저장소 권한 설정을 확인하세요.',
      429:'요청이 많습니다. 잠시 후 다시 시도하세요.',
      })[response.status] || 'GHES 응답을 확인하지 못했습니다. 다시 시도하세요.'} (HTTP ${response.status})`;
      throw Object.assign(fail(message,response.status),diagnostic);
    }
    if (empty) { await response.body?.cancel().catch(() => {}); return response.status; }
    try { return await response.json(); } catch { throw fail('관리자 정보의 응답 형식을 확인하지 못했습니다.'); }
  };
  const list = async (url, field) => {
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const result = await request(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const rows = field ? result[field] : result;
      if (!Array.isArray(rows)) throw fail('관리자 목록을 확인하지 못했습니다.');
      items.push(...rows);
      if (rows.length < 100) return items;
    }
    throw fail('관리자 목록이 너무 큽니다. GHES에서 확인하세요.');
  };
  const access = async () => {
    const repo = await request(appRoot);
    if (typeof repo.permissions?.admin !== 'boolean') throw fail('저장소 관리자 권한을 확인하지 못했습니다.');
    return repo.permissions.admin;
  };
  const membershipRequest=path=>request(hostRoot+path);
  const role = async () => {
    const repo = await request(appRoot);
    const initial = roleFromPermissions(repo.permissions);
    if(initial === 'system')return initial;
    if(usesSharedRepository())return roleFromPermissions(repo.permissions,undefined,{editorTeamMember:repo.permissions.push&&await editorMembership(membershipRequest,session.user.login)});
    if(!statusRoot)return initial;
    const status = await request(statusRoot);
    if(!status.permissions)throw fail('현황 저장소 권한을 확인하지 못했습니다.');
    return roleFromPermissions(repo.permissions, status.permissions);
  };
  const requireAdmin = async (support = false) => {
    if (!await access()) throw fail('저장소 관리자만 변경할 수 있습니다.', 403);
    if (support && appRoot !== supportRoot && (await request(supportRoot)).permissions?.admin !== true) throw fail('문의 저장소의 관리자 권한도 필요합니다.', 403);
  };
  const profile = async (account,{signal}={}) => {
    const byId=Number.isSafeInteger(account)&&account>0;
    if (!byId&&!loginPattern.test(account || '')) throw fail('GitHub ID를 입력하세요.');
    const user = await request(`${hostRoot}/${byId?'user':'users'}/${encodeURIComponent(account)}`,{signal});
    if (!loginPattern.test(user?.login || '') || !Number.isSafeInteger(user.id) || user.type !== 'User' || (byId?user.id!==account:key(user.login)!==key(account))) throw fail('사용자 계정을 확인하세요.');
    const email=profileEmail(user.email);
    return {...githubDisplayIdentity(user),email};
  };
  // Keep profiles only in this mounted client. Refresh reads GHES again; no browser persistence.
  let directorySnapshot = null;
  const repositoryUsers = async (refresh = false) => {
    if (refresh) directorySnapshot = null;
    if (!directorySnapshot) directorySnapshot = (async () => {
      const accounts = await list(`${appRoot}/collaborators?affiliation=all`);
      const unique = new Map();
      for (const account of accounts) {
        if (account.type === 'Bot') continue;
        if (account.type !== 'User' || !Number.isSafeInteger(account.id) || account.id <= 0 || !loginPattern.test(account.login || '')) throw fail('저장소 사용자 목록을 확인하지 못했습니다.');
        unique.set(account.id, account);
      }
      const users = [], records = [...unique.values()];
      // Bound concurrent profile reads for larger repositories.
      for (let offset = 0; offset < records.length; offset += 4) {
        users.push(...await Promise.all(records.slice(offset, offset + 4).map(account => profile(account.id))));
      }
      return users.sort((a,b) => a.login.localeCompare(b.login));
    })().catch(error => { directorySnapshot = null; throw error; });
    return directorySnapshot;
  };
  const directory = async (query='', page=1) => {
    await requireAdmin();
    if (!Number.isSafeInteger(page) || page < 1) throw fail('사용자 목록의 페이지를 확인하세요.');
    const needle = String(query).trim().toLocaleLowerCase();
    const accounts = (await repositoryUsers(page === 1)).filter(user => !needle || `${user.login} ${user.name || ''}`.toLocaleLowerCase().includes(needle));
    const offset = (page - 1) * 30;
    return {users:accounts.slice(offset, offset + 30), hasMore:accounts.length > offset + 30};
  };
  const eligible = async login => {
    const user=await profile(login);
    try {await request(`${supportRoot}/assignees/${encodeURIComponent(user.login)}`,{empty:true});}
    catch(error){if(error.status===404)throw fail('문의 저장소에 배정할 수 없는 계정입니다. 저장소 접근 권한을 확인하세요.');throw error;}
    const access=await repoPermission(supportRoot,user.login);
    if(!['triage','write','maintain','admin'].includes(access.role))throw fail('문의 저장소에 Triage 이상의 권한이 필요합니다. GHES에서 팀 권한을 확인하세요.');
    return user;
  };
  const support = async () => {
    await requireAdmin(true);
    const file=await request(`${appRoot}/contents/${SERVICE_DESK_SETTINGS_PATH}?ref=${encodeURIComponent(GHES_CONFIG.branch)}`);
    if(!/^[a-f\d]{40}$/i.test(file?.sha||'')||file.encoding!=='base64')throw fail('담당자 설정 파일을 확인하지 못했습니다.');
    let document;
    try{document=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),char=>char.charCodeAt(0))));}catch{throw fail('담당자 설정 형식을 확인하세요.');}
    if(typeof document.enabled!=='boolean'||!Array.isArray(document.assignees))throw fail('담당자 설정 형식을 확인하세요.');
    return {sha:file.sha,document,enabled:document.enabled,logins:assigneeLogins(document.assignees)};
  };
  const saveSupport = async (baseline, desired) => {
    await requireAdmin(true);
    const names=assigneeLogins(desired.logins);
    if(desired.enabled&&!names.length)throw fail('자동 배정할 담당자를 한 명 이상 추가하세요.');
    const current=await support();
    if(current.enabled===desired.enabled&&JSON.stringify(current.logins)===JSON.stringify(names))return current;
    if(current.sha!==baseline.sha)throw fail('다른 관리자가 담당자 설정을 변경했습니다. 수정값을 보관한 뒤 최신 값을 확인하세요.',409);
    for(const name of names)await eligible(name);
    const document={...current.document,enabled:Boolean(desired.enabled),assignees:names};
    await commitGithubFiles({...appSession,branch:GHES_CONFIG.branch,fetchImpl,message:'문의 담당자 설정 변경',changes:[{path:SERVICE_DESK_SETTINGS_PATH,sha:current.sha,document}]});
    return support();
  };
  const repoPermission = async (root, login, {signal}={}) => {
    const result = await request(`${root}/collaborators/${encodeURIComponent(login)}/permission`,{signal});
    if(!['none','read','write','admin'].includes(result.permission))throw fail('저장소 권한을 확인하지 못했습니다.');
    return {permission:result.permission,role:result.role_name||result.permission};
  };
  const member = async (user,{signal,membershipLookup=membershipRequest}={}) => {
    // Ordinary image writers remain users unless the editor team confirms membership.
    const config=await repoPermission(appRoot,user.login,{signal}), status=statusRoot?await repoPermission(statusRoot,user.login,{signal}):null;
    const flags = value => value && ({admin:value.permission==='admin',push:['write','admin'].includes(value.permission)});
    let role='user', permissionIssue='';
    try {role=roleFromPermissions(flags(config),flags(status),{editorTeamMember:usesSharedRepository()&&config.permission==='write'&&await editorMembership(membershipLookup,user.login)});}
    catch(error) {permissionIssue=error.message;}
    return {...user,role,permissionIssue};
  };
  const members = async () => {
    await requireAdmin();
    const rows=[];
    const users=await repositoryUsers(true);
    for (let offset=0;offset<users.length;offset+=4) rows.push(...await Promise.all(users.slice(offset,offset+4).map(member)));
    return rows;
  };
  const sendRoleNotice=createRoleNoticeSender({request,requireAdmin,profile,member,root:supportRoot,session,baseUrl});
  const teams=createTeamAssignment({request,list,requireAdmin,profile,member,hostRoot,session,getActor:async()=>{
    const actor=await request(`${hostRoot}/user`);
    if(actor?.type!=='User'||actor.id!==session.user.id||!loginPattern.test(actor.login||''))throw fail('로그인 계정을 다시 확인하세요.',401);
    return githubDisplayIdentity(actor);
  }});
  const searchTeamUsers=createTeamUserSearch({request,requireAdmin,hostRoot,profile});
  const searchSkillUsers=createTeamUserSearch({request,hostRoot,profile,requireAdmin:async()=>{
    const actorRole=await role();
    if(!E2E_ROLES.some(item=>item.key===actorRole))throw fail('사용자 권한을 확인하세요.',403);
  }});
  const searchWorkspaceUsers=createTeamUserSearch({request,hostRoot,profile,requireAdmin:async()=>{
    const actorRole=await role();
    if(!E2E_ROLES.some(item=>item.key===actorRole))throw fail('사용자 권한을 확인한 뒤 다시 시도하세요.',403);
  }});
  const maintainerSearch=searchUsers=>async(value,options={})=>{
    const result=await searchUsers(value,options),users=[];
    const memberOptions={signal:options.signal,membershipLookup:path=>request(hostRoot+path,{signal:options.signal})};
    for(let offset=0;offset<result.users.length;offset+=4){
      options.signal?.throwIfAborted();
      users.push(...await Promise.all(result.users.slice(offset,offset+4).map(async user=>{
        try{return await member(user,memberOptions);}
        catch(error){options.signal?.throwIfAborted();return {...user,role:null,permissionIssue:error.message};}
      })));
    }
    options.signal?.throwIfAborted();
    return {...result,users};
  };
  const searchSkillMaintainers=maintainerSearch(searchSkillUsers);
  const searchWorkspaceMaintainers=maintainerSearch(searchWorkspaceUsers);
  const auditAccess=createOrganizationAuditAccess({session,fetchImpl});
  const memberHistory=createRestoredTeamHistory({
    audit:createTeamChangeHistory({request,requireAdmin,profile,hostRoot,owner:GHES_CONFIG.owner,teams:ROLE_TEAMS,canReadAudit:auditAccess.canRead}),
    receipts:createTeamHistoryReceiptReader({request,requireAdmin:()=>requireAdmin(true),profile,root:supportRoot,teams:ROLE_TEAMS})
  });
  return { access, role, members, memberHistory, directory, support, profile, eligible, saveSupport, sendRoleNotice, searchTeamUsers, searchSkillMaintainers, searchWorkspaceMaintainers, ...teams };
}
