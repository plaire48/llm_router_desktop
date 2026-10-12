// Native notices carry no task content. They only reopen a still-pending form.
function createDecisionNotices({Notification,getWindow,send,icon,platform=process.platform}){
 const notices=new Map();
 return {
  request({id,action,kind}={}){
   if(typeof id!=='string'||!id||id.length>300||!['show','clear'].includes(action))throw Error('decision_notice_invalid');
   if(action==='clear'){
    const entry=notices.get(id);notices.delete(id);entry?.notice.close();return {cleared:true};
   }
   const window=getWindow();
   if(platform!=='win32'||!window||window.isDestroyed()||!Notification.isSupported()||notices.has(id))return {shown:false};
   // Bound references even if a renderer reload loses its cleanup callbacks.
   if(notices.size>=20){const oldest=notices.keys().next().value;const entry=notices.get(oldest);notices.delete(oldest);entry.notice.close();}
   try{
    const body=kind==='proposal'?'변경 내용을 확인해 주세요.':kind==='command'?'실행할 명령을 확인해 주세요.':kind==='computer'?'앱 연결이나 동작을 확인해 주세요.':'확인이 필요해요. 눌러서 답변해 주세요.';
    const notice=new Notification({title:'누비 Workspace',body,icon,silent:true});
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
module.exports={createDecisionNotices};
