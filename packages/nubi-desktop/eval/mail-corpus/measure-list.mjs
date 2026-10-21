// M1 comparison runs on a copy. Never modify the accepted M6 database/results.
import {createHash} from 'node:crypto';
import {readFile,copyFile,mkdir,writeFile,stat,constants} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Store} from '../../runtime/store.mjs';import {MailSearch} from '../../runtime/mail-search.mjs';
const [source,output]=process.argv.slice(2);if(!source||!output)throw Error('usage: source-store-directory output-directory');
await mkdir(output); // Refuse reuse: previous measurements and databases are evidence.
await mkdir(path.join(output,'store'));
try{if((await stat(path.join(source,'workspace.db-wal'))).size)throw Error('baseline_wal_not_checkpointed');}catch(e){if(e.code!=='ENOENT')throw e;}
await copyFile(path.join(source,'workspace.db'),path.join(output,'store/workspace.db'),constants.COPYFILE_FICLONE);
const store=new Store(path.join(output,'store')),search=new MailSearch({store,rows(){throw Error('full_collection_forbidden');}});
const sources={};for(const name of ['mail-list-index','mail-list-worker','mail-list-client','mail-search'])sources[name]=createHash('sha256').update(await readFile(new URL('../../runtime/'+name+'.mjs',import.meta.url))).digest('hex');
const report={sources,scope:'synthetic_cached_DTOs_list_API_not_live_UI_or_FTS',samples:[],loadavg:os.loadavg(),node:process.version};
try{
 for(const page of [1,1,7500,15000,1]){const at=performance.now(),result=await search.search({limit:20,page});report.samples.push({page,ms:performance.now()-at,total:result.total,returned:result.results.length,first:result.results[0]?.id,rssBytes:process.memoryUsage().rss});}
 report.peakRssBytes=process.resourceUsage().maxRSS*1024;
 const at=performance.now(),card=await search.threadCard(report.samples[0].first);report.thread={ms:performance.now()-at,count:card.count,returned:card.items.length};
 const statsAt=performance.now();await search.disk.request('stats',{attachmentReading:true});report.statusQueryMs=performance.now()-statsAt;
 const facetsAt=performance.now();const facets=await search.facets();report.facets={ms:performance.now()-facetsAt,senders:facets.senders.length};
 await search.dispose();const reopened=new MailSearch({store});try{const at=performance.now();await reopened.search({limit:20});report.reopenMs=performance.now()-at;}finally{await reopened.dispose();}
 report.peakRssBytes=process.resourceUsage().maxRSS*1024;report.status='completed';
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
finally{await search.dispose();store.close();await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
