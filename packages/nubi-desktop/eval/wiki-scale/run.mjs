// Read-only source baseline. Repository code is never installed or executed.
// node eval/wiki-scale/run.mjs SOURCE_METADATA_JSON NEW_OUTPUT_DIRECTORY
import {readFile,writeFile,mkdir,open,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {wikiSourceInventory} from '../../runtime/wiki-source-inventory.mjs';
import {codeMap} from '../../runtime/code-map.mjs';
import {folderPlan,folderPlanningContext} from '../../runtime/wiki-folder-plan.mjs';
import {summarizeBaseline} from './metrics.mjs';
import {PUBLIC_REPOSITORIES} from './sources.mjs';

const [sourceFile,outputDirectory]=process.argv.slice(2);
if(!sourceFile||!outputDirectory)throw Error('Usage: run.mjs SOURCE_METADATA_JSON NEW_OUTPUT_DIRECTORY');
const source=JSON.parse(await readFile(sourceFile,'utf8'));
const approved=PUBLIC_REPOSITORIES;
if(!approved.some(r=>r.repository===source.repository&&r.commit===source.commit&&JSON.stringify(r.subtrees)===JSON.stringify(source.subtrees)))
  throw Error('baseline_source_not_pinned');
const out=path.resolve(outputDirectory),root=path.resolve(source.root),packageRoot=fileURLToPath(new URL('../../',import.meta.url));
if(out===root||out.startsWith(root+path.sep))throw Error('baseline_output_must_be_outside_source');
await mkdir(out,{recursive:true});const lock=await open(path.join(out,'RUN'),'wx');await lock.close();
const report={version:1,scope:'public_source_archive_deterministic_baseline_with_existing_C1',
  source,startedAt:new Date().toISOString(),environment:{platform:process.platform,node:process.version,cpus:os.cpus().length,loadavg:os.loadavg()},
  sourceHashes:{},stages:[],status:'running'};
for(const rel of ['runtime/code-map.mjs','runtime/wiki-folder-plan.mjs','runtime/wiki-source-inventory.mjs','runtime/files.mjs',
  'generated/openwiki.mjs','eval/wiki-scale/run.mjs','eval/wiki-scale/metrics.mjs','eval/wiki-scale/sources.mjs']){
  report.sourceHashes[rel]=createHash('sha256').update(await readFile(path.join(packageRoot,rel))).digest('hex');
}
const save=async()=>{report.peakRssBytes=process.resourceUsage().maxRSS*1024;
  await writeFile(path.join(out,'report.tmp'),JSON.stringify(report,null,2)+'\n');await rename(path.join(out,'report.tmp'),path.join(out,'report.json'));};
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('baseline_six_minute_budget')),360000);
await save();
try{
  let at=performance.now();
  const inventory=await wikiSourceInventory(root,{signal:controller.signal});
  report.stages.push({stage:'inventory',ms:performance.now()-at,files:inventory.paths.length,truncated:inventory.truncated,
    unavailableFiles:inventory.unavailableFiles,excluded:inventory.excluded});await save();
  at=performance.now();
  const map=await codeMap(root,inventory.paths,{signal:controller.signal});
  const mapMs=performance.now()-at;
  report.summary=summarizeBaseline({inventory,map,mapMs,peakRssBytes:process.resourceUsage().maxRSS*1024});
  report.stages.push({stage:'code_map',ms:mapMs,...report.summary.map});await save();
  await writeFile(path.join(out,'map-files.json'),JSON.stringify(map.files)+'\n');
  await writeFile(path.join(out,'ranking.json'),JSON.stringify(map.ranking)+'\n');
  at=performance.now();
  const plan=await folderPlan(root,inventory.paths,{signal:controller.signal,excluded:inventory.excluded});
  const context=folderPlanningContext(plan);
  report.stages.push({stage:'folder_plan_including_product_map_path',ms:performance.now()-at,folders:plan.folders.length,
    representatives:plan.representatives.length,contextBytes:Buffer.byteLength(context),
    codeMapSkipped:plan.codeMap?.skipped||null,recency:'unavailable_without_git_history'});
  await writeFile(path.join(out,'folder-plan.json'),JSON.stringify(plan,null,2)+'\n');
  report.status='completed';
}catch(error){report.status='failed';report.error=String(error.message).slice(0,300);process.exitCode=1;}
finally{
  clearTimeout(timer);report.finishedAt=new Date().toISOString();
  if(report.summary){
    report.summary.peakRssBytes=process.resourceUsage().maxRSS*1024;
    report.summary.deterministicTargets.rssUnderOneGiB=report.summary.peakRssBytes<=1024**3;
  }
  await save();console.log(JSON.stringify({status:report.status,report:path.join(out,'report.json'),stages:report.stages,peakRssBytes:report.peakRssBytes}));
}
