import {GHES_CONFIG,TALK_CONFIG,E2E_USER_TEAM,E2E_EDITOR_TEAM,E2E_SYSTEM_TEAM} from './config.js';
import {createAdminClient} from './adminClient.js';
import {getServiceDeskSession} from './serviceDeskClient.js';
import {isTalkPost,talkError,TALK_UUID,TALK_LOGIN,talkPermalink} from './talkModel.js';
import {isDiscussionKey} from './discussionModel.js';
import {ghesFetch,talkBase} from './hostFetch.js';

export const TALK_TEAMS=Object.freeze([
 {slug:E2E_USER_TEAM,label:'사용자'},
 {slug:E2E_EDITOR_TEAM,label:'관리자'},
 {slug:E2E_SYSTEM_TEAM,label:'시스템 관리자'},
]);
const slugPattern=/^[a-z\d][a-z\d-]{0,99}$/i;
export function teamNoticeTargets(body){
 const first=String(body||'').split('\n')[0],match=/^<!-- e2e-talk-team:v1:([a-f\d-]{36}):([a-z\d,-]+) -->$/i.exec(first);
 if(!match||!TALK_UUID.test(match[1]))return [];
 const slugs=match[2].split(',');return slugs.length<=3&&new Set(slugs).size===slugs.length&&slugs.every(slug=>TALK_TEAMS.some(team=>team.slug===slug)&&String(body).includes(`@${GHES_CONFIG.owner}/${slug}`))?slugs:[];
}
export function createTalkTeamNoticeClient({session=getServiceDeskSession(),config=TALK_CONFIG,role='user',fetchImpl=ghesFetch,baseUrl=talkBase(),discussionClient=null}={}){
 const api=`https://${GHES_CONFIG.host}/api/v3`,root=`${api}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,org=`${api}/orgs/${encodeURIComponent(GHES_CONFIG.owner)}`,uncertain=new Set(),locks=new Map();
 const pending=()=>Object.assign(talkError('알림 등록 결과를 확인하지 못했습니다. 결과 확인을 눌러 확인하세요.',-1),{uncertain:true});
 const attempts=new Map();
 const request=async(url,{method='GET',body,accept='application/vnd.github+json'}={})=>{
  let response;try{response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${session.token}`,Accept:accept,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});}catch{throw talkError('팀 알림 응답을 확인하지 못했습니다.',-1);}
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw talkError(response.status===403?'팀과 Issues 접근 권한을 확인하세요.':`팀 알림을 확인하지 못했습니다. (HTTP ${response.status})`,response.status);}
  try{return await response.json();}catch{throw talkError('팀 알림 응답 형식을 확인하지 못했습니다.',-1);}
 };
 const authorize=async()=>{
  if(!session?.token?.trim()||['null','undefined'].includes(session.token.trim())||session.host!==GHES_CONFIG.host||!TALK_LOGIN.test(session.user?.login||'')||!Number.isSafeInteger(session.user?.id)||session.user.id<1)throw talkError('로그인 후 사용할 수 있습니다.',401);
  if(!['editor','system'].includes(typeof role==='function'?role():role))throw talkError('관리자만 팀 알림을 보낼 수 있습니다.',403);
  const actor=await request(`${api}/user`);if(actor.id!==session.user.id||actor.login?.toLowerCase()!==session.user.login.toLowerCase())throw talkError('로그인 정보를 다시 확인하세요.',401);
  const current=await createAdminClient({session,fetchImpl}).role();if(!['editor','system'].includes(current))throw talkError('관리자 권한이 변경되었습니다. 새로고침하세요.',403);
  const member=await request(`${org}/memberships/${encodeURIComponent(session.user.login)}`);if(member.state!=='active')throw talkError('조직 가입 상태를 확인하세요.',403);
 };
 const options=async()=>{
  await authorize();if(TALK_TEAMS.some(t=>!slugPattern.test(t.slug))||new Set(TALK_TEAMS.map(t=>t.slug.toLowerCase())).size!==3)throw talkError('E2E 팀 배포 설정을 확인하세요.');
  return Promise.all(TALK_TEAMS.map(async team=>{
   try{const path=`${org}/teams/${encodeURIComponent(team.slug)}`,value=await request(path);if(value.slug!==team.slug||!Number.isSafeInteger(value.id))throw talkError('팀 정보를 확인하지 못했습니다.');
    const access=await request(`${path}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,{accept:'application/vnd.github.v3.repository+json'});
    const reason=access.permissions?.pull!==true?'게시판 접근 권한 없음':value.notification_setting!=='notifications_enabled'?'GHES 팀 알림 설정 필요':'';
    return {...team,id:value.id,count:Number.isSafeInteger(value.members_count)?value.members_count:null,enabled:!reason,reason};
   }catch(error){if([403,404].includes(error.status))return {...team,enabled:false,reason:'팀 접근 권한 또는 연결 확인 필요'};throw error;}
  }));
 };
 const send=async({number,slugs,id})=>{
  const native=discussionClient&&isDiscussionKey(number);
  if((!native&&(!Number.isSafeInteger(number)||number<1))||!TALK_UUID.test(id||'')||!Array.isArray(slugs)||!slugs.length||slugs.length>3||new Set(slugs).size!==slugs.length||slugs.some(slug=>!TALK_TEAMS.some(t=>t.slug===slug)))throw talkError('알림을 받을 팀을 확인하세요.');
  const ordered=[...slugs].sort(),key=`${number}:${id}`,marker=`<!-- e2e-talk-team:v1:${id}:${ordered.join(',')} -->`,body=`${marker}\n팀에 이 글을 공유합니다.\n\n${ordered.map(slug=>`@${GHES_CONFIG.owner}/${slug}`).join(' ')}\n\n[AI Talk에서 보기](${talkPermalink(baseUrl,number)})`;
  if(attempts.has(number)&&attempts.get(number).id!==id)throw pending();
  if(locks.has(key))throw talkError('팀 알림을 처리하고 있습니다. 잠시 후 확인하세요.');locks.set(key,true);
  try{
   await authorize();
   if(native){
    if(!attempts.has(number)){const available=await options();if(ordered.some(slug=>!available.find(team=>team.slug===slug)?.enabled))throw talkError('팀 설정이 변경되었습니다. 새로고침 후 다시 선택하세요.',409);}
    try{const saved=await discussionClient.sendTeamNotice(number,body,id);attempts.delete(number);return saved;}
    catch(error){if(error.uncertain)attempts.set(number,{id,slugs:ordered});throw error;}
   }
   const read=async()=>{const issue=await request(`${root}/issues/${number}`);if(!isTalkPost(issue)||issue.state!=='open')throw talkError('게시글 상태를 확인하세요.',409);
    for(let page=1;page<=100;page++){const comments=await request(`${root}/issues/${number}/comments?per_page=100&page=${page}`);if(!Array.isArray(comments))throw talkError('알림 기록을 확인하지 못했습니다.');
     const existing=comments.find(c=>c.user?.id===session.user.id&&c.body?.startsWith(`<!-- e2e-talk-team:v1:${id}:`));if(existing){if(existing.body!==body)throw talkError('이미 등록된 알림의 대상이 다릅니다.',409);uncertain.delete(key);attempts.delete(number);return existing;}
     if(comments.length<100)return null;
    }throw talkError('알림 기록이 너무 큽니다. GHES에서 확인하세요.');
   };
   let existing;try{existing=await read();}catch(error){if(uncertain.has(key))throw pending();throw error;}if(existing)return existing;if(uncertain.has(key))throw pending();
   const available=await options();if(ordered.some(slug=>!available.find(t=>t.slug===slug)?.enabled))throw talkError('팀 설정이 변경되었습니다. 새로고침 후 다시 선택하세요.',409);
   // Only one comment is written; GHES delivers the native team mentions.
   try{const result=await request(`${root}/issues/${number}/comments`,{method:'POST',body:{body}});if(!Number.isSafeInteger(result.id)||result.id<1||result.body!==body||result.user?.id!==session.user.id)throw talkError('알림 등록 결과를 확인하지 못했습니다.',-1);return result;}catch(error){if(error.status>=400&&error.status<500)throw error;uncertain.add(key);attempts.set(number,{id,slugs:ordered});try{existing=await read();if(existing)return existing;}catch{/* Keep this attempt verification-only. */}throw pending();}
  }finally{locks.delete(key);}
 };
 return {options,send,pending:number=>{const value=attempts.get(number);return value&&{id:value.id,slugs:[...value.slugs]};}};
}
