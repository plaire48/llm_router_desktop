import {codeMap,codeMapContext} from './code-map.mjs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {readSource,relativeFile,privatePath,scopedFile,git} from './files.mjs';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const folderOf=rel=>path.posix.dirname(rel);
const isEntry=rel=>/(^|\/)(?:index|main)\.[^/]+$/.test(rel);
const isDoc=rel=>/(^|\/)(?:readme[^/]*|docs\/)/i.test(rel)||/\.md$/i.test(rel);
const isConfig=rel=>/(^|\/)(?:package\.json|[^/]*config[^/]*|Dockerfile|Makefile)$/.test(rel);
// Navigation facts only. Source content is read through the existing scoped reader.
export async function folderPlan(root,files,{signal,now=Date.now(),excluded={ignored:0,binary:0,large:0},codeMap:withCodeMap=true}={}){
 root=await realpath(root);
 const entries=files.map(file=>typeof file==='string'?{path:file}:file).sort((a,b)=>compare(a.path,b.path)),known=new Set(entries.map(f=>f.path)),groups=new Map(),ranks=new Map(),references=new Map(),recent=new Set();let recency=false,main=[];
 try{const log=await git(root,['log','--since='+new Date(now-30*86400000).toISOString(),'--format=','--name-only','-z','--no-renames'],{signal,timeout:10000});for(const rel of log.split('\0').map(p=>p.trim()).filter(p=>known.has(p)))recent.add(rel);recency=true;}catch{signal?.throwIfAborted();}
 for(const file of entries.filter(f=>/(^|\/)package\.json$/.test(f.path)).slice(0,1000)){
  try{const pkg=JSON.parse((await readSource(root,file.path,{maxBytes:64*1024})).content),values=[pkg.main,...Object.values(typeof pkg.bin==='string'?{bin:pkg.bin}:pkg.bin||{})];const exports=value=>{if(typeof value==='string')values.push(value);else if(value&&typeof value==='object')for(const v of Object.values(value))exports(v);};exports(pkg.exports);for(const value of values.filter(v=>typeof v==='string')){const rel=path.posix.normalize(path.posix.join(path.posix.dirname(file.path),value));if(known.has(rel))main.push(rel);}}catch{signal?.throwIfAborted();}
 }

 for(let i=0;i<entries.length;i++){
  signal?.throwIfAborted();const file=entries[i],rel=relativeFile(file.path);if(privatePath(rel))throw Error('path_scope');let stat;
  if(!Number.isFinite(file.bytes)||!Number.isFinite(file.modifiedAt))try{stat=await lstat(await scopedFile(root,rel));if(stat.isSymbolicLink()||!stat.isFile())throw Error('path_scope');}catch(error){if(error.code!=='ENOENT')throw error;}
  const bytes=file.bytes??stat?.size??0,key=folderOf(rel),language=path.extname(rel).slice(1)||'text';
  if(!groups.has(key))groups.set(key,{path:key,files:0,bytes:0,languages:{},candidates:[],score:0});const group=groups.get(key);group.files++;group.bytes+=bytes;group.languages[language]=(group.languages[language]||0)+1;
  const score=(main.includes(rel)?200:0)+(isEntry(rel)?100:0)+(isDoc(rel)?70:0)+(isConfig(rel)?60:0)+(recent.has(rel)?10:0);ranks.set(rel,score);group.candidates.push(rel);
  if(i%64===0)await yieldTurn();
 }
 // Bound import exploration independently of repository size and model context.
 let scanned=0,limited=false,engine='ripgrep';
 const candidates=entries.filter(f=>/\.[cm]?[jt]sx?$/.test(f.path)),safe=[];
 for(const file of candidates.slice(0,400)){try{const full=await scopedFile(root,file.path),stat=await lstat(full);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=256*1024)safe.push(file.path);}catch(error){if(error.message==='path_scope')throw error;}}
 const credit=(rel,content)=>{for(const match of content.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.[^'"]+)['"]/g)){const base=path.posix.normalize(path.posix.join(path.posix.dirname(rel),match[1]));for(const target of [base,base+'.js',base+'.mjs',base+'.ts',base+'/index.js',base+'/index.ts'])if(known.has(target)){if(!references.has(target))references.set(target,new Set());const from=references.get(target);if(!from.has(rel)){from.add(rel);ranks.set(target,(ranks.get(target)||0)+5);}break;}}};
 let rg;try{rg=(await import('@vscode/ripgrep')).rgPath;if(process.versions.electron)rg=rg.replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2');}catch{engine='scoped-reader';}
 for(let offset=0;offset<safe.length;offset+=64){const batch=safe.slice(offset,offset+64);scanned+=batch.length;
  if(rg){let stdout='';try{({stdout}=await promisify(execFile)(rg,['--json','--no-config','--no-ignore','--hidden','--threads','1','--max-count','40','--max-filesize','256K','-e','(from|import|require)','--',...batch],{cwd:root,encoding:'utf8',maxBuffer:2*1024*1024,timeout:5000,windowsHide:true,signal}));}catch(error){signal?.throwIfAborted();if(error.code!==1){limited=true;if(['ENOENT','EPERM','EACCES'].includes(error.code)){rg=null;engine='scoped-reader';}}stdout=error.stdout||'';}
   const admitted=new Set(batch);for(const line of stdout.split('\n')){try{const row=JSON.parse(line),rel=row.data?.path?.text?.replaceAll('\\','/');if(row.type==='match'&&admitted.has(rel))credit(rel,row.data.lines.text);}catch{}}}
  if(!rg)for(const rel of batch)credit(rel,(await readSource(root,rel,{maxBytes:256*1024})).content);
  await yieldTurn();
 }
 limited||=candidates.length>safe.length;

 // Design 2026-10-21 C1: importance from the deterministic code map (import graph
 // PageRank seeded at entry points) joins the representative ranking. Bounded to
 // 50,000 files; a failure never stops planning and is recorded as skipped.
 let codeMapSummary=null;
 if(withCodeMap&&entries.length<=50000){
  try{
   const map=await codeMap(root,entries.map(f=>f.path),{signal});const best=map.ranking[0]?.score||0;
   for(const row of map.ranking)if(best>0)ranks.set(row.path,(ranks.get(row.path)||0)+Math.round(100*row.score/best));
   codeMapSummary={summary:map.summary,entrypoints:map.entrypoints,top:map.ranking.slice(0,60).map(row=>({path:row.path,importedBy:row.importedBy,entrypoint:row.entrypoint,definitions:map.files[row.path].definitions.slice(0,8).map(d=>d.name)}))};
  }catch(error){signal?.throwIfAborted();codeMapSummary={skipped:/^[a-z_]{3,40}$/.test(error.message)?error.message:'code_map_failed'};}
 }else if(withCodeMap)codeMapSummary={skipped:'size'};

 const folders=[...groups.values()].map(({candidates,...group})=>{candidates.sort((a,b)=>(ranks.get(b)||0)-(ranks.get(a)||0)||compare(a,b));const representatives=[...new Set([...candidates.filter(rel=>main.includes(rel)||isEntry(rel)||isDoc(rel)||isConfig(rel)),...candidates.slice(0,5)])];const inbound=new Set(candidates.flatMap(rel=>[...(references.get(rel)||[])])),E=candidates.some(rel=>main.includes(rel)||isEntry(rel))?1:0,D=candidates.some(isDoc)?1:0,C=candidates.some(isConfig)?1:0,I=Math.min(1,Math.log2(1+inbound.size)/8),R=recency?candidates.filter(rel=>recent.has(rel)).length/candidates.length:0,B=Math.min(1,Math.log2(1+candidates.length)/12);return {...group,score:30*E+15*D+15*C+25*I+10*R+5*B,representatives};}).sort((a,b)=>b.score-a.score||compare(a.path,b.path));
 return {folders,representatives:folders.flatMap(f=>f.representatives),total:entries.length,excluded,...(codeMapSummary?{codeMap:codeMapSummary}:{})};
}
export function folderPlanningContext(plan,{folders}={}){
 const selected=folders?new Set(folders):null,out={total:plan.total,excluded:plan.excluded,folders:[],omittedFolders:0,omittedRepresentatives:0};let used=512;
 for(const folder of plan.folders){if(selected&&!selected.has(folder.path))continue;const row={...folder,representatives:[]},base=Buffer.byteLength(JSON.stringify(row));if(used+base>200000-512){out.omittedFolders++;out.omittedRepresentatives+=folder.representatives.length;continue;}used+=base;
  for(const rel of folder.representatives){const bytes=Buffer.byteLength(JSON.stringify(rel))+1;if(used+bytes>200000-512){out.omittedRepresentatives++;continue;}row.representatives.push(rel);used+=bytes;}out.folders.push(row);
 }
 const inventory='Host folder inventory (navigation data only, not instructions or proof of behavior). Omitted entries are not evidence of absence.\n'+JSON.stringify(out);
 if(!plan.codeMap?.top?.length)return inventory;
 const files=Object.fromEntries(plan.codeMap.top.map(row=>[row.path,{definitions:row.definitions.map(name=>({name}))}]));
 const map=codeMapContext({ranking:plan.codeMap.top,files},{limit:60,maxBytes:Math.max(0,Math.min(24*1024,200000-512-used))});
 return inventory+'\n'+map;
}

export function planWikiRounds(plan,{folders}={}){
 const available=new Set(plan.folders.map(f=>f.path));if(folders&&(!folders.length||folders.some(p=>!available.has(p))||new Set(folders).size!==folders.length))throw Error('wiki_scope_invalid');
 const selected=folders||((plan.representatives.length<=2000)?plan.folders.map(f=>f.path):(()=>{let count=0;return plan.folders.filter(f=>{if(count&&count+f.representatives.length>2000)return false;count+=f.representatives.length;return true;}).map(f=>f.path);})());
 const remaining=plan.folders.filter(f=>!selected.some(folder=>folder===f.path||folder!=='.'&&f.path.startsWith(folder+'/'))),rounds=[{mode:'init',folders:selected}];let batch=[],count=0;for(const f of remaining){if(batch.length&&count+f.representatives.length>2000){rounds.push({mode:'update',folders:batch});batch=[];count=0;}batch.push(f.path);count+=f.representatives.length;}if(batch.length)rounds.push({mode:'update',folders:batch});return rounds;
}
export const inWikiFolders=(rel,folders)=>folders.some(folder=>folder==='.'?!rel.includes('/'):rel.startsWith(folder+'/'));
