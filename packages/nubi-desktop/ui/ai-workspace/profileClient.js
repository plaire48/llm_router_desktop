import {GHES_CONFIG, STATUS_CONFIG, hasIsolatedStatusRepository} from './config.js';
import {getServiceDeskSession} from './serviceDeskClient.js';
import {roleFromPermissions} from './adminClient.js';
import {editorMembership} from './editorMembership.js';
import {profileEmail} from './profileEmail.js';
import {ghesFetch} from './hostFetch.js';
export {profileEmail} from './profileEmail.js';

const LOGIN=/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const fail=(message,status)=>Object.assign(new Error(message),{status});
const text=(value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
export function profileUrl(value) {
  const input=text(value,2048);if(!input||/[\u0000-\u0020\u007f]/.test(input))return null;
  try {const url=new URL(/^[\w+.-]+:/.test(input)?input:`https://${input}`);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function githubProfile(value,host) {
  if(!Number.isSafeInteger(value?.id)||value.id<=0||!LOGIN.test(value.login||''))throw fail('프로필 정보를 확인하지 못했습니다.');
  return {id:value.id,login:value.login,name:text(value.name,100),avatar_url:profileUrl(value.avatar_url),
    html_url:`https://${host}/${encodeURIComponent(value.login)}`,email:profileEmail(value.email),
    bio:text(value.bio),company:text(value.company),location:text(value.location,200),blog:profileUrl(value.blog)};
}
function permissions(value,login) {
  if(value?.user?.login?.toLowerCase()!==login.toLowerCase())throw fail('사용자 권한을 확인하지 못했습니다.');
  const permission=value.permission;
  if(!['admin','write','read','none'].includes(permission))throw fail('사용자 권한을 확인하지 못했습니다.');
  return {admin:permission==='admin',push:['admin','write'].includes(permission)};
}

// Public identity reads share a short account-scoped cache. Roles and private fields
// are fetched afresh when opening the panel and never written to browser storage.
export function createProfileClient({session=getServiceDeskSession(),fetchImpl=ghesFetch,config=GHES_CONFIG,statusConfig=STATUS_CONFIG,isolated=hasIsolatedStatusRepository(),now=Date.now}={}) {
  const identities=new Map(),pending=new Map(),controller=new AbortController();
  const signedIn=Boolean(session?.host===config.host&&session.token?.trim()&&!['null','undefined'].includes(session.token.trim())&&LOGIN.test(session.user?.login||'')&&Number.isSafeInteger(session.user?.id));
  const root=`https://${config.host}/api/v3`;
  const request=async(path,signal)=>{
    let response;
    try {response=await fetchImpl(`${root}${path}`,{method:'GET',cache:'no-store',credentials:'omit',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',...(signedIn?{Authorization:`Bearer ${session.token}`}:{})}});}
    catch(error){if(signal?.aborted)throw error;throw fail('프로필을 불러오지 못했습니다. 다시 시도하세요.');}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw fail(({401:'로그인이 만료되었습니다. 다시 로그인하세요.',403:'프로필 조회 권한을 확인하세요.',404:'프로필을 찾을 수 없거나 조회 권한이 없습니다.',429:'요청이 많습니다. 잠시 후 다시 시도하세요.'})[response.status]||'프로필을 불러오지 못했습니다. 다시 시도하세요.',response.status);}
    try{return await response.json();}catch{throw fail('프로필 응답을 확인하지 못했습니다.');}
  };
  const role=async(login,own,signal)=>{
    if(!signedIn)return null;
    const repo=async settings=>{
      const path=`/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`;
      const value=await request(own?path:`${path}/collaborators/${encodeURIComponent(login)}/permission`,signal);
      return own?value.permissions:permissions(value,login);
    };
    const sharedRepository=config.owner.toLowerCase()===statusConfig.owner.toLowerCase()&&config.repo.toLowerCase()===statusConfig.repo.toLowerCase();
    const configuration=await repo(config),initial=roleFromPermissions(configuration,undefined,{sharedRepository});
    if(initial==='system')return initial;
    if(sharedRepository)return roleFromPermissions(configuration,undefined,{sharedRepository,editorTeamMember:configuration.push&&await editorMembership(path=>request(path,signal),login,{owner:config.owner})});
    return !isolated?initial:roleFromPermissions(configuration,await repo(statusConfig),{sharedRepository});
  };
  const read=async account=>{
    if(controller.signal.aborted)return null;
    if(!LOGIN.test(account?.login||'')||(account.id!==undefined&&(!Number.isSafeInteger(account.id)||account.id<1)))return null;
    const key=`${account.id??''}:${account.login.toLowerCase()}`,cached=identities.get(key);
    if(cached&&cached.until>now())return cached.value;
    if(pending.has(key))return pending.get(key);
    const result=(async()=>{
      let value=null;
      try {
        const profile=githubProfile(await request(`/users/${encodeURIComponent(account.login)}`,controller.signal),config.host);
        if(profile.login.toLowerCase()===account.login.toLowerCase()&&(account.id===undefined||profile.id===account.id))value=profile;
      } catch { /* Keep the original login and avatar when public lookup is unavailable. */ }
      if(controller.signal.aborted)return null;
      identities.set(key,{value,until:now()+(value?300000:15000)});
      while(identities.size>100)identities.delete(identities.keys().next().value);
      return value;
    })().finally(()=>pending.delete(key));
    pending.set(key,result);return result;
  };
  const load=async(account,{signal}={})=>{
    if(!LOGIN.test(account?.login||''))throw fail('GitHub ID를 확인하세요.');
    const own=signedIn&&(account.id===undefined||session.user.id===account.id)&&session.user.login.toLowerCase()===account.login.toLowerCase();
    const path=own?'/user':`/users/${encodeURIComponent(account.login)}`;
    const value=githubProfile(await request(path,signal),config.host);
    if(value.login.toLowerCase()!==account.login.toLowerCase()||(Number.isSafeInteger(account.id)&&value.id!==account.id)||(own&&value.id!==session.user.id))throw fail('선택한 사용자와 프로필이 일치하지 않습니다. 다시 열어주세요.');
    const result={...value,own,role:null,socials:[],unavailable:[]};
    const jobs=[['socials',async()=>{
      const social=await request(`${path}/social_accounts?per_page=100`,signal);
      if(!Array.isArray(social))throw fail('소셜 계정을 확인하지 못했습니다.');
      return [...new Map(social.map(item=>({provider:text(item.provider,60),url:profileUrl(item.url)})).filter(item=>item.url).map(item=>[item.url,item])).values()];
    }],['role',()=>role(value.login,own,signal)]];
    if(own&&!value.email)jobs.push(['email',async()=>{
      const emails=await request('/user/emails?per_page=100',signal);
      if(!Array.isArray(emails))throw fail('이메일을 확인하지 못했습니다.');
      return profileEmail(emails.find(email=>email.primary&&email.verified)?.email);
    }]);
    await Promise.all(jobs.map(async([key,run])=>{try{result[key]=await run();}catch(error){if(signal?.aborted||error.status===401)throw error;result.unavailable.push(key);}}));
    return result;
  };
  return {load,read,signedIn,dispose(){controller.abort();identities.clear();}};
}
