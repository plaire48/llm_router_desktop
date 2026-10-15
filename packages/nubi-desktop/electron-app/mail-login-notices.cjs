function createMailLoginNotices({Notification,getWindow,send,icon,platform=process.platform}){
 let notice=null;
 const close=()=>{const previous=notice;notice=null;try{previous?.close();}catch{}};
 return {clear:close,show({code}={}){
  send({type:'mail_login_required',code});
  if(platform!=='win32'||notice||!Notification.isSupported())return {shown:false};
  try{
   const message=code==='mail_portal_forbidden'?'포털 접근이 거부되어 메일 연결을 해제했어요. 사내망과 VPN을 확인한 뒤 다시 로그인해 주세요.':code==='mail_portal_login'?'사내 메일 세션이 종료됐어요. 눌러서 누비 브라우저에서 다시 로그인해 주세요.':'사내 메일 연결이 끊겨 로그아웃했어요. 사내망과 VPN을 확인한 뒤 다시 로그인해 주세요.';
   const current=new Notification({title:'누비 Workspace — 메일 재로그인',body:message,icon,silent:false});notice=current;
   current.on('click',()=>{if(notice!==current)return;const window=getWindow();if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();send({type:'mail_login_open'});close();});
   current.on('failed',()=>{if(notice===current)notice=null;});current.show();return {shown:true};
  }catch{return {shown:false};}
 }};
}
module.exports={createMailLoginNotices};
