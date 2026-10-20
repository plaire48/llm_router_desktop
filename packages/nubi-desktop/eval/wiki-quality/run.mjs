// Wiki quality scorecard on a real folder (design 2026-10-21 "위키 규모와 품질" C7, user
// direction 2026-10-21 "위키도 만들고 잘 활용할 수 있어야 해, 품질 수준 체크"). The product
// path prepares the Wiki (initializeWiki) with the model the user is logged in to;
// then code measures generation (pages, Claims, coverage, lint) and use (retrieval
// grounding for the most important files). Public repositories only; no company data.
//
// Usage: node eval/wiki-quality/run.mjs --root <repo> --out <dir> [--model claude-sonnet-5-5] [--probes 10] [--skip-init] [--timeout-min 40]
import {mkdir,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function lintPages(pages){
 // pages: {rel: text}. Navigation-only checks; no model.
 const names=new Set(Object.keys(pages));const rows=[];
 for(const [rel,text] of Object.entries(pages)){
  const lines=text.split('\n');const headings=lines.map((line,i)=>({line:i,level:(/^(#{1,6})\s/.exec(line)||[])[1]?.length||0})).filter(h=>h.level);
  let emptySections=0;for(let i=0;i<headings.length;i++){const start=headings[i].line+1,end=i+1<headings.length?headings[i+1].line:lines.length;if(!lines.slice(start,end).some(line=>line.trim()))emptySections++;}
  const links=[...text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)].map(m=>m[1]);
  const broken=links.filter(link=>{const target=path.posix.normalize(path.posix.join(path.posix.dirname(rel),link));return !names.has(target)&&!names.has(link);});
  const words=text.replace(/\s+/g,' ').trim().length;
  rows.push({page:rel,chars:words,headings:headings.length,emptySections,links:links.length,brokenLinks:broken.length,thin:words<300});
 }
 return {pages:rows.length,emptySections:rows.reduce((n,r)=>n+r.emptySections,0),brokenLinks:rows.reduce((n,r)=>n+r.brokenLinks,0),thinPages:rows.filter(r=>r.thin).length,medianChars:rows.map(r=>r.chars).sort((a,b)=>a-b)[Math.floor(rows.length/2)]??0,rows};
}

const isMain=process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(isMain)await main();
async function main(){
const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
const root=option('root')&&path.resolve(option('root')),out=option('out')&&path.resolve(option('out')),model=option('model')||'claude-sonnet-5-5',probes=Number(option('probes')||10),timeoutMs=Number(option('timeout-min')||40)*60000,skipInit=process.argv.includes('--skip-init');
if(!root||!out){console.error('사용법: node eval/wiki-quality/run.mjs --root <repo> --out <dir> [--model] [--probes N] [--skip-init] [--timeout-min M]');process.exit(2);}
// Eval-only diagnostic (design C10): the adapter appends the newest tool result of every request to out/trace.jsonl.
process.env.NUBI_WIKI_EVAL='1';process.env.NUBI_WIKI_EVAL_TRACE=path.join(out,'trace.jsonl');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
await mkdir(out,{recursive:true});
process.env.OPENWIKI_CONFIG_DIR=path.join(out,'openwiki-home');

const {ProjectService}=await import('../../runtime/project-service.mjs');
const {installAgent}=await import('../../runtime/agent.mjs');
const {readRunMetrics}=await import('../../runtime/run-metrics.mjs');
const {createDesktopProviders}=await import('../../runtime/desktop-providers.mjs');
const {wikiSourceInventory}=await import('../../runtime/wiki-source-inventory.mjs');
const {codeMap}=await import('../../runtime/code-map.mjs');
const {coverageMap}=await import('../../runtime/wiki-coverage.mjs');
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);
async function listWikiPages(){
 const pages={};const dir=path.join(root,'openwiki');
 const walk=async d=>{let entries=[];try{entries=await readdir(d,{withFileTypes:true});}catch{return;}for(const entry of entries){const file=path.join(d,entry.name);if(entry.isDirectory()){if(entry.name!=='.claims')await walk(file);}else if(entry.name.endsWith('.md'))pages[path.relative(dir,file).split(path.sep).join('/')]=await readFile(file,'utf8');}};
 await walk(dir);return pages;
}

const report={root,model,startedAt:new Date().toISOString(),steps:{}};
let service,providers;
try{
 providers=createDesktopProviders({hostLabel:'누비 위키 품질 점검'});
 await providers.connect({provider:'claude'});if(!providers.status().models.some(m=>m.id===model))throw Error('model_unavailable:'+model);await providers.model(model);
 report.connection={provider:providers.status().provider,model:providers.status().model,plan:providers.status().plan||null};
 if(!skipInit)await rm(path.join(root,'openwiki'),{recursive:true,force:true});
 service=new ProjectService({storageRoot:path.join(out,'state')});service.providers=providers;
 const started=Date.now(),stages=[];let last='',job=null;
 await service.open(root);
 if(skipInit){job=service.wikiInitialization();}
 else for(;;){
  job=service.wikiInitialization();
  const key=job?`${job.state}:${job.stage}:${job.percent}:${job.completed}/${job.total}`:'none';
  if(key!==last){stages.push({at:Math.round((Date.now()-started)/1000),state:job?.state,stage:job?.stage,percent:job?.percent,completed:job?.completed,total:job?.total,...(job?.error?{error:job.error}:{}),...(job?.lastModelError?{lastModelError:job.lastModelError}:{})});last=key;console.error(JSON.stringify(stages.at(-1)));}
  if(job&&!['running'].includes(job.state))break;
  if(Date.now()-started>timeoutMs){service.wikiInitialization({action:'cancel'});}
  await pause(2000);
 }
 await service.wikiInitPromise?.catch(()=>{});
 const pages=await listWikiPages();
 let metrics=null;try{const m=readRunMetrics(service.store,{taskId:'wiki-update:'+job?.id,runId:job?.id});metrics=m?.summary?{modelCalls:m.summary.modelCalls,retries:m.summary.retries,promptTokens:m.summary.promptTokens,completionTokens:m.summary.completionTokens,cachedTokens:m.summary.cachedTokens,cacheShare:m.summary.cacheShare,peakRequestCharacters:m.summary.peakRequestCharacters,averageRequestCharacters:m.summary.modelCalls?Math.round(m.summary.requestCharacters/m.summary.modelCalls):null,elapsedMs:m.summary.elapsedMs,submissions:m.summary.submissions}:null;}catch{}
 report.steps.init={state:job?.state,stage:job?.stage,error:job?.error||null,failure:job?.failure||null,elapsedMs:Date.now()-started,pages:Object.keys(pages).length,sourceFiles:job?.sourceFiles??null,excludedFiles:job?.excludedFiles??null,metrics,stages:stages.slice(0,80)};
 report.steps.lint=lintPages(pages);
 // Coverage of important files (host-owned audit, no model).
 try{report.steps.coverage=await service.wikiCoverage({});}catch(error){report.steps.coverage={error:String(error?.message||error).slice(0,160)};}
 // Use: do the most important files (code map) lead to a grounded page through retrieval?
 const inventory=await wikiSourceInventory(root,{});const map=await codeMap(root,inventory.paths);
 const important=map.ranking.filter(r=>!r.entrypoint||true).slice(0,probes).map(r=>r.path);
 let coverage=null;try{coverage=await coverageMap(root,{important,nativeRun:true});}catch(error){report.steps.groundingError=String(error?.message||error).slice(0,160);}
 const probeRows=[];
 for(const file of important){
  const name=path.posix.basename(file).replace(/\.[^.]+$/,'');const query=`${name} 역할과 사용처`;
  const started=performance.now();let result;try{result=await service.wikiQuery({query});}catch(error){probeRows.push({file,query,error:String(error?.message||error).slice(0,120)});continue;}
  const hits=(result?.results||[]).slice(0,5).map(row=>row.path?.replace(/^\/?openwiki\//,'')).filter(Boolean);
  const groundedPages=coverage?.files?.[file]||[];const grounded=hits.some(page=>groundedPages.includes(page));
  probeRows.push({file,query,hits,groundedPages,grounded,ms:Math.round(performance.now()-started)});
 }
 const measured=probeRows.filter(r=>!r.error);
 report.steps.use={probes:probeRows.length,grounded:measured.filter(r=>r.grounded).length,groundedRate:measured.length?measured.filter(r=>r.grounded).length/measured.length:null,anyHit:measured.filter(r=>r.hits.length).length,p95Ms:measured.map(r=>r.ms).sort((a,b)=>a-b)[Math.max(0,Math.ceil(measured.length*.95)-1)]??null,rows:probeRows};
 report.steps.codeMap={files:map.summary.files,ranked:map.summary.ranked,entrypoints:map.entrypoints,top:map.ranking.slice(0,10).map(r=>r.path)};
}catch(error){report.error=String(error?.message||error).slice(0,300);}
finally{
 report.finishedAt=new Date().toISOString();
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 const init=report.steps.init,lint=report.steps.lint,use=report.steps.use,cov=report.steps.coverage;
 console.log(JSON.stringify({error:report.error||null,init:init&&{state:init.state,failure:init.failure?.chain?.map(c=>c.code||c.name).join(' <- ')||null,pages:init.pages,seconds:Math.round(init.elapsedMs/1000),calls:init.metrics?.modelCalls??null,promptTokens:init.metrics?.promptTokens??null,completionTokens:init.metrics?.completionTokens??null},lint:lint&&{emptySections:lint.emptySections,brokenLinks:lint.brokenLinks,thinPages:lint.thinPages,medianChars:lint.medianChars},coverage:cov&&!cov.error?{ratio:cov.coveredRatio??cov.report?.coveredRatio??null,uncovered:(cov.uncovered||cov.report?.uncovered||[]).length}:cov,use:use&&{groundedRate:use.groundedRate,anyHit:use.anyHit,probes:use.probes}}));
 try{service?.dispose();service?.store?.close();}catch{}
 providers?.dispose();
}

}
