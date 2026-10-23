import {SaxesParser} from 'saxes';
import {open,lstat,realpath,opendir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

const CONFIG=String.raw`C:\mySingle\DesktopMessage\DesktopMessageEnv.xml`;
const FALLBACK=String.raw`C:\mySingle`;
const SETTING='setting:desktop-mail-source';
const digest=value=>createHash('sha256').update(value).digest('hex');
const timestamp=()=>new Date().toISOString();
const cancelled=signal=>{if(signal?.aborted)throw Error('mail_cancelled');};
const inside=(child,parent)=>{const relative=path.relative(path.resolve(parent),path.resolve(child));return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export function separateDesktopStorage(source,destination){if(inside(source,destination)||inside(destination,source))throw Error('mail_storage_nested');}
function discoverWithDeadline(discover,signal,timeout){
 cancelled(signal);
 return new Promise((resolve,reject)=>{
  const scope=new AbortController();let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>{scope.abort();finish(Error('mail_cancelled'));};
  const timer=setTimeout(()=>{scope.abort();finish(Error('mail_desktop_timeout'));},timeout);
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>discover({signal:scope.signal})).then(value=>finish(null,value),error=>finish(error));
 });
}

// Parse configuration, never the application's private databases or SSO session.
// saxes is already used by the desktop runtime. External entities are refused.
export function desktopStoragePaths(xml){
 const roots=[],parser=new SaxesParser({xmlns:true});let depth=0,storage=0,text='';
 parser.on('doctype',()=>{throw Error('mail_desktop_config');});
 parser.on('opentag',tag=>{depth++;if(tag.local==='storage'){if(storage)throw Error('mail_desktop_config');storage=depth;text='';}});
 const append=value=>{if(storage)text+=value;};parser.on('text',append);parser.on('cdata',append);
 parser.on('closetag',()=>{if(storage===depth){if(text.trim())roots.push(text.trim());storage=0;}depth--;});
 try{parser.write(xml).close();}catch{throw Error('mail_desktop_config');}
 return [...new Set(roots)];
}
async function configText(file){
 if((await lstat(file)).isSymbolicLink())throw Error('mail_desktop_config');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const before=await handle.stat();if(!before.isFile()||before.size>1024*1024)throw Error('mail_desktop_config');
  const buffer=Buffer.alloc(before.size+1);let size=0;
  while(size<buffer.length){const {bytesRead}=await handle.read(buffer,size,buffer.length-size,size);if(!bytesRead)break;size+=bytesRead;}
  const bytes=buffer.subarray(0,size),after=await handle.stat();
  if(bytes.length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('mail_desktop_config');
  if(bytes[0]===0xff&&bytes[1]===0xfe)return bytes.toString('utf16le').replace(/^\uFEFF/,'');
  const encoding=/encoding=["']([^"']+)/i.exec(bytes.subarray(0,200).toString('ascii'))?.[1]||'utf-8';
  try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch{throw Error('mail_desktop_config');}
 }finally{await handle.close();}
}
export async function discoverDesktopMail({platform=process.platform,configFile=CONFIG,fallback=FALLBACK,signal}={}){
 if(platform!=='win32')return {supported:false,profiles:[],error:'mail_desktop_windows'};
 cancelled(signal);let roots;
 try{roots=desktopStoragePaths(await configText(configFile));}
 catch(error){if(error.code!=='ENOENT')throw Error('mail_desktop_config');roots=[];}
 if(!roots.length)roots=[fallback];
 const profiles=[],failures=[];
 for(const source of roots){
  cancelled(signal);if(!path.isAbsolute(source))throw Error('mail_desktop_config');
  let directory;
  try{if(!(await lstat(source)).isDirectory()||(await lstat(source)).isSymbolicLink())throw Error();directory=await realpath(source);}
  catch{failures.push('mail_desktop_storage');continue;}
  try{
   for await(const item of await opendir(directory)){
    cancelled(signal);if(!item.isDirectory()||item.isSymbolicLink())continue;
    const root=path.join(directory,item.name),marker=path.join(root,'UserSavedBoxInfo.xml');
    try{const info=await lstat(marker);if(!info.isFile()||info.isSymbolicLink()||(await lstat(root)).isSymbolicLink()||await realpath(root)!==root)continue;}
    catch(error){if(error.code!=='ENOENT')failures.push('mail_desktop_storage');continue;}
    const id=digest(root);if(!profiles.some(profile=>profile.id===id))profiles.push({id,root,label:item.name});
   }
  }catch(error){cancelled(signal);failures.push('mail_desktop_storage');}
 }
 profiles.sort((a,b)=>a.label.localeCompare(b.label));
 return {supported:true,profiles,error:profiles.length?null:failures.length?'mail_desktop_storage':'mail_desktop_not_found'};
}

// The existing MIME importer owns original references, source hashes, per-file
// receipts and the Personal Wiki queue. This class only selects and polls its
// read-only Desktop Message source. No portal, browser or network fallback.
export class DesktopMailSource{
 constructor(mail,{discover=discoverDesktopMail,intervalMs=300000,discoveryTimeoutMs=15000}={}){
  this.mail=mail;this.discover=discover;this.intervalMs=intervalMs;this.discoveryTimeoutMs=discoveryTimeoutMs;this.saved=mail.store.get(SETTING)||{};
  this.profiles=[];this.supported=process.platform==='win32';this.epoch=0;
 }
 get enabled(){return this.saved.mode!=='portal'&&this.saved.enabled===true;}
 snapshot(){return {mode:this.saved.mode||'desktop',storageMode:'desktop_reference',supported:this.supported,connected:this.enabled,connecting:!!this.connecting&&!this.connecting.signal.aborted,checking:!!this.running,profiles:this.profiles.map(({id,label})=>({id,label})),profileId:this.saved.profileId||null,label:this.saved.label||null,directory:this.saved.root||null,lastCheckedAt:this.saved.lastCheckedAt||null,nextCheckAt:this.nextCheckAt||null,error:this.error||null,requiresSelection:this.requiresSelection===true};}
 persist(value){this.saved={...this.saved,...value};this.mail.store.set(SETTING,this.saved);}
 async connect(profileId){
  if(this.connecting||this.running||this.mail.importController||this.mail.relocating)throw Error('mail_busy');
  const controller=new AbortController(),epoch=++this.epoch;this.connecting=controller;
  try{
   const found=await discoverWithDeadline(this.discover,controller.signal,this.discoveryTimeoutMs);cancelled(controller.signal);if(epoch!==this.epoch||this.mail.disposed)throw Error('mail_cancelled');
   this.supported=found.supported;this.profiles=found.profiles;this.error=found.error||null;
   if(this.error)return this.snapshot();
   const profile=profileId?found.profiles.find(item=>item.id===profileId):found.profiles.length===1?found.profiles[0]:null;
   if(profileId&&!profile)throw Error('mail_desktop_source_changed');
   if(!profile){this.requiresSelection=true;return this.snapshot();}
   for(const destination of [this.mail.root,this.mail.rawRoot,this.mail.wikiStoreRoot])separateDesktopStorage(profile.root,destination);
   clearTimeout(this.timer);this.timer=null;this.mail.disconnect();this.mail.error=null;this.mail.account=digest('nubi-local-mail-files-v1');this.requiresSelection=false;this.error=null;
   this.persist({mode:'desktop',enabled:true,profileId:profile.id,root:profile.root,label:profile.label});
   this.mail.watchPaused=false;this.mail.store.set('setting:watch-paused',false);
  }finally{if(this.connecting===controller)this.connecting=null;}
  void this.sync({manual:true}).catch(()=>{});return this.snapshot();
 }
 async sync({manual=false}={}){
  if(!this.enabled)throw Error('mail_desktop_not_connected');
  if(this.running||this.mail.importController||this.mail.relocating)throw Error('mail_busy');
  if(this.mail.disposed||this.mail.resetting||this.mail.store.get('setting:reset-pending'))throw Error('mail_cancelled');
  if(!manual&&(!this.mail.autoWiki||this.mail.watchPaused))return;
  clearTimeout(this.timer);this.timer=null;const controller=new AbortController(),epoch=this.epoch;this.running=controller;
  try{
   const found=await discoverWithDeadline(this.discover,controller.signal,this.discoveryTimeoutMs);cancelled(controller.signal);
   if(epoch!==this.epoch||this.mail.disposed)throw Error('mail_cancelled');
   const profile=found.profiles.find(item=>item.id===this.saved.profileId&&item.root===this.saved.root);
   if(!profile)throw Error(found.error||'mail_desktop_source_changed');
   // Pin the selected account; a disappeared account never selects another one.
   this.ownsImport=true;
   await this.mail.startFolderImport(profile.root,{source:'desktop'});
   await this.mail.importTask;cancelled(controller.signal);
   if(epoch!==this.epoch||this.mail.disposed)throw Error('mail_cancelled');
   const progress=this.mail.importProgress;
   if(progress.state==='cancelled')throw Error('mail_cancelled');
   this.error=progress.state==='failed'?progress.error:progress.failures.length?'mail_desktop_partial':null;
   this.persist({lastCheckedAt:timestamp()});
  }catch(error){if(error.message!=='mail_cancelled'&&!this.mail.disposed)this.error=/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_desktop_storage';}
  finally{
   if(!this.mail.disposed&&epoch===this.epoch&&['mail_storage_full','mail_storage_permission','mail_encryption_unavailable','mail_encryption_integrity','mail_encryption_key_lost'].includes(this.error)){
    this.mail.watchPaused=true;this.mail.store.set('setting:watch-paused',true);
   }
   this.ownsImport=false;if(this.running===controller)this.running=null;this.schedule();
  }
 }
 schedule(){
  clearTimeout(this.timer);this.timer=null;this.nextCheckAt=null;
  if(!this.enabled||this.mail.disposed||this.mail.resetting||this.mail.store.get('setting:reset-pending')||!this.mail.autoWiki||this.mail.watchPaused)return;
  const wait=this.error?Math.max(this.intervalMs,300000):this.intervalMs;
  this.nextCheckAt=new Date(Date.now()+wait).toISOString();
  this.timer=setTimeout(()=>{this.timer=null;void this.sync().catch(()=>this.schedule());},wait);this.timer.unref?.();
 }
 wake(){if(this.enabled&&!this.running&&!this.connecting&&!this.timer)void this.sync().catch(()=>this.schedule());}
 pause(){clearTimeout(this.timer);this.timer=null;this.nextCheckAt=null;this.connecting?.abort();this.running?.abort();if(this.ownsImport)this.mail.importController?.abort();}
 disconnect({remote=false}={}){this.epoch++;this.pause();this.persist({enabled:false,...(remote?{mode:'portal'}:{})});this.error=null;}
 dispose(){this.epoch++;this.pause();}
}
