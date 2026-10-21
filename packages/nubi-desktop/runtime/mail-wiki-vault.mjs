// Mail wiki pages are stored encrypted (user decision 2026-10-14: mail data only). The data key lives in the
// connection vault (Electron safeStorage, Windows DPAPI) and in this process's memory. While the runtime runs, a
// decrypted session copy under a user-only directory is what OpenWiki, the wiki screen and search read; the copy is
// wiped on dispose and again on the next start. Pages the user edits on the wiki screen land in the session copy, so
// the directory is watched and changed pages are encrypted again.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,rm,rename,lstat,chmod,stat,watch as watchPromise} from 'node:fs/promises';
import {watch,realpathSync} from 'node:fs';
import path from 'node:path';
export const KEY_NAME='mail-wiki-key';
const MAGIC=Buffer.from('NWK1'),IV=12,TAG=16;
export function encryptPage(key,text){
  const iv=randomBytes(IV),cipher=createCipheriv('aes-256-gcm',key,iv);
  const body=Buffer.concat([cipher.update(Buffer.from(text,'utf8')),cipher.final()]);
  return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),body]);
}
export function decryptPage(key,bytes){
  if(bytes.length<MAGIC.length+IV+TAG||!bytes.subarray(0,MAGIC.length).equals(MAGIC))throw Error('mail_wiki_format');
  const iv=bytes.subarray(MAGIC.length,MAGIC.length+IV),tag=bytes.subarray(MAGIC.length+IV,MAGIC.length+IV+TAG),body=bytes.subarray(MAGIC.length+IV+TAG);
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
  try{return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');}catch{throw Error('mail_wiki_key');}
}
const pageName=name=>/^[^/\\]+\.md$/.test(name)&&!name.startsWith('.');
const encName=name=>/^[^/\\]+\.md\.enc$/.test(name)&&!name.startsWith('.');
export class MailWikiVault{
  // storeRoot: encrypted pages (.md.enc). sessionRoot: decrypted working copy. secrets: {get,set} of the connection vault.
  constructor({storeRoot,sessionRoot,secrets,protect=async()=>{},log=()=>{}}){
    this.storeRoot=storeRoot;this.sessionRoot=sessionRoot;this.secrets=secrets;this.protect=protect;this.log=log;
    this.key=null;this.state='off';this.watcher=null;this.timer=null;this.pending=new Set();this.syncing=Promise.resolve();this.disposed=false;
  }
  async privateDir(directory){await mkdir(directory,{recursive:true,mode:0o700});if((await lstat(directory)).isSymbolicLink())throw Error('mail_file_conflict');await chmod(directory,0o700);await this.protect(directory);}
  // Reads or creates the data key. Without a usable vault the pages stay plain and the state says so.
  async ready(){
    if(this.key)return true;
    if(!this.secrets)return this.unavailable();
    try{
      let hex=await this.secrets.get(KEY_NAME);
      if(!hex){hex=randomBytes(32).toString('hex');await this.secrets.set(KEY_NAME,hex);}
      if(!/^[0-9a-f]{64}$/.test(hex))throw Error('secret_unavailable');
      this.key=Buffer.from(hex,'hex');this.state='on';return true;
    }catch(error){this.log('mail_wiki_key_unavailable',error.message);return this.unavailable();}
  }
  unavailable(){this.state='unavailable';return false;}
  get active(){return this.state==='on'&&!!this.key;}
  // Rebuilds the session copy from the encrypted store; plain pages still in the store are encrypted and removed.
  async hydrate(){
    if(!this.active)return {pages:0,migrated:0};
    await rm(this.sessionRoot,{recursive:true,force:true});await this.privateDir(this.sessionRoot);await this.privateDir(this.storeRoot);
    let pages=0,migrated=0;
    for(const name of (await readdir(this.storeRoot)).sort()){
      const file=path.join(this.storeRoot,name);
      try{
        if((await lstat(file)).isSymbolicLink())continue;
        if(encName(name)){const text=decryptPage(this.key,await readFile(file));await writeFile(path.join(this.sessionRoot,name.slice(0,-4)),text,{mode:0o600});pages++;}
        else if(pageName(name)){const text=await readFile(file,'utf8');await this.persist(name,text);await writeFile(path.join(this.sessionRoot,name),text,{mode:0o600});await rm(file,{force:true});pages++;migrated++;}
      }catch(error){this.log('mail_wiki_page_skipped',name,error.message);}
    }
    this.startWatch();return {pages,migrated};
  }
  // Encrypted at-rest copy of one page; written through a temporary file so a crash leaves no half page.
  async persist(name,text){
    if(!this.active)return;
    const target=path.join(this.storeRoot,name+'.enc'),temporary=target+'.'+randomBytes(6).toString('hex')+'.tmp';
    await writeFile(temporary,encryptPage(this.key,text),{mode:0o600,flag:'wx'});await rename(temporary,target);
  }
  async remove(name){if(!this.active)return;await rm(path.join(this.storeRoot,name+'.enc'),{force:true});}
  // Session pages changed outside the runtime (wiki screen edits) are encrypted again after a short quiet period.
  startWatch(){
    if(this.watcher||this.disposed)return;
    // Watch the folder by its long real path: libuv on Windows aborts the whole process (fs-event.c assertion) when a
    // folder given by its 8.3 short name (C:\\Users\\NAME~1\\..., common for Korean or long user names) reports a change.
    let root=this.sessionRoot;try{root=realpathSync.native(this.sessionRoot);}catch{}
    try{this.watcher=watch(root,{persistent:false},(_event,name)=>{if(typeof name==='string'&&(pageName(name)))this.touch(name);});this.watcher.on('error',()=>{});}catch{this.watcher=null;}
    this.timer=setInterval(()=>void this.syncAll(),30000);this.timer.unref?.();
  }
  touch(name){if(this.disposed)return;this.pending.add(name);clearTimeout(this.debounce);this.debounce=setTimeout(()=>void this.sync(),500);}
  sync(){this.syncing=this.syncing.then(async()=>{const names=[...this.pending];this.pending.clear();for(const name of names)await this.syncOne(name);}).catch(()=>{});return this.syncing;}
  async syncOne(name){
    const file=path.join(this.sessionRoot,name);
    try{const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())return;const text=await readFile(file,'utf8');const current=await this.readStored(name);if(current!==text)await this.persist(name,text);}
    catch(error){if(error.code==='ENOENT')await this.remove(name);}
  }
  async readStored(name){try{return decryptPage(this.key,await readFile(path.join(this.storeRoot,name+'.enc')));}catch{return null;}}
  // Full pass: every session page is compared with its stored copy; stored pages without a session file are kept.
  async syncAll(){
    if(!this.active||this.disposed)return;
    let names=[];try{names=(await readdir(this.sessionRoot)).filter(pageName);}catch{return;}
    if(this.disposed)return;
    for(const name of names)this.pending.add(name);
    await this.sync();
  }
  // Final sync, then the session copy is wiped so no plain page outlives the runtime.
  async dispose(){
    this.disposed=true;clearTimeout(this.debounce);clearInterval(this.timer);this.watcher?.close();this.watcher=null;
    if(this.active){try{await this.syncAll();}catch{}}
    await rm(this.sessionRoot,{recursive:true,force:true}).catch(()=>{});
    this.key=null;
  }
}
