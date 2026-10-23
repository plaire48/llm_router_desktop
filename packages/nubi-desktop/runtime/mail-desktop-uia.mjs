import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {POWERSHELL_TEXT_ARGS,POWERSHELL_UTF8_PREFIX} from './powershell-encoding.mjs';
import {MAIL_CONTENT_VERSION} from '../../openwiki/src/connectors/sources/pop3-content.mjs';
const SETTING='setting:desktop-mail-source',sha=value=>createHash('sha256').update(value).digest('hex');
const apps=new Set(['mysingledesktopmessage','desktopmessage','knoxdesktop']);
const cancelled=signal=>{if(signal?.aborted)throw Error('mail_cancelled');};
const sameBinding=(a,b)=>a&&b&&['processId','hwnd','started','processName'].every(key=>a[key]===b[key]);
function bindingValid(b){return b&&Number.isSafeInteger(b.processId)&&b.processId>0&&Number.isSafeInteger(b.hwnd)&&b.hwnd>0&&typeof b.started==='string'&&/^\d{1,24}$/.test(b.started)&&apps.has(String(b.processName).toLowerCase().replace(/\.exe$/,''));}

// Adapts the shared Knox._connect/snapshot/Node structure: bind one real window,
// fetch its cached UIA tree and read current Text/Value patterns in an STA child.
// No local archive discovery, portal/API, clipboard or physical-input fallback.
export async function readKnoxMailUia(request,{signal,platform=process.platform,timeoutMs=15000}={}){
 if(platform!=='win32')throw Error('mail_desktop_windows');cancelled(signal);
 const script=POWERSHELL_UTF8_PREFIX+await readFile(new URL('./mail-desktop-uia.ps1',import.meta.url),'utf8');cancelled(signal);
 const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATH'])if(process.env[key])env[key]=process.env[key];
 const executable=path.win32.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,[...POWERSHELL_TEXT_ARGS,'-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env});
  let size=0,failure;const chunks=[];const stop=code=>{failure ||=code;child.kill();},abort=()=>stop('mail_cancelled');
  const timer=setTimeout(()=>stop('mail_desktop_timeout'),timeoutMs);signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>4*1024*1024)stop('mail_desktop_uia_limit');else chunks.push(chunk);});
  child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',()=>{failure ||= 'mail_desktop_uia_unavailable';});
  child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure)return reject(Error(failure));try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));if(code||result.error)throw Error(/^mail_desktop_[a-z_]+$/.test(result.error||'')?result.error:'mail_desktop_uia_unavailable');if(request.action==='discover')result.profiles=(result.profiles||[]).map(p=>({...p,id:sha(JSON.stringify(p.binding))}));resolve(result);}catch(error){reject(Error(/^mail_desktop_[a-z_]+$/.test(error.message)?error.message:'mail_desktop_uia_unavailable'));}});
  child.stdin.end(JSON.stringify(request));if(signal?.aborted)abort();
 });
}

