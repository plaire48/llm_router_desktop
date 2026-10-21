// Reuse the exact accepted M6 corpus. No user mail, model calls or source edits.
import {createReadStream} from 'node:fs';import {mkdir,readFile,writeFile} from 'node:fs/promises';import {createInterface} from 'node:readline';import {createHash} from 'node:crypto';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {Store} from '../../runtime/store.mjs';import {MailListService} from '../../runtime/mail-list-service.mjs';import {mailListMetadata} from '../../runtime/mail-list-metadata.mjs';
const [baseline,output]=process.argv.slice(2);if(!baseline||!output)throw Error('usage: accepted-M6-directory new-output-directory');
const corpus=JSON.parse(await readFile(path.join(baseline,'corpus/manifest.json'),'utf8'));if(corpus.scope!=='synthetic_mail_dto_not_mime_or_attachment_bytes')throw Error('synthetic_corpus_required');await mkdir(output);
const report={scope:'same_M6_corpus_metadata_ingest_then_list_SQL_LIKE_not_FTS_or_rendered_UI',corpus,rows:0,queries:[],samples:[],environment:{node:process.version,platform:process.platform,loadavg:os.loadavg()},limits:{listMs:1000,rssMiB:300,searchP95Ms:1000},sourceHashes:{}};
for(const name of ['store','mail-list-index','mail-list-worker','mail-list-client','mail-list-service','mail-list-metadata','mail-search-options','mail-search-budget','mail-search','mail'])report.sourceHashes[name]=createHash('sha256').update(await readFile(new URL('../../runtime/'+name+'.mjs',import.meta.url))).digest('hex');
let store=new Store(path.join(output,'store'),{mailList:true}),list;
try{
 const started=performance.now(),hash=createHash('sha256');
 for await(const line of createInterface({input:createReadStream(path.join(baseline,'corpus/mail.jsonl')),crlfDelay:Infinity})){
  hash.update(line+'\n');const {row,mail}=JSON.parse(line);
  store.set('mail:'+row.id,{...row,subject:mail.subject,from:mail.from,listMetadata:{sourceHash:row.sourceHash,...mailListMetadata(mail)}});
  if(++report.rows%25000===0)console.log(JSON.stringify({stage:'ingest',rows:report.rows,ms:performance.now()-started}));
 }
 report.ingestMs=performance.now()-started;report.corpusSha256=hash.digest('hex');assert.equal(report.corpusSha256,corpus.sha256);assert.equal(report.rows,corpus.count);
 assert.equal(store.db.prepare("SELECT count(*) n FROM records WHERE key GLOB 'mail-index:*'").get().n,0);
 store.close();store=new Store(path.join(output,'store'),{mailList:true});
 list=new MailListService({store,rows(){throw Error('full_collection_forbidden');},read(){throw Error('body_read_forbidden');}});
 let cursor;
 for(let i=0;i<4;i++){const at=performance.now(),packet=await list.search({cursor});report.samples.push({ms:performance.now()-at,total:packet.total,returned:packet.results.length,cursorKind:packet.nextCursor?JSON.parse(Buffer.from(packet.nextCursor,'base64url')).kind:null});assert.equal(packet.total,corpus.count);assert.equal(packet.results.length,50);cursor=packet.nextCursor;}
 const queries=['합성','Synthetic change','person001@example.invalid','thread000001','not_in_synthetic_corpus','detail000001seed21','100%_'];
 for(let i=0;i<35;i++){const query=queries[i%queries.length],at=performance.now(),packet=await list.search({query});report.queries.push({query,total:packet.total,ms:performance.now()-at,mode:packet.searchMode,loadavg:os.loadavg()});assert.equal(packet.searchNotice,'본문 검색은 준비 중');if(i%queries.length>=4)assert.equal(packet.total,0);}
 const durations=report.queries.map(x=>x.ms).sort((a,b)=>a-b);report.searchP95Ms=durations[Math.ceil(durations.length*.95)-1];report.firstPageMs=report.samples[0].ms;
 report.rssBytes=process.memoryUsage().rss;report.peakRssBytes=process.resourceUsage().maxRSS*1024;
 report.accepted=report.firstPageMs<=1000&&report.searchP95Ms<=1000&&report.peakRssBytes<=300*1024*1024;
 report.status='completed';if(!report.accepted)process.exitCode=1;
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
finally{await list?.dispose();store?.close();await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,queries:report.queries.length,sourceHashes:undefined,corpus:undefined}));}
