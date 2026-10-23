import {lstat,readdir,realpath,rm} from 'node:fs/promises';
import path from 'node:path';

async function ownedEntries(root){
 try{
  if((await lstat(root)).isSymbolicLink()||await realpath(root)!==path.resolve(root))throw Error('mail_file_conflict');
  return await readdir(root);
 }catch(error){if(error.code==='ENOENT')return [];throw error;}
}
// Reset is local only. The portal account and imported source folders are never deleted.
// A persistent marker keeps interrupted/partial cleanup paused until the user retries it.
export async function resetMail(mail,{confirmed=false}={}){
 if(confirmed!==true)throw Error('mail_reset_confirmation');
 if(mail.resetting||mail.relocating)throw Error('mail_busy');
 mail.resetting=true;mail.store.set('setting:reset-pending',true);
 mail.resetProgress={stage:'stopping',completed:0,total:null,startedAt:new Date().toISOString()};
 mail.desktopSource?.disconnect();mail.disconnect();mail.importController?.abort();for(const controller of mail.documentReaders||[])controller.abort();
 try{
  const start=Date.now();
  while(mail.activeCalls||mail.checking||mail.synthesis||mail.attachmentRead||mail.reconciling||mail.importController||mail.documentReaders?.size){
   if(Date.now()-start>30000)throw Error('mail_reset_wait');
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  await mail.searchIndex?.dispose();mail.searchIndex=null;await mail.listing?.dispose();mail.listing=null;
  await mail.rawMigration;await mail.wikiReady;
  const raw=(await ownedEntries(mail.rawRoot)).filter(name=>/^(?:[a-f0-9]{64}|\.[a-f0-9]{64}\.pending)$/.test(name));
  await ownedEntries(mail.wikiStoreRoot);
  await ownedEntries(mail.wikiVault.sessionRoot);
  // Stop the watcher and drain pending encryption before deleting either representation.
  mail.wikiVault.disposed=true;clearTimeout(mail.wikiVault.debounce);clearInterval(mail.wikiVault.timer);mail.wikiVault.watcher?.close();mail.wikiVault.watcher=null;
  mail.wikiVault.pending.clear();await mail.wikiVault.syncing;
  // Re-scan after the last queued encryption write.
  const stored=(await ownedEntries(mail.wikiStoreRoot)).filter(name=>/^[^/\\]+\.md(?:\.enc(?:\.[a-f0-9]+\.tmp)?)?$/.test(name));
  const targets=[...raw.map(name=>path.join(mail.rawRoot,name)),...stored.map(name=>path.join(mail.wikiStoreRoot,name)),mail.wikiVault.sessionRoot];
  Object.assign(mail.resetProgress,{stage:'deleting',total:targets.length});
  for(const target of targets){await rm(target,{recursive:true,force:true});mail.resetProgress.completed++;}
  // Delete collection IDs, source metadata, facts and search annotations together; retain user settings.
  mail.store.db.exec('BEGIN IMMEDIATE');
  try{
   for(const {key} of mail.store.entries(''))if(!key.startsWith('setting:')||['setting:local-import','setting:check-window','setting:reset-pending'].includes(key))mail.store.delete(key);
   if(mail.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mail_list'").get())mail.store.db.exec('DELETE FROM mail_list; DELETE FROM nubi_mail_list_dirty');
   mail.store.db.exec('COMMIT');
  }catch(error){mail.store.db.exec('ROLLBACK');throw error;}
  mail.account=null;mail.baselineCount=0;mail.lastCheckedAt=null;mail.nextCheckAt=null;mail.error=null;mail.importProgress=null;
  mail.contentCache.clear();mail.searchIndex=null;mail.rawMigration=null;mail.wikiReady=null;mail.wikiRoot=mail.wikiStoreRoot;mail.wikiVault.disposed=false;
  Object.assign(mail.resetProgress,{stage:'complete'});
  return {reset:true};
 }catch(error){mail.error='mail_reset_failed';mail.resetProgress.stage='failed';throw Error(error.message==='mail_reset_wait'?'mail_reset_wait':'mail_reset_failed');}
 finally{mail.resetting=false;}
}
