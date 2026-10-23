import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {lstat,readdir,opendir,rename,rm} from 'node:fs/promises';
import path from 'node:path';

export const RAW_KEY_NAME='mail-raw-key';
const MAGIC=Buffer.from('NMR1'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const payload=name=>name==='message.eml'||name==='uia.json'||name==='manifest.json'||/^\d{3}-[a-f0-9]{16}\.bin$/.test(name);
const sourceId=directory=>path.basename(directory).replace(/^\.([a-f0-9]{64})\.pending$/,'$1');
const context=file=>Buffer.from(sourceId(path.dirname(file))+'/'+path.basename(file));
export function encryptRaw(key,bytes,aad){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
 const body=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),body]);
}
export function decryptRaw(key,bytes,aad){
 try{
  if(bytes.length<32||!bytes.subarray(0,4).equals(MAGIC))throw Error();
  const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));cipher.setAAD(aad);cipher.setAuthTag(bytes.subarray(16,32));
  return Buffer.concat([cipher.update(bytes.subarray(32)),cipher.final()]);
 }catch{throw Error('mail_encryption_integrity');}
}
// Only automatic original storage uses this vault. Plaintext exists in memory for
// parsing/export; Office's separately protected, short-lived COM copy stays unchanged.
export class MailRawVault{
 constructor({root,secrets,readFile,exclusive,privateDir,stopped=()=>false}){
  Object.assign(this,{root,secrets,readFile,exclusive,privateDir,stopped});this.state='locked';this.locks=new Map();
 }
 async ready(){
  if(this.stopped())throw Error('mail_cancelled');
  if(this.key)return;
  if(this.readyTask)return this.readyTask;
  this.readyTask=(async()=>{
   try{
    if(!this.secrets)throw Error();
    const root=this.root();await this.privateDir(root);
    let hex=await this.secrets.get(RAW_KEY_NAME);
    if(!hex){
     // Never create a replacement key for existing encrypted data.
     for(const name of await readdir(root)){
      if(name==='.encryption.json')throw Error('mail_encryption_key_lost');
      if(/^(?:[a-f0-9]{64}|\.[a-f0-9]{64}\.pending)$/.test(name)){
       const folder=path.join(root,name);if((await lstat(folder)).isSymbolicLink())throw Error();
       if((await readdir(folder)).some(file=>file.endsWith('.enc')))throw Error('mail_encryption_key_lost');
      }
     }
     hex=randomBytes(32).toString('hex');await this.secrets.set(RAW_KEY_NAME,hex);
     if(await this.secrets.get(RAW_KEY_NAME)!==hex)throw Error();
    }
    if(!/^[a-f0-9]{64}$/.test(hex)||this.stopped())throw Error();
    await this.exclusive(path.join(root,'.encryption.json'),'{"version":1,"algorithm":"AES-256-GCM"}');
    this.key=Buffer.from(hex,'hex');this.state='on';
   }catch(error){this.state='unavailable';throw Error(error.message==='mail_encryption_key_lost'?error.message:'mail_encryption_unavailable');}
  })();
  try{await this.readyTask;}finally{this.readyTask=null;}
 }
 async serial(file,fn){
  const previous=this.locks.get(file)||Promise.resolve(),task=previous.catch(()=>{}).then(fn);this.locks.set(file,task);
  try{return await task;}finally{if(this.locks.get(file)===task)this.locks.delete(file);}
 }
 async check(file){
  if(this.stopped())throw Error('mail_cancelled');
  const root=this.root(),directory=path.dirname(file),relative=path.relative(root,directory);
  if(!/^(?:[a-f0-9]{64}|\.[a-f0-9]{64}\.pending)$/.test(relative)||!payload(path.basename(file)))throw Error('mail_source_changed');
  for(const folder of [root,directory]){const info=await lstat(folder);if(info.isSymbolicLink()||!info.isDirectory())throw Error('mail_source_changed');}
 }
 async optional(file){try{const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw Error('mail_source_changed');return await this.readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
 async persist(file,bytes){
  const target=file+'.enc',temporary=target+'.tmp';
  // All access to this logical file is serialized. A leftover temp is encrypted.
  await rm(temporary,{force:true});
  try{
   await this.exclusive(temporary,encryptRaw(this.key,bytes,context(file)));
   if(!decryptRaw(this.key,await this.readFile(temporary),context(file)).equals(bytes))throw Error('mail_encryption_integrity');
   if(this.stopped())throw Error('mail_cancelled');
   await rename(temporary,target);
   if(!decryptRaw(this.key,await this.readFile(target),context(file)).equals(bytes))throw Error('mail_encryption_integrity');
  }finally{await rm(temporary,{force:true}).catch(()=>{});}
 }
 async access(file,{bytes,expectedHash}={}){
  await this.ready();
  return this.serial(file,async()=>{
   await this.check(file);
   const encrypted=await this.optional(file+'.enc'),legacy=await this.optional(file);
   const value=encrypted?decryptRaw(this.key,encrypted,context(file)):legacy??bytes;
   if(value==null)throw Object.assign(Error('mail_missing'),{code:'ENOENT'});
   if(expectedHash&&hash(value)!==expectedHash||bytes&&!value.equals(bytes)||legacy&&!value.equals(legacy))throw Error('mail_source_changed');
   if(!encrypted)await this.persist(file,value);
   // Recheck legacy immediately before deletion. A failed conversion never removes it.
   if(legacy){if(!legacy.equals(await this.readFile(file)))throw Error('mail_source_changed');await rm(file);}
   return value;
  });
 }
 read(file,encoding){return this.access(file).then(bytes=>encoding?bytes.toString(encoding):bytes);}
 write(file,bytes){return this.access(file,{bytes:Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes)});}
 async storedPath(file){
  await this.ready();await this.check(file);
  try{const info=await lstat(file+'.enc');if(info.isSymbolicLink()||!info.isFile())throw Error('mail_source_changed');}
  catch(error){if(error.code!=='ENOENT')throw error;await this.access(file);}
  return file+'.enc';
 }
 async migrate(rows,{getRow}={}){
  await this.ready();this.progress={state:'running',completed:0};
  try{
   if(this.stopped())throw Error('mail_cancelled');
   let indexed;
   for await(const entry of await opendir(this.root())){
    const name=entry.name;
    if(!/^(?:[a-f0-9]{64}|\.[a-f0-9]{64}\.pending)$/.test(name))continue;
    if(this.stopped())throw Error('mail_cancelled');
    const directory=path.join(this.root(),name);if((await lstat(directory)).isSymbolicLink())throw Error('mail_source_changed');
    const names=await readdir(directory),plain=names.filter(payload);if(!plain.length)continue;
    const row=getRow?getRow(sourceId(directory)):(indexed ||= new Map(rows().map(row=>[row.id,row]))).get(sourceId(directory));let manifest;
    try{manifest=JSON.parse(await this.access(path.join(directory,'manifest.json'),{expectedHash:row?.manifestHash}));}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const filename of plain){
     const expectedHash=filename==='manifest.json'?row?.manifestHash:['message.eml','uia.json'].includes(filename)?row?.sourceHash||manifest?.sourceHash:manifest?.mail?.attachments?.find(item=>filename===item.id+'.bin')?.sha256;
     await this.access(path.join(directory,filename),{expectedHash});this.progress.completed++;
    }
   }
   this.progress.state='completed';
  }catch(error){this.progress.state='failed';this.progress.error=error.code==='ENOSPC'?'mail_storage_full':['EACCES','EPERM','EROFS'].includes(error.code)?'mail_storage_permission':/^mail_[a-z_]+$/.test(error.message)?error.message:'mail_encryption_migration';throw error;}
 }
 async dispose(){await this.readyTask?.catch(()=>{});await Promise.allSettled([...this.locks.values()]);this.key?.fill(0);this.key=null;}
}
