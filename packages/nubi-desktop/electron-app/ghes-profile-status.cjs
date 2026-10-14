const {GhesAccount}=require('../../nubi-vscode/src/ghes.cjs');
const {ghesImageTarget,fetchGhesImage}=require('./ghes-image.cjs');
// Common GitHub shortcodes, used only when the server sends no emoji HTML at all.
const SHORTCODES={smile:'😄',smiley:'😃',grinning:'😀',blush:'😊',slightly_smiling_face:'🙂',wink:'😉',sunglasses:'😎',thinking:'🤔',sweat_smile:'😅',joy:'😂',heart:'❤️',thumbsup:'👍','+1':'👍',wave:'👋',raised_hand:'✋',eyes:'👀',fire:'🔥',rocket:'🚀',tada:'🎉',sparkles:'✨',star:'⭐',zap:'⚡',coffee:'☕',computer:'💻',technologist:'🧑‍💻',books:'📚',memo:'📝',dart:'🎯',bulb:'💡',calendar:'📆',spiral_calendar:'🗓️',house:'🏠',house_with_garden:'🏡',office:'🏢',palm_tree:'🌴',beach_umbrella:'🏖️',airplane:'✈️',car:'🚗',face_with_thermometer:'🤒',mask:'😷',zzz:'💤',sleeping:'😴',no_entry:'⛔',red_circle:'🔴',green_circle:'🟢',white_check_mark:'✅',warning:'⚠️',hourglass:'⌛',headphones:'🎧',muscle:'💪',pray:'🙏'};
const decodeEntities=text=>text.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=parseInt(n[0].toLowerCase()==='x'?n.slice(1):n,n[0].toLowerCase()==='x'?16:10);return code<=0x10ffff?String.fromCodePoint(code):'';});
// Statuses that a later check can clear by itself (network, a company page in the way, a busy key store).
const RECHECK_FAILURES=new Set(['ghes_network','ghes_response_invalid','ghes_rate_limited','ghes_cancelled','ghes_storage_read','ghes_sso_required']);
const RECHECK_MS=20000;
const QUERY='query NubiProfileStatus { viewer { login status { emoji emojiHTML message expiresAt } } }';
function displayStatus(value,now=Date.now()){
 if(!value||typeof value!=='object')return null;
 const expiresAt=value.expiresAt?Date.parse(value.expiresAt):null;
 if(value.expiresAt&&(!Number.isFinite(expiresAt)||expiresAt<=now))return null;
 let emoji=typeof value.emoji==='string'?value.emoji.trim():'';
 if(/^:[\w+-]+:$/.test(emoji)){
  // Extract just the Unicode character. Server HTML is never rendered.
  const html=typeof value.emojiHTML==='string'&&value.emojiHTML.length<=4096?value.emojiHTML:'';
  const name=emoji.slice(1,-1);
  emoji=decodeEntities(html.match(/<g-emoji\b[^>]*>([^<]{1,128})<\/g-emoji>/i)?.[1]||'');
  if(!emoji&&/<img\b/i.test(html)){
   // A custom company emoji is a picture: keep only its address on the company image hosts, never the HTML.
   const source=html.match(/<img\b[^>]*\bsrc="([^"<>]{1,2048})"/i)?.[1]||'';
   const image=ghesImageTarget(source.replace(/&amp;/g,'&'));
   if(!image)return null;
   const message=typeof value.message==='string'?value.message.replace(/[\x00-\x1f]/g,' ').trim().slice(0,160):'';
   return {emoji:'',image:image.href,name:name.slice(0,64),message,...(expiresAt?{expiresAt:new Date(expiresAt).toISOString()}:{})};
  }
  if(!emoji&&!html&&Object.hasOwn(SHORTCODES,name))emoji=SHORTCODES[name];
 }
 if(emoji.length>64||!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji)||/[<>\x00-\x1f]/.test(emoji)||[...new Intl.Segmenter('en',{granularity:'grapheme'}).segment(emoji)].length!==1)return null;
 const message=typeof value.message==='string'?value.message.replace(/[\x00-\x1f]/g,' ').trim().slice(0,160):'';
 return {emoji,message,...(expiresAt?{expiresAt:new Date(expiresAt).toISOString()}:{})};
}
class DesktopGhesAccount extends GhesAccount{
 view(){const value=super.view(),cached=this.statusCache;return value.connected&&value.profile?{...value,profile:{...value.profile,status:cached?.generation===this.generation&&cached.id===value.profile.id?displayStatus(cached.value,this.now()):null}}:value;}
 async readProfileStatus(force=false){
  const generation=this.generation,record=this.record,profile=this.profile;
  if(this.state!=='connected'||!record||!profile)return;
  const cached=this.statusCache;
  if(!force&&cached?.generation===generation&&cached.id===profile.id&&this.now()-cached.at<60000)return;
  if(this.statusPending?.generation===generation)return this.statusPending.promise;
  const pending={generation};this.statusPending=pending;
  pending.promise=(async()=>{
   let value=null;
   // A partial GraphQL answer (an error beside the viewer) still carries the status; 5 s covers a slow company network.
   try{const result=await this.request('/api/graphql',{token:record.token,signal:AbortSignal.timeout(5000),limit:16384,body:{query:QUERY}});
    if(result.data?.viewer?.login===profile.login)value=displayStatus(result.data.viewer.status,this.now());
   }catch{/* Optional status never blocks login or repository use. */}
   if(this.generation===generation&&this.record===record&&this.profile?.id===profile.id&&this.state==='connected')this.statusCache={generation,id:profile.id,at:this.now(),value};
  })();
  try{await pending.promise;}finally{if(this.statusPending===pending)this.statusPending=null;}
 }
 // Photos may live on the avatars host of the same server (subdomain isolation); see ghes-image.cjs.
 async avatar(url,token,signal,photoDeadline=AbortSignal.timeout(5000)){
  const target=ghesImageTarget(url);if(!target)return null;
  if(!target.searchParams.has('s'))target.searchParams.set('s','128');
  const deadline=AbortSignal.any([...(signal?[signal]:[]),photoDeadline]);
  let image=null;
  try{image=await fetchGhesImage(target,{token,apiFetch:this.fetcher,sessionFetch:this.avatarFetcher,signal:deadline,limit:1024*1024});}catch{}
  if(signal?.aborted)throw Error('ghes_cancelled');
  return image?.sniffed?'data:'+image.sniffed+';base64,'+image.bytes.toString('base64'):null;
 }
 // An unreadable key store at start-up (OS key service busy or locked) is a state to re-check, not a failed request
 // that leaves the person signed out with a bare code (user report 2026-10-14).
 async restore(){
  const generation=this.generation;if(!this.loaded)this.restoreAt=this.now();
  try{await super.restore();}
  catch{if(generation!==this.generation)return;this.state='attention';this.failure='ghes_storage_read';this.failureDiagnostic=null;}
 }
 async status(){
  // A start-up check that met a passing problem (VPN still connecting, a company page in the way) runs again on a
  // later status read instead of waiting for the person to press '연결 다시 확인'.
  if(this.state==='attention'&&this.loaded&&!this.restoring&&RECHECK_FAILURES.has(this.failure)&&this.now()-(this.restoreAt||0)>=RECHECK_MS)this.loaded=false;
  await super.status();await this.readProfileStatus();return this.view();
 }
 async action(operation){const value=await super.action(operation);if(operation==='refresh'){await this.readProfileStatus(true);return this.view();}return value;}
}
module.exports={DesktopGhesAccount,displayStatus,QUERY,RECHECK_MS};
