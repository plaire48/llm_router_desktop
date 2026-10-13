// Show a bounded preview of the pending decision, never command scripts or transcripts.
// Clicking only reopens the still-pending form.
function preview(value,limit){
 if(typeof value!=='string')return '';
 const text=value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
 const chars=Array.from(text);return chars.length>limit?chars.slice(0,limit-1).join('')+'…':text;
}
function decisionNoticeContent({kind,projectName,taskTitle,summary}={}){
 const labels={question:'답변 요청',proposal:'변경 승인 요청',command:'실행 승인 요청',computer:'앱 동작 확인'};
 const label=labels[kind]||labels.question,project=preview(projectName,40),task=preview(taskTitle,55);
 const detail=preview(summary,160)||({proposal:'제안된 파일 변경을 검토해 주세요.',command:'제안된 명령의 실행 여부를 선택해 주세요.',computer:'연결할 앱과 요청한 동작을 확인해 주세요.'}[kind]||'대화에 추가 질문이 도착했어요.');
 return {title:project?`${project} — ${label}`:`누비 Workspace — ${label}`,body:task&&task!==detail?`${task}\n${detail}`:detail};
}
function createDecisionNotices({Notification,getWindow,send,icon,platform=process.platform}){
 const notices=new Map();
 return {
  request({id,action,kind,projectName,taskTitle,summary}={}){
   if(typeof id!=='string'||!id||id.length>300||!['show','clear'].includes(action))throw Error('decision_notice_invalid');
   if(action==='clear'){
    const entry=notices.get(id);notices.delete(id);entry?.notice.close();return {cleared:true};
   }
   const window=getWindow();
   if(platform!=='win32'||!window||window.isDestroyed()||!Notification.isSupported()||notices.has(id))return {shown:false};
   // Bound references even if a renderer reload loses its cleanup callbacks.
   if(notices.size>=20){const oldest=notices.keys().next().value;const entry=notices.get(oldest);notices.delete(oldest);entry.notice.close();}
   try{
    const notice=new Notification({...decisionNoticeContent({kind,projectName,taskTitle,summary}),icon,silent:true});
    const entry={notice};notices.set(id,entry);
    notice.on('click',()=>{
     if(notices.get(id)!==entry)return;
     const current=getWindow();if(!current||current.isDestroyed())return;
     if(current.isMinimized())current.restore();current.show();current.focus();
     send({type:'decision_open',id});
    });
    notice.on('failed',()=>{});notice.show();return {shown:true};
   }catch{return {shown:false};}
  },
  clear(){for(const {notice} of notices.values())notice.close();notices.clear();}
 };
}
module.exports={createDecisionNotices,decisionNoticeContent};
