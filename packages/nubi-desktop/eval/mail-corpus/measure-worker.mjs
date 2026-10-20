import {createReadStream} from 'node:fs';
import {readFile, writeFile, rename, readdir, stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Store} from '../../runtime/store.mjs';
import {MailSearch} from '../../runtime/mail-search.mjs';

const [directory,stage]=process.argv.slice(2), output=path.join(directory,`${stage}.json`);
const started=performance.now(), report={stage,status:'running',scope:'production_Store_and_MailSearch_with_synthetic_cached_DTOs',
  modelCalls:0,rows:0,queries:[],startedAt:new Date().toISOString()};
const checkpoint=async()=>{report.elapsedMs=performance.now()-started;report.peakRssBytes=process.resourceUsage().maxRSS*1024;
  await writeFile(output+'.tmp',JSON.stringify(report,null,2)+'\n');await rename(output+'.tmp',output);};
let store;
try{
  await checkpoint();
  store=new Store(path.join(directory,'store'));
  if(stage==='seed'){
    for await(const line of createInterface({input:createReadStream(path.join(directory,'corpus/mail.jsonl')),crlfDelay:Infinity})){
      const record=JSON.parse(line);
      store.set('mail:'+record.row.id,record.row);
      store.set('mail-index:'+record.row.id,{version:3,signature:record.row.sourceHash,row:record.row,mail:record.mail,knowledge:'',knowledgeChanged:false});
      if(++report.rows%1000===0)await checkpoint();
    }
    report.elapsedMs=performance.now()-started;
    report.dtoRecordsPerSecond=report.rows/(report.elapsedMs/1000);
    // Checkpoint WAL only after the throughput interval, preserving product Store.set semantics.
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    report.databaseBytes=0;
    for(const name of await readdir(path.join(directory,'store')))report.databaseBytes+=(await stat(path.join(directory,'store',name))).size;
  }else{
    const expected=JSON.parse(await readFile(path.join(directory,'corpus/manifest.json'),'utf8')).count;
    const search=new MailSearch({store,rows:()=>store.list('mail:'),searchSignature:async row=>row.sourceHash,
      read:async()=>{throw Error('baseline_expected_cached_dto');},readKnowledge:async()=>({text:''})});
    if(stage==='rows'){
      const at=performance.now(),rows=store.list('mail:');
      report.rows=rows.length;report.rowsMs=performance.now()-at;
      report.rowCountCorrect=rows.length===expected;
    }else if(stage==='list'){
      const at=performance.now(),result=await search.search({limit:30});
      report.listApiMs=performance.now()-at;report.rows=result.collected;
      report.rowCountCorrect=result.total===expected&&result.results.length===Math.min(30,expected);
      report.unavailable=result.unavailable.length;
    }else if(stage==='search'){
      const questions=JSON.parse(await readFile(path.join(directory,'corpus/questions.json'),'utf8'));
      report.plannedQueries=questions.length;
      for(const q of questions){
        const at=performance.now(),result=await search.search({query:q.query,limit:5});
        const ids=result.results.map(row=>row.id),matched=ids.filter(id=>q.expectedIds.includes(id));
        const verified=result.results.filter(row=>store.get('mail:'+row.id)?.sourceHash===row.sourceHash).length;
        report.queries.push({id:q.id,kind:q.kind,ms:performance.now()-at,expected:q.expectedIds.length,
          ids,matched:matched.length,recall:q.expectedIds.length?matched.length/q.expectedIds.length:null,
          absentCorrect:q.expectedIds.length?null:ids.length===0,verifiedSourceHashes:verified,unavailable:result.unavailable.length});
        report.rows=result.collected;await checkpoint();
      }
    }else throw Error('baseline_stage_unknown');
  }
  report.status='completed';
}catch(error){report.status='failed';report.error=String(error.message).slice(0,300);process.exitCode=1;}
finally{store?.close();await checkpoint();}
