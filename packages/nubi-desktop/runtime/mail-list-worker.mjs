import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {MailListIndex} from './mail-list-index.mjs';
const db=new DatabaseSync(workerData.database);
db.exec('PRAGMA busy_timeout=5000; PRAGMA cache_size=-32768; PRAGMA temp_store=FILE');
const index=new MailListIndex(db);
// Serialized messages and bounded batches leave the service event loop free.
let queue=Promise.resolve(),statsCache;
parentPort.on('message',message=>{
 queue=queue.then(async()=>{
  try{
   let snapshot;
   do{
    while(index.syncBatch())await new Promise(resolve=>setImmediate(resolve));
    index.ensureIndexes();
    // Ingestion can race synchronization. Read count, hashes and revision from
    // one clean WAL snapshot, while allowing the source writer to continue.
    snapshot=index.readSnapshot(()=>{
     const revision=db.prepare('SELECT revision FROM nubi_mail_list_meta WHERE id=1').get().revision,statsKey=JSON.stringify([revision,message.args]);
     const result=message.action==='stats'&&statsCache?.key===statsKey?statsCache.result:message.action==='searchBudget'?index.searchBudget(message.args):message.action==='page'?index.page(message.args):message.action==='thread'?index.thread(message.args.id,message.args):message.action==='stats'?index.stats(message.args):message.action==='facets'?index.facets():null;
     if(result===null)throw Error('mail_input_invalid');return {result,statsKey};
    });
   }while(snapshot.retry);
   const {result,statsKey}=snapshot.value;
   if(message.action==='stats')statsCache={key:statsKey,result};
   parentPort.postMessage({id:message.id,result});
  }catch(error){parentPort.postMessage({id:message.id,error:error.message});}
 });
});
