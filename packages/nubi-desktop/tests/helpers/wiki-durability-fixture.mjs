import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sources=Array.from({length:11},(_,i)=>({path:`synthetic-${String(i).padStart(2,'0')}.txt`,text:`Synthetic source ${i}\nvalue: ${i}\n`,statement:`Synthetic source ${i} defines value ${i}.`}));
const pages=['/openwiki/quickstart.md','/openwiki/details.md'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const body=text=>text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u,'');

// Each attempt owns a fresh process, config directory and project. No signed-in
// provider or user's OpenWiki home is read by this synthetic remote model.
export async function runDurabilityScenario({injection,index=0,seed=0,corruptPage=false}){
 const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-q1-')));
 try{
   const result=path.join(directory,'result.json');
   for(let phase=0;phase<2;phase++){
   const code=await new Promise((resolve,reject)=>{
     const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',JSON.stringify({directory,injection,index,seed,corruptPage,restarting:phase===1})],{env:{...process.env,OPENWIKI_CONFIG_DIR:path.join(directory,'openwiki-home')},stdio:['ignore','ignore','pipe']});
     let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
     const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('measurement_timeout'));},60000);
     child.on('error',error=>{clearTimeout(timeout);reject(error);});
     child.on('exit',code=>{clearTimeout(timeout);code===0||code===75&&phase===0&&injection==='app_restart'?resolve(code):reject(Object.assign(Error('measurement_child_failed'),{diagnostic:stderr}));});
   });
   if(code===0)break;
   }
   return JSON.parse(await readFile(result,'utf8'));
 }finally{await rm(directory,{recursive:true,force:true});}
}

