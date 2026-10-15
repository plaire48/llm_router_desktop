import {ghesMessages} from '../ghes-account-state.mjs';
import {displayIssueTitle,issueTitle} from './issuePresentation.js';
import {issueMarkdown,SERVICE_DESK_LIMITS} from './serviceDeskModel.js';
import {commentText,encodeReply,decodeReply} from './commentThread.js';
import {inquiryMentionPrefix,stripInquiryMentionPrefix} from './inquiryMentions.js';
import {GHES_CONFIG,SERVICE_DESK_CONFIG} from './config.js';
import {getServiceDeskSession,serviceDeskLinks} from './serviceDeskClient.js';
import {createTalkClient} from './talkClient.js';
import {talkCanManage} from './talkModel.js';
import {ghesFetch} from './hostFetch.js';
const marker=/<!--\s*service-desk:([a-f\d-]{36})\s*-->/i;
const removed=issue=>Boolean(marker.exec(issue?.body||'')?.[1]&&String(issue.body).trimEnd().endsWith(`<!-- service-desk-removed:${marker.exec(issue.body)[1]} -->`));
const validNumber=number=>Number.isSafeInteger(number)&&number>0;
const error=(message,status=0,uncertain=false)=>Object.assign(Error(message),{status,uncertain});
export function inquiryOwner(item,user){return Number.isSafeInteger(user?.id)&&user.id>0&&item?.user?.id===user.id;}
export function inquiryCanChangeState(item,user){return inquiryOwner(item,user)||(Number.isSafeInteger(user?.id)&&user.id>0&&Array.isArray(item?.assignees)&&item.assignees.some(person=>person?.id===user.id));}
export function isInquiry(issue){return !issue?.pull_request&&marker.test(issue?.body||'')&&!/^<!-- e2e-talk:/.test(issue.body)&&!removed(issue);}
export function inquiryRecord(issue,repository){
  if(!validNumber(issue?.number)||!isInquiry(issue))throw error('문의를 찾을 수 없습니다.',404);
  const type=/^- 유형: (.+)$/m.exec(issue.body)?.[1]||'',source=/^- 화면: (.+)$/m.exec(issue.body)?.[1]||'';
  const separator=/## 문의 내용\r?\n\r?\n/.exec(issue.body),content=separator?issue.body.slice(separator.index+separator[0].length):issue.body;
  return {number:issue.number,title:displayIssueTitle(issue.title).replace(type?`[${type}] `:/^$/,''),type,source,body:content.replace(marker,'').trim(),rawBody:issue.body,rawTitle:issue.title,locked:Boolean(issue.locked),state:issue.state==='closed'?'closed':'open',stateReason:issue.state_reason||null,user:issue.user||{login:'ghost'},createdAt:issue.created_at,updatedAt:issue.updated_at||issue.created_at,comments:issue.comments||0,labels:(issue.labels||[]).map(label=>typeof label==='string'?label:label.name).filter(Boolean),assignees:issue.assignees||[],url:`${repository}/issues/${issue.number}`};
}
export function createInquiryClient({session=getServiceDeskSession(),config=SERVICE_DESK_CONFIG,fetchImpl=ghesFetch,role='user'}={}){
  const links=serviceDeskLinks({host:GHES_CONFIG.host,...config}),people=createTalkClient({session,config,fetchImpl,role}),uncertain=new Set();
  const request=async(path,{method='GET',body}={})=>{
    if(method!=='GET'&&!people.signedIn)throw error('로그인 후 작성하세요.',401);
    let response;try{response=await fetchImpl(links.api+path,{method,credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json',...(people.signedIn?{Authorization:`Bearer ${session.token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    // The host's error code is shown so a failure on the company PC says why (2026-10-14).
    catch(cause){const code=cause?.code||cause?.message,safeCode=/^[a-z][a-z_]{0,63}$/.test(code||'')?code:null;throw error((method==='GET'&&Object.hasOwn(ghesMessages,safeCode)?ghesMessages[safeCode]:method==='GET'?'문의를 불러오지 못했습니다. 다시 시도하세요.':'반영 여부를 확인하지 못했습니다. 결과 확인을 누르세요.')+(safeCode?` (${safeCode})`:''),-1,method!=='GET');}
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw error(({401:'다시 로그인하세요.',403:method==='GET'?'문의 저장소 조회 권한을 확인하세요.':'문의 저장소 접근 권한과 GitHub App의 Issues 쓰기 권한을 확인하세요.',404:'문의를 찾을 수 없거나 조회 권한이 없습니다.',410:'문의 저장소의 Issues 기능이 꺼져 있습니다. 관리자에게 확인해 주세요.',422:'입력 내용과 문의의 답변 잠금 상태를 확인하세요.',429:'요청이 많습니다. 잠시 후 다시 시도하세요.'})[response.status]||'문의 처리 결과를 확인하지 못했습니다.',response.status,method!=='GET'&&response.status>=500);}
    if(response.status===204){await response.body?.cancel().catch(()=>{});return null;}
    try{return await response.json();}catch{throw error('문의 응답을 확인하지 못했습니다.',-1,method!=='GET');}
  };
  const all=async path=>{const result=[];for(let page=1;page<=100;page++){const rows=await request(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);if(!Array.isArray(rows))throw error('문의 목록 형식을 확인할 수 없습니다.');result.push(...rows);if(rows.length<100)return result;}throw error('문의 목록이 많습니다. GitHub에서 확인하세요.');};
  const hydrate=async records=>{
    for(let i=0;i<records.length;i+=4)await Promise.all(records.slice(i,i+4).map(async row=>{try{const user=await people.profile(row.user?.login);if(user?.id===row.user?.id)row.user={...row.user,...user};}catch{/* Use the Issue identity if profile access is unavailable. */}}));return records;
  };
  const readRaw=async(number,includeRemoved=false)=>{if(!validNumber(number))throw error('문의 번호를 확인하세요.');const item=await request(`/${number}`);if(!isInquiry(item)&&!(includeRemoved&&removed(item)&&!item.pull_request))throw error('문의를 찾을 수 없습니다.',404);return item;};
  const read=async number=>inquiryRecord(await readRaw(number),links.repository);
  const record=item=>({...item,rawBody:item.body,...decodeReply(stripInquiryMentionPrefix(String(item.body||'').replace(/\n\n<!-- e2e-inquiry-comment:[a-f\d-]{36} -->$/i,''))),createdAt:item.created_at,updatedAt:item.updated_at||item.created_at});
  const comments=async number=>hydrate((await all(`/${number}/comments`)).map(record));
  const auth=()=>{if(!people.signedIn)throw error('로그인 후 작성하세요.',401);};
  const own=async item=>{auth();if(inquiryOwner(item,session.user))return;const currentRole=typeof role==='function'?role():role;if(!talkCanManage(item,session.user,currentRole))throw error('작성자 또는 관리자만 변경할 수 있습니다.',403);if(!(await people.capabilities()).manageContent)throw error('문의 저장소의 쓰기 권한을 확인하세요.',403);};
  const stateAccess=item=>{auth();if(!inquiryCanChangeState(item,session.user))throw error('문의 등록자와 현재 담당자만 처리 상태를 변경할 수 있습니다.',403);};
  const pending=()=>error('반영 여부를 확인하지 못했습니다. 결과 확인을 누르세요.',-1,true);
  const operations=new Map();
  const verified=async(key,signature,load,matches,unchanged,write)=>{
    const prior=operations.get(key);if(prior&&prior!==signature)throw error('확인 중인 변경 내용이 다릅니다. 최신 내용을 다시 확인하세요.',409);
    let current;try{current=await load();}catch(reason){if(prior)throw pending();throw reason;}
    if(matches(current)){operations.delete(key);return current;}
    if(prior)throw pending();
    if(!unchanged(current))throw error('다른 곳에서 내용이 변경되었습니다. 새로고침 후 다시 확인하세요.',409);
    try{await write(current);}catch(reason){if(!reason.uncertain)throw reason;}
    operations.set(key,signature);
    try{current=await load();}catch{throw pending();}
    if(!matches(current))throw pending();operations.delete(key);return current;
  };
  const ownPost=async(baseline,includeRemoved=false)=>{await own(baseline);const current=await readRaw(baseline.number,includeRemoved);await own(current);return current;};
  const samePost=(current,baseline)=>current?.body===baseline.rawBody&&current?.title===baseline.rawTitle&&(current.updated_at||current.created_at)===baseline.updatedAt;
  const ownComment=async(number,baseline)=>{await own(baseline);if(!validNumber(baseline.id))throw error('답변 번호를 확인하세요.');await readRaw(number);const row=(await all(`/${number}/comments`)).find(item=>item.id===baseline.id)||null;if(row)await own(row);return row;};
  const sameComment=(current,baseline)=>current&&current.body===(baseline.rawBody??baseline.body)&&(current.updated_at||current.created_at)===baseline.updatedAt;
  return {session,signedIn:people.signedIn,links,profile:people.profile,mentionItems:people.mentionItems,
    list:async()=>hydrate((await all('?state=all&sort=created&direction=desc')).filter(isInquiry).map(issue=>inquiryRecord(issue,links.repository))),
    detail:async number=>({post:(await hydrate([await read(number)]))[0],comments:await comments(number)}),
    setState:async(baseline,target)=>{
      stateAccess(baseline);
      if(!['completed','open'].includes(target))throw error('변경할 처리 상태를 확인하세요.');
      const data=target==='completed'?{state:'closed',state_reason:'completed'}:{state:'open',state_reason:'reopened'};
      const saved=await verified(`state:${baseline.number}`,target,async()=>{const current=await readRaw(baseline.number);stateAccess(current);return current;},
        current=>current.state===data.state&&(target==='open'||current.state_reason==='completed'),
        current=>current.state===baseline.state&&(current.state_reason||null)===(baseline.stateReason||null)&&current.state!==data.state,
        ()=>request(`/${baseline.number}`,{method:'PATCH',body:data}));
      return (await hydrate([inquiryRecord(saved,links.repository)]))[0];
    },
    update:async(baseline,{title,type,body},types=[])=>{
      await own(baseline);title=String(title||'').trim();body=String(body||'').trim();
      if(!title||title.length>SERVICE_DESK_LIMITS.title||!body||body.length>SERVICE_DESK_LIMITS.description)throw error('제목은 100자, 내용은 20,000자 이내로 입력하세요.');
      if(![...types,baseline.type].includes(type)||!type||/[\r\n]/.test(type))throw error('문의 유형을 확인하세요.');
      const contentStart=/## 문의 내용\r?\n\r?\n/.exec(baseline.rawBody||''),id=marker.exec(baseline.rawBody||'')?.[1];
      if(!contentStart||!id)throw error('문의 원문을 다시 불러오세요.');
      const header=baseline.rawBody.slice(0,contentStart.index).replace(/^- 유형: .+$/m,()=>`- 유형: ${type}`);
      const data={title:issueTitle('문의',title),body:`${header}## 문의 내용\n\n${issueMarkdown(body)}\n\n<!-- service-desk:${id} -->`};
      const saved=await verified(`post:${baseline.number}`,JSON.stringify(data),()=>ownPost(baseline),current=>current.body===data.body&&current.title===data.title,current=>samePost(current,baseline),()=>request(`/${baseline.number}`,{method:'PATCH',body:data}));
      return inquiryRecord(saved,links.repository);
    },
    remove:async baseline=>{
      await own(baseline);const id=marker.exec(baseline.rawBody||'')?.[1];if(!id)throw error('문의 원문을 다시 불러오세요.');
      const data={body:`${baseline.rawBody}\n\n<!-- service-desk-removed:${id} -->`,state:'closed',state_reason:'not_planned'};
      await verified(`remove:${baseline.number}`,JSON.stringify(data),()=>ownPost(baseline,true),current=>removed(current)&&current.state==='closed',current=>samePost(current,baseline),()=>request(`/${baseline.number}`,{method:'PATCH',body:data}));
      return {number:baseline.number};
    },
    updateComment:async(number,baseline,body)=>{
      await own(baseline);const text=commentText(body);if(!text||text.length>500)throw error('답변은 1~500자로 입력하세요.');
      const raw=String(baseline.rawBody??baseline.body),tag=/\n\n<!-- e2e-inquiry-comment:[a-f\d-]{36} -->$/i.exec(raw)?.[0]||'',original=tag?raw.slice(0,-tag.length):raw,decoded=decodeReply(stripInquiryMentionPrefix(original));
      const data={body:original.slice(0,original.length-decoded.body.length)+text+tag};
      const saved=await verified(`comment:${number}:${baseline.id}`,data.body,()=>ownComment(number,baseline),current=>current?.body===data.body,current=>sameComment(current,baseline),()=>request(`/comments/${baseline.id}`,{method:'PATCH',body:data}));
      return record(saved);
    },
    deleteComment:async(number,baseline)=>{
      await own(baseline);await verified(`delete:${number}:${baseline.id}`,baseline.rawBody??baseline.body,()=>ownComment(number,baseline),current=>current===null,current=>sameComment(current,baseline),()=>request(`/comments/${baseline.id}`,{method:'DELETE'}));
    },
    comment:async(number,body,id,replyTo=null)=>{
      if(!people.signedIn)throw error('로그인 후 작성하세요.',401);
      if(!body.trim()||body.length>500||!/^[a-f\d-]{36}$/i.test(id))throw error('답변은 1~500자로 입력하세요.');
      if(replyTo!==null&&!validNumber(replyTo))throw error('답글을 받을 댓글을 확인하세요.');
      const text=commentText(body);const post=await read(number);if(post.locked)throw error('답변 작성이 잠긴 문의입니다.',403);const key=`${number}:${id}`,tag=`<!-- e2e-inquiry-comment:${id} -->`;
      const rows=await all(`/${number}/comments`);const existing=rows.find(item=>item.user?.id===session.user.id&&item.body?.includes(tag));if(existing){const saved=record(existing);if(saved.body!==text||saved.replyTo!==replyTo)throw error('이미 등록된 답변의 내용이 다릅니다. 답변 목록을 확인하세요.',409);uncertain.delete(key);return saved;}
      if(uncertain.has(key))throw error('등록 결과를 아직 확인하지 못했습니다. 잠시 후 다시 확인하세요.',-1,true);
      const parent=replyTo===null?null:rows.find(row=>row.id===replyTo);if(replyTo!==null&&!parent)throw error('원댓글이 삭제되었습니다. 답글 선택을 해제하고 다시 등록하세요.',409);
      const recipients=inquiryMentionPrefix([post.user,...post.assignees],[session.user.login,parent?.user?.login]);
      try{const saved=await request(`/${number}/comments`,{method:'POST',body:{body:recipients+encodeReply(text,parent,links.repository,number)+`\n\n${tag}`}});if(!validNumber(saved?.id)||typeof saved.body!=='string'||!inquiryOwner(saved,session.user))throw pending();return record(saved);}catch(reason){if(reason.uncertain)uncertain.add(key);throw reason;}
    },
  };
}
