const {GhesAccount}=require('../../nubi-vscode/src/ghes.cjs');
const QUERY='query NubiProfileStatus { viewer { login status { emoji emojiHTML message expiresAt } } }';
function displayStatus(value,now=Date.now()){
 if(!value||typeof value!=='object')return null;
 const expiresAt=value.expiresAt?Date.parse(value.expiresAt):null;
 if(value.expiresAt&&(!Number.isFinite(expiresAt)||expiresAt<=now))return null;
 let emoji=typeof value.emoji==='string'?value.emoji.trim():'';
 if(/^:[\w+-]+:$/.test(emoji)){
  // Extract just the Unicode character. Server HTML is never rendered.
  const html=typeof value.emojiHTML==='string'&&value.emojiHTML.length<=4096?value.emojiHTML:'';
  emoji=html.match(/<g-emoji\b[^>]*>([^<]{1,128})<\/g-emoji>/i)?.[1]||'';
  emoji=emoji.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=parseInt(n[0].toLowerCase()==='x'?n.slice(1):n,n[0].toLowerCase()==='x'?16:10);return code<=0x10ffff?String.fromCodePoint(code):'';});
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
   try{const result=await this.request('/api/graphql',{token:record.token,signal:AbortSignal.timeout(2500),limit:16384,body:{query:QUERY}});
    if(!result.errors?.length&&result.data?.viewer?.login===profile.login)value=displayStatus(result.data.viewer.status,this.now());
   }catch{/* Optional status never blocks login or repository use. */}
   if(this.generation===generation&&this.record===record&&this.profile?.id===profile.id&&this.state==='connected')this.statusCache={generation,id:profile.id,at:this.now(),value};
  })();
  try{await pending.promise;}finally{if(this.statusPending===pending)this.statusPending=null;}
 }
 async status(){await super.status();await this.readProfileStatus();return this.view();}
 async action(operation){const value=await super.action(operation);if(operation==='refresh'){await this.readProfileStatus(true);return this.view();}return value;}
}
module.exports={DesktopGhesAccount,displayStatus,QUERY};