async function executeScenario({directory,injection,restarting,corruptPage}){
 const {ProjectService}=await import('../../runtime/project-service.mjs');
 const {verifyWikiPages}=await import('../../runtime/wiki-run-journal.mjs');
 const root=path.join(directory,'source');if(!restarting){await mkdir(root);for(const source of sources)await writeFile(path.join(root,source.path),source.text);}
 const saved=restarting?JSON.parse(await readFile(path.join(directory,'interruption.json'),'utf8')):{};
 const services=[],pageWrites=saved.pageWrites||{},observedSources=new Set(saved.observedSources||[]);let service,connected=true,connectionId='synthetic-connection-1',injected=saved.injected||0,resumes=restarting?1:0,partialPublications=saved.partialPublications||0,providerCalls=saved.providerCalls||0,modelCalls=saved.modelCalls||0,modelRetries=saved.modelRetries||0,virtualWaitMs=saved.virtualWaitMs||0,now=saved.now||Date.now(),interruption,firstPageText=saved.firstPageText,firstClaims=saved.firstClaims,retainedPage=saved.retainedPage;
 const notices=[];
 const call=(name,args)=>({content:'Synthetic provider proposal.',calls:[{id:'synthetic-'+(++providerCalls),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 const namesOf=tools=>tools.map(tool=>tool.function?.name||tool.name);
 const proposed=wire=>wire.flatMap(message=>message.tool_calls||[]);
 const readSources=wire=>{
   const calls=proposed(wire),results=new Map(wire.filter(message=>message.role==='tool').map(message=>[message.tool_call_id,message.content]));
   for(const source of sources){
     const read=calls.find(c=>c.function.name==='read_file'&&JSON.parse(c.function.arguments).file_path==='/'+source.path);
     if(read&&String(results.get(read.id)).includes('value: '+source.path.match(/\d+/)[0].replace(/^0(\d)$/,'$1')))observedSources.add(source.path);
   }
   const missing=sources.filter(source=>!calls.some(c=>c.function.name==='read_file'&&JSON.parse(c.function.arguments).file_path==='/'+source.path));
   return missing.length?{content:'Read the synthetic corpus.',calls:missing.slice(0,8).map(source=>({id:'synthetic-'+(++providerCalls),type:'function',function:{name:'read_file',arguments:JSON.stringify({file_path:'/'+source.path})}}))}:null;
 };
 const complete=async(wire,tools,signal)=>{
   signal?.throwIfAborted();modelCalls++;const names=namesOf(tools);
   if(names.includes('review_page')){
     const packet=wire.filter(message=>message.role==='user').map(message=>{try{return JSON.parse(message.content);}catch{return null;}}).findLast(value=>value?.claims&&value.sources);
     if(!packet)throw Error('synthetic_review_packet_missing');
     const checks=packet.claims.map(claim=>{
       const source=sources.find(source=>source.statement===claim.statement),resource=claim.evidence?.[0]?.resource;
       if(!source||resource!=='repo://'+source.path||!packet.sources.some(item=>item.resource===resource&&item.text.includes(source.text)))throw Error('synthetic_review_not_grounded');
       return {index:claim.index,verdict:'supported',reason:'The synthetic source states this value.',evidence:[{resource,quote:source.text.trim()}]};
     });
     return call('review_page',{checks,issues:[]});
   }
   if(names.includes('submit_plan')){
     if(proposed(wire).some(c=>c.function.name==='submit_plan'))return {content:'Synthetic plan submitted.',calls:[]};
     const read=readSources(wire);if(read)return read;
     return call('submit_plan',{pages:pages.map((page,i)=>({path:page,title:i?'Synthetic details':'Synthetic quickstart',purpose:'Document the eleven synthetic values.',seedPaths:sources.map(source=>source.path),relatedPages:[pages[1-i]]})),deletePages:[]});
   }
   const assigned=wire.filter(message=>message.role==='system').map(message=>message.content).join('\n').match(/You own exactly (\/openwiki\/[^\s]+\.md)\./)?.[1];
   if(!assigned)throw Error('synthetic_assignment_missing');
   const job=service.store.get('wiki-init'),journal=service.store.get('wiki-durable:'+job.id),completed=Object.entries(journal?.pages||{}).find(([page,value])=>page!==assigned&&value.state==='done');
   if(completed&&(!injected||injection==='rate_limit'&&injected<3)){
     injected++;retainedPage=completed[0];const copy=service.store.get('wiki-init-scope').directory;firstPageText=await readFile(path.join(copy,retainedPage),'utf8');firstClaims=JSON.parse(await readFile(path.join(copy,'openwiki/.claims',path.basename(retainedPage,'.md')+'.json'),'utf8')).claims;
     if(['app_restart','sleep_resume','model_reconnect'].includes(injection)){
       if(injection==='app_restart'){
         await writeFile(path.join(directory,'interruption.json'),JSON.stringify({pageWrites,observedSources:[...observedSources],injected,partialPublications,providerCalls,modelCalls,modelRetries,virtualWaitMs,now,firstPageText,firstClaims,retainedPage}));
         process.exit(75); // Abruptly stop only this owned fixture host; no graceful cancellation.
       }
       if(injection==='sleep_resume')interruption=service.wikiLifecycle({event:'suspend',expectedRoot:root});
       else{connected=false;service.wikiInitController.abort(Error('provider_changed'));}
       signal?.throwIfAborted();throw Error('synthetic_interrupt_signal_missing');
     }
     const failures={network:Error('network_error'),rate_limit:Object.assign(Error('rate_limited'),{status:429,retryAfterMs:1}),server_error:Object.assign(Error('server_error'),{status:503}),timeout:Error('model_timeout'),output_limit:Error('output_limit')};
     if(!failures[injection])throw Error('unknown_synthetic_injection');throw failures[injection];
   }
   const calls=proposed(wire);
   if(calls.some(c=>c.function.name==='submit_page'))return {content:'Synthetic page submitted.',calls:[]};
   const read=readSources(wire);if(read)return read;
   if(!calls.some(c=>c.function.name==='write_file')){
     pageWrites[assigned]=(pageWrites[assigned]||0)+1;
     const content=`# ${assigned===pages[0]?'Synthetic quickstart':'Synthetic details'}\n\n`+sources.map(source=>source.statement).join('\n\n')+`\n\n[${assigned===pages[0]?'Details':'Quickstart'}](${assigned===pages[0]?'details':'quickstart'}.md)\n`;
     return call('write_file',{file_path:assigned,content});
   }
   return call('submit_page',{claims:sources.map(source=>({statement:source.statement,evidence:[{resource:'repo://'+source.path}]}))});
 };
 const open=async()=>{
   const current=new ProjectService({storageRoot:path.join(directory,'state')});services.push(current);
   await current.open(root,{initializeWiki:false});
   current.providers={status:()=>({connected,provider:'synthetic',model:'synthetic-durability',connectionId}),complete,dispose(){}};
   current.wikiInitEnabled=true;current.wikiDurableClock={now:()=>now,sleep:async(ms,signal)=>{signal?.throwIfAborted();now+=ms;virtualWaitMs+=ms;}};
   current.recoveryOptions={model:{retries:0,minTimeout:0,maxTimeout:0,randomize:false}};
   const set=current.store.set.bind(current.store);let previousState=current.store.get('wiki-init')?.state;
   current.store.set=(key,value)=>{if(key==='wiki-init'){if(value?.state==='partial'&&previousState!=='partial')partialPublications++;previousState=value?.state;if(value?.modelRetries)modelRetries=Math.max(modelRetries,value.modelRetries);}return set(key,value);};
   return current;
 };
 try{
   service=await open();await service.initializeWiki();await service.wikiInitPromise;
   await interruption;
   const initial=service.wikiInitialization();notices.push({phase:'after_injection',state:initial.state,error:initial.error});
   if(!restarting&&['sleep_resume','model_reconnect'].includes(injection)&&injected){
     if(injection==='sleep_resume'){resumes++;await service.wikiLifecycle({event:'resume',expectedRoot:root});}
     else{
       connected=true;connectionId='synthetic-connection-2';
       resumes++;await service.initializeWiki();
     }
     await service.wikiInitPromise;
   }
   const job=service.wikiInitialization();let verified=false,error=job.error;
   if(job.state==='completed'){
     try{
       if(corruptPage){const file=path.join(root,pages.find(page=>page!==retainedPage));await writeFile(file,(await readFile(file,'utf8'))+'\nUnsupported synthetic addition.\n');}
       if(job.sourceFiles!==11)throw Error('synthetic_corpus_incomplete');
       for(const source of sources)if(digest(await readFile(path.join(root,source.path)))!==digest(source.text))throw Error('synthetic_source_changed');
       await verifyWikiPages(root,['quickstart.md','details.md']);
       if(observedSources.size!==11)throw Error('synthetic_corpus_not_read');
       for(const page of pages)for(const source of sources)if(!(await readFile(path.join(root,page),'utf8')).includes(source.statement))throw Error('synthetic_page_incomplete');
       if(!injected||!retainedPage)throw Error('synthetic_interruption_not_injected');
       // Native finalization adds source/generated frontmatter. Its original
       // page body and accepted Claims must remain byte-for-byte identical.
       if(body(firstPageText)!==body(await readFile(path.join(root,retainedPage),'utf8')))throw Error('synthetic_completed_page_changed');
       const finalClaims=JSON.parse(await readFile(path.join(root,'openwiki/.claims',path.basename(retainedPage,'.md')+'.json'),'utf8')).claims;
       if(JSON.stringify(firstClaims)!==JSON.stringify(finalClaims))throw Error('synthetic_completed_claims_changed');
       if(pageWrites[retainedPage]!==1)throw Error('synthetic_completed_page_replayed');
       const copy=service.store.get('wiki-init-scope')?.directory;
       if(copy){let retained=false;try{await access(path.join(copy,'openwiki/.run.json'));retained=true;}catch{}if(retained)throw Error('synthetic_run_not_finalized');}
       verified=true;
     }catch(failure){error=failure.message;}
   }
   return {state:job.state,verified,sources:job.sourceFiles,plannedPages:2,verifiedPages:verified?2:0,pages:job.pages,manualRetries:0,resumes,partialPublications,injected,providerCalls:modelCalls,proposedToolCalls:providerCalls,modelRetries,virtualWaitMs,pageWrites,retainedPage,...(error?{error}:{}),notices};
 }finally{for(const current of services.reverse()){current.dispose();if(current.store?.db?.isOpen)current.store.close();}}
}

if(process.argv[2]==='--child'&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=JSON.parse(process.argv[3]);let result;
 try{result=await executeScenario(args);}catch(error){result={state:'failed',verified:false,sources:11,manualRetries:0,resumes:null,partialPublications:null,error:error.message};}
 await writeFile(path.join(args.directory,'result.json'),JSON.stringify(result));
}