export function uiaMailCapture(input){
 if(input?.version!==1||!bindingValid(input.binding)||!Array.isArray(input.nodes)||input.nodes.length>2500||input.truncated===true)throw Error('mail_desktop_uia_limit');
 const byKey=new Map();
 for(const n of input.nodes){if(!n||typeof n.key!=='string'||byKey.has(n.key)||n.parent!==null&&typeof n.parent!=='string')throw Error('mail_desktop_uia_body');byKey.set(n.key,n);}
 for(const n of input.nodes)if(n.parent!==null&&!byKey.has(n.parent))throw Error('mail_desktop_uia_body');
 const hidden=n=>{const seen=new Set();for(let p=n;p;p=byKey.get(p.parent)){if(seen.has(p.key))throw Error('mail_desktop_uia_body');seen.add(p.key);if(p.isPassword||p.isOffscreen||p.type==='Edit'&&p.readOnly!==true)return true;}return false;};
 const nodes=input.nodes.filter(n=>!hidden(n)).map(n=>({key:n.key,parent:n.parent,type:String(n.type||''),name:String(n.name||''),automationId:String(n.automationId||''),className:String(n.className||''),...(typeof n.text==='string'?{text:n.text}:{}),...(typeof n.value==='string'&&n.readOnly===true?{value:n.value}:{}),...(typeof n.readOnly==='boolean'?{readOnly:n.readOnly}:{})}));
 if(nodes.some(n=>n.name.length>4096||(n.text||'').length>131072||(n.value||'').length>131072)||Buffer.byteLength(JSON.stringify(nodes))>3*1024*1024)throw Error('mail_desktop_uia_limit');
 const ancestor=(node,types)=>{let p=byKey.get(node.parent);const seen=new Set();while(p){if(seen.has(p.key))throw Error('mail_desktop_uia_body');seen.add(p.key);if(types.includes(p.type))return true;p=byKey.get(p.parent);}return false;};
 const bodyNodes=nodes.filter(n=>(n.type==='Document'||n.type==='Edit'&&n.readOnly===true&&/본문|내용|body|message/i.test(n.name+' '+n.automationId))&&n.readOnly!==false&&String(n.text||n.value||'').trim());
 const descendantOf=(node,parent)=>{let p=byKey.get(node.parent);const seen=new Set();while(p&&!seen.has(p.key)){seen.add(p.key);if(p.key===parent.key)return true;p=byKey.get(p.parent);}return false;};
 const body=bodyNodes.filter(n=>!bodyNodes.some(other=>descendantOf(other,n)));
 if(body.length>1)throw Error('mail_desktop_uia_ambiguous');
 // Quoted headers in the body are message content, never envelope metadata.
 const labels=nodes.filter(n=>!ancestor(n,['List','DataGrid','Tree','ToolBar','MenuBar'])&&!body.some(parent=>descendantOf(n,parent))&&['Text','Edit'].includes(n.type));
 const usedKeys=new Set(),envelopeLabel=/^(?:제목|Subject|보낸\s*사람|발신자|From|받는\s*사람|수신자|To|참조|Cc|보낸\s*날짜|받은\s*날짜|날짜|Date)(?:\s*[:：]|\s*$)/i;
 const header=pattern=>{
  const values=[],prefix=new RegExp('^(?:'+pattern+')\\s*[:：]\\s*(.+)$','i'),label=new RegExp('^(?:'+pattern+')\\s*[:：]?$','i');
  for(let i=0;i<labels.length;i++){const n=labels[i],m=prefix.exec(n.name.trim());if(m){values.push(m[1].trim());usedKeys.add(n.key);}else if(label.test(n.name.trim())){if(n.value){values.push(n.value.trim());usedKeys.add(n.key);}else{const next=labels[i+1];if(next?.parent===n.parent&&!envelopeLabel.test(next.name.trim())){values.push((next.value||next.name).trim());usedKeys.add(n.key);usedKeys.add(next.key);}}}}
  const unique=[...new Set(values.filter(Boolean))];if(unique.length>1)throw Error('mail_desktop_uia_ambiguous');return unique[0]||'';
 };
 const subject=header('제목|Subject'),from=header('보낸\\s*사람|발신자|From');if(!subject||!from||body.length!==1)throw Error('mail_desktop_uia_body');
 const fields={subject,from,to:header('받는\\s*사람|수신자|To'),cc:header('참조|Cc'),date:header('보낸\\s*날짜|받은\\s*날짜|날짜|Date'),text:body[0].text||body[0].value};
 if(!fields.text.trim())throw Error('mail_desktop_uia_body');
 const capturedAt=new Date(input.capturedAt);if(!Number.isFinite(capturedAt.getTime()))throw Error('mail_desktop_uia_body');
 // Keep the observed envelope/body and their tree paths. Parent documents can
 // contain sidebar text or editable values; only the chosen body retains text.
 for(const node of nodes)if(node.key===body[0].key||descendantOf(node,body[0]))usedKeys.add(node.key);
 for(const key of [...usedKeys]){let p=byKey.get(key);while(p){usedKeys.add(p.key);p=byKey.get(p.parent);}}
 const capturedNodes=nodes.filter(node=>usedKeys.has(node.key)).map(node=>{if(node.type!=='Document'||node.key===body[0].key)return node;const {text,value,...metadata}=node;return metadata;});
 const observedBinding=Object.fromEntries(['processId','hwnd','started','processName'].map(key=>[key,input.binding[key]]));
 const snapshot={version:1,kind:'knox-desktop-uia',binding:observedBinding,capturedAt:capturedAt.toISOString(),nodes:capturedNodes,coverage:{scope:'open_message',completeMailbox:false,originalMimeAvailable:false,attachmentsRead:false,mailboxKnown:false}};
 const raw=Buffer.from(JSON.stringify(snapshot)),uidl=sha(JSON.stringify(fields));
 return {uidl,raw,protocol:'local',mailbox:'other',uiaCapture:true,attachments:[],normalized:{...fields,attachments:[],sourceApp:'knox_desktop_uia',sourceType:'mail',documentKind:'other',documentKindLabel:'Desktop에서 읽은 메일',classificationSource:'uia_observation',contentVersion:MAIL_CONTENT_VERSION,bodySource:'uia',truncated:false,observedAt:snapshot.capturedAt,coverage:snapshot.coverage,storage:{mode:'desktop_uia',format:'uia-json',originalMimeAvailable:false}}};
}

