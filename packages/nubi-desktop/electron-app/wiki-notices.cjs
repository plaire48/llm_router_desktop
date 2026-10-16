function createWikiNotices({Notification,getWindow,send,icon,platform=process.platform,history}){
 const notices=new Map(),seen=new Set();
 return {
  show(value={}){
   const {projectId,jobId,phase}=value;
   if(platform!=='win32'||![projectId,jobId].every(id=>typeof id==='string'&&/^[\w-]{1,100}$/.test(id))||!['created','ready','applied'].includes(phase))return {shown:false};
   const id=[projectId,jobId,phase].join(':');if((seen.has(id)||history?.has('wiki',id)))return {shown:false};
   try{
    const window=getWindow();if(!window||window.isDestroyed()||!Notification.isSupported())return {shown:false};
    const project=String(value.projectName||'프로젝트').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,60);
    const labels={created:'위키 생성 완료',ready:'위키 갱신안 준비 완료',applied:'위키 반영 완료'};
    const count=phase==='created'?value.pages:value.files,amount=Number.isSafeInteger(count)&&count>0?`${count}개 ${phase==='created'?'문서':'파일'}. `:'';
    const notice=new Notification({title:`${project} — ${labels[phase]}`,body:amount+(phase==='ready'?'변경 내용을 확인하고 반영해 주세요.':'눌러서 프로젝트 위키를 확인하세요.'),icon,silent:true});
    notices.set(id,notice);seen.add(id);history?.add('wiki',id);if(seen.size>512)seen.delete(seen.values().next().value);
    if(notices.size>20){const oldest=notices.keys().next().value;const old=notices.get(oldest);notices.delete(oldest);old.close();}
    notice.on('click',()=>{if(notices.get(id)!==notice)return;const current=getWindow();if(!current||current.isDestroyed())return;notices.delete(id);if(current.isMinimized())current.restore();current.show();current.focus();send({type:'wiki_open',projectId,jobId,phase});});
    notice.on('failed',()=>notices.delete(id));notice.show();return {shown:true};
   }catch{return {shown:false};}
  },
  clear(){const pending=[...notices.values()];notices.clear();for(const notice of pending)try{notice.close();}catch{}}
 };
}
module.exports={createWikiNotices};
