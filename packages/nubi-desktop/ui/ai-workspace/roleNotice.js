import {issueTitle} from './issuePresentation.js';
import {ROLE_TEAMS} from './teamAssignment.js';
import {encodeTeamHistoryReceipt} from './teamHistoryReceipt.js';
const roles = {user:'사용자',editor:'관리자',system:'시스템 관리자'};
const fail = (message,status=0,uncertain=false) => Object.assign(Error(message),{status,uncertain});
const roleLabel = {name:'Role',color:'DCE9FF',description:'AI Workspace 권한 변경 알림'};
const hasRoleLabel = labels => Array.isArray(labels) && labels.some(label => (typeof label==='string'?label:label?.name)?.toLowerCase()==='role');
export function createRoleNoticeSender({request,requireAdmin,profile,member,root,session,baseUrl}) {
  const pending = new Set();
  const findRoleLabel = async () => {
    for(let page=1;page<=10;page++){
      const labels=await request(`${root}/labels?per_page=100&page=${page}`);
      if(!Array.isArray(labels))throw fail('Role 레이블을 확인하지 못했습니다.');
      if(hasRoleLabel(labels))return true;
      if(labels.length<100)return false;
    }
    throw fail('레이블 목록이 많습니다. GHES에서 Role 레이블을 확인하세요.');
  };
  const ensureRoleLabel = async () => {
    if(await findRoleLabel())return;
    try{
      const label=await request(`${root}/labels`,{method:'POST',body:roleLabel});
      if(!hasRoleLabel([label]))throw fail('Role 레이블 생성 결과를 확인하지 못했습니다.');
    }catch(error){
      // Another administrator may have created the label, or its response was lost.
      if(!error.status||error.status===422||error.status>=500){
        try{if(await findRoleLabel())return;}catch{/* Preserve the original failure. */}
      }
      throw error;
    }
  };
  return async ({userId,role,id,teamChanges=[]}) => {
    if (!Number.isSafeInteger(userId) || userId<1 || !roles[role] || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id||'')) throw fail('알림 대상과 권한을 확인하세요.');
    await requireAdmin(true);
    const marker=`<!-- e2e-role-notice:${id}:${userId}:${role} -->`;
    const receipt=encodeTeamHistoryReceipt(teamChanges,{userId,actor:session.user,teams:ROLE_TEAMS});
    const recover=async()=>{
      for(let page=1;page<=10;page++){
        const rows=await request(`${root}/issues?state=all&creator=${encodeURIComponent(session.user.login)}&sort=created&direction=desc&per_page=100&page=${page}`);
        if(!Array.isArray(rows))throw fail('권한 알림의 등록 결과를 확인하지 못했습니다.');
        const existing=rows.find(row=>!row.pull_request&&row.user?.id===session.user.id&&row.body?.startsWith(marker+'\n'));
        if(existing){
          if(!Number.isSafeInteger(existing.number)||existing.number<1)throw fail('권한 알림의 등록 결과를 확인하지 못했습니다.');
          if(receipt&&!receipt.split('\n').every(line=>existing.body.split('\n').includes(line)))throw fail('이미 등록된 권한 알림의 팀 변경 기록이 다릅니다.',409);
          return existing;
        }
        if(rows.length<100)return null;
      }
      throw fail('권한 알림 목록이 많습니다. GHES에서 등록 여부를 확인하세요.');
    };
    const complete=async issue=>{
      pending.add(id);
      try{
        if(!hasRoleLabel(issue.labels)){
          await ensureRoleLabel();
          const labels=await request(`${root}/issues/${issue.number}/labels`,{method:'POST',body:{labels:['Role']}});
          if(!hasRoleLabel(labels))throw fail('Role 레이블을 확인하지 못했습니다.');
        }
        pending.delete(id);
        return {number:issue.number};
      }catch(error){throw Object.assign(fail('권한 알림은 등록했지만 Role 레이블을 반영하지 못했습니다. 결과 확인을 누르세요.',error.status),{noticeCreated:true});}
    };
    let existing;
    try { existing=await recover(); }
    catch(error){if(pending.has(id))throw fail('알림 등록 여부를 확인하지 못했습니다. 결과 확인을 누르세요.',-1,true);throw error;}
    if(existing)return complete(existing);
    if(pending.has(id))throw fail('등록 결과를 아직 확인하지 못했습니다. 잠시 후 결과 확인을 누르세요.',-1,true);
    const current=await member(await profile(userId));
    if(current.permissionIssue||current.role!==role)throw fail('사용자의 권한이 변경되었거나 확인되지 않습니다. 목록을 새로고침하세요.',409);
    const url=new URL(baseUrl);if(!['https:','http:'].includes(url.protocol))throw fail('서비스 주소를 확인하세요.');url.hash='app';
    const body=`${marker}\n@${current.login}\n\n현재 AI Workspace 권한은 **${roles[role]}**입니다.\n\n[서비스 열기](${url.href})${receipt?'\n\n'+receipt:''}`;
    await ensureRoleLabel();
    let result;
    try {result=await request(`${root}/issues`,{method:'POST',body:{title:issueTitle('Role',`${current.login} 권한 안내`),body,labels:['Role']}});if(!Number.isSafeInteger(result?.number)||result.number<1||receipt&&(result.user?.id!==session.user.id||!receipt.split('\n').every(line=>String(result.body||'').split('\n').includes(line))))throw fail('등록 결과를 확인하지 못했습니다.');}
    catch(error){
      if(error.status>0&&error.status<500)throw error;
      pending.add(id);
      result=null;
      try{result=await recover();}catch{/* An ambiguous POST is never automatically repeated. */}
      if(!result)throw fail('권한 알림 등록 결과를 확인하지 못했습니다. 결과 확인을 누르세요.',-1,true);
    }
    return complete(result);
  };
}