export class DesktopUiaMailSource{
 constructor(mail,{read=readKnoxMailUia,intervalMs=300000,timeoutMs=15000}={}){Object.assign(this,{mail,read,intervalMs,timeoutMs});this.saved=mail.store.get(SETTING)||{};this.profiles=[];this.epoch=0;this.supported=process.platform==='win32';if(this.saved.enabled&&this.saved.transport!=='uia')this.error='mail_desktop_uia_reconnect';}
 get enabled(){return this.saved.mode!=='portal'&&this.saved.enabled===true&&this.saved.transport==='uia'&&bindingValid(this.saved.profile?.binding);}
 snapshot(){return {mode:this.saved.mode||'desktop',transport:'uia',storageMode:'desktop_uia',supported:this.supported,connected:!!this.enabled,connecting:!!this.connecting&&!this.connecting.signal.aborted,checking:!!this.running,profiles:this.profiles.map(({id,label})=>({id,label})),profileId:this.saved.profile?.id||null,label:this.saved.profile?.label||null,error:this.error||null,requiresSelection:!!this.requiresSelection,lastCheckedAt:this.saved.lastCheckedAt||null,nextCheckAt:this.nextCheckAt||null,scope:'open_message',intervalMs:this.intervalMs,rawRoot:this.mail.rawRoot};}
 persist(value){this.saved={...this.saved,...value};this.mail.store.set(SETTING,this.saved);}
 async request(args,signal){cancelled(signal);const scope=new AbortController();let timer,abort;try{return await Promise.race([Promise.resolve().then(()=>this.read(args,{signal:scope.signal,timeoutMs:this.timeoutMs})),new Promise((_,reject)=>{abort=()=>{scope.abort();reject(Error('mail_cancelled'));};signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{scope.abort();reject(Error('mail_desktop_timeout'));},this.timeoutMs);if(signal.aborted)abort();})]);}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}}
 async connect(profileId){
  if(this.connecting||this.running||this.mail.importController||this.mail.relocating)throw Error('mail_busy');const controller=new AbortController(),epoch=++this.epoch;this.connecting=controller;
  try{const found=await this.request({action:'discover'},controller.signal);cancelled(controller.signal);if(epoch!==this.epoch||this.mail.disposed)throw Error('mail_cancelled');
   this.supported=found.supported!==false;this.profiles=(found.profiles||[]).filter(p=>bindingValid(p.binding)&&p.id===sha(JSON.stringify(p.binding))&&typeof p.label==='string');if(!this.profiles.length)throw Error(found.error||'mail_desktop_not_found');
   const profile=profileId?this.profiles.find(p=>p.id===profileId):this.profiles.length===1?this.profiles[0]:null;if(profileId&&!profile)throw Error('mail_desktop_source_changed');this.requiresSelection=!profile;this.error=null;if(!profile)return this.snapshot();
   clearTimeout(this.timer);this.timer=null;this.mail.disconnect();this.mail.error=null;this.mail.account=sha('knox-desktop-uia\0'+profile.id);this.mail.watchPaused=false;this.mail.store.set('setting:watch-paused',false);
   this.persist({mode:'desktop',transport:'uia',enabled:true,profile,root:null,profileId:null,lastCheckedAt:null});
  }catch(error){if(error.message!=='mail_cancelled'&&epoch===this.epoch)this.error=/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_desktop_uia_unavailable';throw error;}
  finally{if(this.connecting===controller)this.connecting=null;}
  void this.sync({manual:true}).catch(()=>{});return this.snapshot();
 }
 async sync({manual=false}={}){
  if(!this.enabled)throw Error('mail_desktop_not_connected');if(this.running||this.connecting||this.mail.importController||this.mail.relocating)throw Error('mail_busy');if(this.mail.disposed||this.mail.resetting||this.mail.store.get('setting:reset-pending'))throw Error('mail_cancelled');if(!manual&&(!this.mail.autoWiki||this.mail.watchPaused))return;
  clearTimeout(this.timer);this.timer=null;this.nextCheckAt=null;const controller=new AbortController(),epoch=this.epoch,generation=this.mail.generation;this.running=controller;
  try{const observed=await this.request({action:'snapshot',binding:this.saved.profile.binding},controller.signal);cancelled(controller.signal);if(epoch!==this.epoch||generation!==this.mail.generation||this.mail.disposed)throw Error('mail_cancelled');if(!sameBinding(observed.binding,this.saved.profile.binding))throw Error('mail_desktop_source_changed');
   const capture=uiaMailCapture(observed),accountId=sha('knox-desktop-uia\0'+this.saved.profile.id),id=sha(accountId+'\0'+capture.uidl);
   if(!this.mail.store.get('mail:'+id))await this.mail.intake({mails:[capture],failed:[]},generation,{collectOnly:true,accountId,includeAttachments:false,signal:controller.signal});else await this.mail.sourceBytes(this.mail.store.get('mail:'+id));
   cancelled(controller.signal);if(epoch!==this.epoch||this.mail.disposed)throw Error('mail_cancelled');this.error=null;this.persist({lastCheckedAt:new Date().toISOString()});this.mail.resumeProcessing();
  }catch(error){if(error.message!=='mail_cancelled'&&epoch===this.epoch&&!this.mail.disposed)this.error=/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_desktop_uia_unavailable';}
  finally{if(this.running===controller)this.running=null;if(['mail_storage_full','mail_storage_permission','mail_encryption_unavailable','mail_encryption_integrity','mail_encryption_key_lost'].includes(this.error)){this.mail.watchPaused=true;this.mail.store.set('setting:watch-paused',true);}this.schedule();}
 }
 schedule(){clearTimeout(this.timer);this.timer=null;this.nextCheckAt=null;if(!this.enabled||this.mail.disposed||this.mail.resetting||this.mail.store.get('setting:reset-pending')||!this.mail.autoWiki||this.mail.watchPaused)return;this.nextCheckAt=new Date(Date.now()+this.intervalMs).toISOString();this.timer=setTimeout(()=>{this.timer=null;void this.sync().catch(()=>this.schedule());},this.intervalMs);this.timer.unref?.();}
 wake(){if(this.enabled&&!this.running&&!this.connecting&&!this.timer)void this.sync().catch(()=>this.schedule());}
 pause(){clearTimeout(this.timer);this.timer=null;this.nextCheckAt=null;this.connecting?.abort();this.running?.abort();}
 disconnect({remote=false}={}){this.epoch++;this.pause();this.persist({enabled:false,...(remote?{mode:'portal'}:{})});this.error=null;}
 dispose(){this.epoch++;this.pause();}
}
