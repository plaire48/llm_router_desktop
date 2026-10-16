const {decisionNoticeContent}=require('./decision-notices.cjs');

function createAnswerNotices({Notification,getWindow,send,icon,platform=process.platform,history}){
 const notices=new Map(),seen=new Set();
 return {
  show(value={}){
   const {projectId,taskId,runId}=value;
   if(![projectId,taskId,runId].every(id=>typeof id==='string'&&/^[\w-]{1,100}$/.test(id)))return {shown:false};
   const id=[projectId,taskId,runId].join(':');
   if(platform!=='win32'||(seen.has(id)||history?.has('answer',id)))return {shown:false};
   try{
    const window=getWindow();if(!window||window.isDestroyed()||!Notification.isSupported())return {shown:false};
    const options=decisionNoticeContent({...value,kind:'answer',summary:'답변이 도착했어요. 눌러서 확인하세요.'});
    const notice=new Notification({...options,icon,silent:true});
    const entry={notice};notices.set(id,entry);seen.add(id);history?.add('answer',id);
    if(seen.size>512)seen.delete(seen.values().next().value);
    if(notices.size>20){const oldest=notices.keys().next().value;const old=notices.get(oldest);notices.delete(oldest);old.notice.close();}
    notice.on('click',()=>{
     if(notices.get(id)!==entry)return;
     const current=getWindow();if(!current||current.isDestroyed())return;
     notices.delete(id);
     if(current.isMinimized())current.restore();current.show();current.focus();
     send({type:'answer_open',projectId,taskId,runId,...(value.workspaceKind==='conversation'?{workspaceKind:'conversation'}:{})});
    });
    notice.on('failed',()=>{notices.delete(id);});
    notice.show();return {shown:true};
   }catch{return {shown:false};}
  },
  clear(){const entries=[...notices.values()];notices.clear();for(const {notice} of entries)try{notice.close();}catch{}}
 };
}
module.exports={createAnswerNotices};
