import path from 'node:path';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
const exec=promisify(execFile),desktop='packages/nubi-desktop',hash=b=>createHash('sha256').update(b).digest('hex');
const required=[desktop+'/package.json','.github/workflows/nubi-desktop-gates.yml','.github/workflows/nubi-desktop-windows.yml'];
function sourcePath(value){
 if(typeof value!=='string'||!value||/[\x00-\x1f]/.test(value)||/^(?:[A-Za-z]:|\/)/.test(value))throw Error('release_path_scope');
 const result=path.posix.normalize(path.posix.join(desktop,value.replaceAll('\\','/')));
 if(result==='..'||result.startsWith('../'))throw Error('release_path_scope');return result;
}
const sourceCode=p=>/\.[cm]?[jt]sx?$/.test(p);
const generated=p=>p.startsWith(desktop+'/generated/');
const scanPath=p=>p.startsWith(desktop+'/')&&!/(?:^|\/)(?:node_modules|generated|lib|release|verification|tests)(?:\/|$)/.test(p)&&(sourceCode(p)||p.endsWith('/package.json'));
function packageRoot(file){const match=/^(packages|extensions)\/[^/]+/.exec(file);return match?.[0]||'';}
function references(file,bytes){
 const found=[],dependencies=[],producers=[],owner=packageRoot(file),fileBase=path.posix.dirname(file);
 function add(value,base,{trace=true,module=false,entry=false}={}){
  value=value.replaceAll('\\','/').replace(/^file:/,'');if(!value.startsWith('../')&&!value.startsWith('./')&&!value.startsWith('node_modules/'))return;
  const resolved=path.posix.normalize(path.posix.join(base,value));if(resolved==='..'||resolved.startsWith('../')||resolved.startsWith('/'))return;
  const match=/^packages\/([^/]+)(?:\/|$)/.exec(resolved);if(match&&owner!==`packages/${match[1]}`&&!(sourceCode(resolved)&&resolved===`packages/${match[1]}`)&&!resolved.includes('/node_modules/'))found.push(match[1]);
  if(trace&&(module||entry||path.posix.extname(resolved)))dependencies.push({path:resolved,module,entry});
 }
 if(file.endsWith('/package.json')){const obj=JSON.parse(bytes.toString());for(const values of [obj.dependencies,obj.devDependencies,obj.optionalDependencies])for(const value of Object.values(values||{}))if(typeof value==='string'&&value.startsWith('file:')&&!/\.(?:tgz|tar\.gz)$/.test(value))add(value,fileBase,{trace:false});return {found,dependencies,producers};}
 if(!sourceCode(file))return {found,dependencies,producers};
 const source=ts.createSourceFile(file,bytes.toString(),ts.ScriptTarget.Latest,true),constants=new Map();
 function strings(node){return ts.isStringLiteralLike(node)?node.text:ts.isIdentifier(node)?constants.get(node.text):undefined;}
 function gather(node){if((ts.isVariableDeclaration(node)||ts.isParameter(node))&&node.initializer&&ts.isIdentifier(node.name)&&ts.isStringLiteralLike(node.initializer))constants.set(node.name.text,node.initializer.text);ts.forEachChild(node,gather);}gather(source);
 function visit(node){
  if(ts.isCallExpression(node)&&node.arguments[0]&&ts.isObjectLiteralExpression(node.arguments[0])){
   const props=new Map(node.arguments[0].properties.filter(p=>ts.isPropertyAssignment(p)||ts.isShorthandPropertyAssignment(p)).map(p=>[p.name.getText(source).replaceAll(/['"]/g,''),ts.isPropertyAssignment(p)?p.initializer:p.name]));
   const entry=props.get('entryPoints');if(entry&&ts.isArrayLiteralExpression(entry)){
    const inputs=entry.elements.map(strings).filter(v=>typeof v==='string').map(v=>path.posix.normalize(path.posix.join(desktop,v.replaceAll('\\','/'))));
    for(const p of inputs)add('./'+path.posix.relative(desktop,p),desktop,{module:true,entry:true});
    for(const kind of ['outfile','outdir']){const output=strings(props.get(kind)||{});if(output)producers.push({path:path.posix.normalize(path.posix.join(desktop,output)),directory:kind==='outdir',inputs,file});}
   }
  }
  if(ts.isStringLiteralLike(node)){
   const parent=node.parent,staticModule=(ts.isImportDeclaration(parent)||ts.isExportDeclaration(parent))&&parent.moduleSpecifier===node;
   const call=ts.isCallExpression(parent)&&parent.arguments[0]===node&&(parent.expression.kind===ts.SyntaxKind.ImportKeyword||parent.expression.getText(source)==='require'||ts.isCallExpression(parent.expression)&&parent.expression.expression.getText(source)==='createRequire');
   const url=ts.isNewExpression(parent)&&parent.expression.getText(source)==='URL'&&parent.arguments?.[1]?.getText(source)==='import.meta.url';
   const pathCall=ts.isCallExpression(parent)&&/^(?:path\.)?(?:join|resolve)$/.test(parent.expression.getText(source)),index=pathCall?parent.arguments.indexOf(node):0;
   const dirname=pathCall&&index>0&&parent.arguments[0].getText(source)==='__dirname';
   const cwdPath=pathCall&&index===0,fsPath=ts.isCallExpression(parent)&&parent.arguments[0]===node&&/^(?:fs\.)?(?:copyFile|cp|readFile)$/.test(parent.expression.getText(source));
   if(staticModule||call||url&&path.posix.extname(node.text)||dirname||cwdPath||fsPath)add(node.text,staticModule||call||url||dirname?fileBase:desktop,{module:!!(staticModule||call)});
  }ts.forEachChild(node,visit);
 }visit(source);return {found,dependencies,producers};
}
function resolveReference(reference,present){
 const p=reference.path,choices=[p];
 if(reference.module){if(/\.[cm]?js$/.test(p))choices.push(p.replace(/\.([cm]?)js$/,'.$1ts'),p.replace(/\.js$/,'.tsx'));if(!path.posix.extname(p))choices.push(...['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs','/index.ts','/index.tsx','/index.js','/index.jsx','/index.mjs'].map(s=>p+s));}
 return choices.find(candidate=>present.has(candidate));
}
export async function inspectReleaseInputs({paths,readCandidate,readSource,manifest,modes={},version='1.3.0'}){
 const present=new Set(paths),issues=[],rows=new Map(),siblings=new Map(),referencesQueue=[],visited=new Set(),producers=[],buildOutputs=new Map(),installed=new Map();
 const issue=(code,p)=>issues.push({code,path:p}),regular=p=>!modes[p]||['100644','100755'].includes(modes[p]);
 for(const p of [...required,`docs/HOTFIX-${version}.md`,`docs/INSTALL-AND-UPDATE-${version}.md`])if(!present.has(p))issue('release_required_missing',p);else if(!regular(p))issue('release_entry_mode',p);
 let entries;try {entries=JSON.parse(manifest?.toString());if(!Array.isArray(entries)||!entries.length||entries.some(e=>typeof e!=='string'))throw Error();}catch {issue('release_manifest_invalid','generated/source-inputs.json');return {ok:false,issues,inputs:[],siblings:[]};}
 const sources=[];for(const entry of new Set(entries)){try {const p=sourcePath(entry);if(p.split('/').includes('verification'))issue('release_verification_input',p);else sources.push(p);}catch {issue('release_path_scope',String(entry));}}
 function collect(file,data,followAll=false){const refs=references(file,data);for(const name of refs.found){if(!siblings.has(name))siblings.set(name,new Set());siblings.get(name).add(file);}producers.push(...refs.producers);for(const dep of refs.dependencies)if(followAll||dep.entry||generated(dep.path)||dep.path.includes('/node_modules/')||!dep.path.startsWith(desktop+'/')||!file.startsWith(desktop+'/'))referencesQueue.push(dep);}
 await Promise.all(paths.filter(scanPath).map(async file=>{if(!regular(file)){issue('release_entry_mode',file);return;}try {const data=await readCandidate(file);if(!data)throw Error();collect(file,data);}catch {issue('release_source_unavailable',file);}}));
 async function installedInput(p){
  const [root,tail]=p.split('/node_modules/'),parts=tail.split('/'),name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0],key=root+'|'+name;
  if(installed.has(key))return;installed.set(key,{package:name,root});
  const pkg=root+'/package.json';let obj;try{obj=JSON.parse((await readCandidate(pkg)).toString());}catch{issue('release_dependency_undeclared',p);return;}
  if(![obj.dependencies,obj.devDependencies,obj.optionalDependencies,obj.peerDependencies].some(d=>d&&Object.hasOwn(d,name))){issue('release_dependency_undeclared',p);return;}
  const lock=root+'/package-lock.json';let locked=false;
  if(present.has(lock)){try{const d=JSON.parse((await readCandidate(lock)).toString());locked=!!d.packages?.['node_modules/'+name]||!!d.dependencies?.[name];}catch{}if(locked)await validate(lock);}
  if(!locked){issue('release_dependency_unlocked',p);return;}await validate(pkg);
 }
 async function validate(p,follow=false){
  if(p.includes('/node_modules/'))return installedInput(p);
  if(generated(p)){
   if(buildOutputs.has(p))return;const producer=producers.find(b=>b.path===p||b.directory&&p.startsWith(b.path+'/'));
   if(!producer||!producer.inputs.length){issue('release_producer_missing',p);return;}buildOutputs.set(p,{path:p,inputs:producer.inputs,producer:producer.file});await validate(producer.file);for(const input of producer.inputs)referencesQueue.push({path:input,module:true,entry:true});return;
  }
  if(rows.has(p))return;rows.set(p,null);
  if(!present.has(p)){issue('release_input_missing',p);return;}if(!regular(p)){issue('release_entry_mode',p);return;}
  try {const [candidate,source]=await Promise.all([readCandidate(p),readSource(p)]);if(!candidate||!source){issue('release_source_unavailable',p);return;}const row={path:p,sha256:hash(candidate),sourceSha256:hash(source)};rows.set(p,row);if(row.sha256!==row.sourceSha256)issue('release_input_changed',p);if(follow)collect(p,candidate,true);}catch {issue('release_source_unavailable',p);}
 }
 await Promise.all(sources.map(p=>validate(p,!p.startsWith(desktop+'/'))));
 while(referencesQueue.length){
  const batch=referencesQueue.splice(0);await Promise.all(batch.map(async reference=>{const key=reference.path+'|'+reference.module;if(visited.has(key))return;visited.add(key);if(visited.size>20000){issue('release_reference_limit',reference.path);return;}if(generated(reference.path)||reference.path.includes('/node_modules/'))return validate(reference.path,true);const target=resolveReference(reference,present);if(!target){issue('release_reference_missing',reference.path);return;}await validate(target,true);}));
 }
 for(const name of siblings.keys()){const p=`packages/${name}/package.json`;if(!present.has(p))issue('release_package_missing',p);else if(!regular(p)){issue('release_entry_mode',p);}}
 return {ok:issues.length===0,formatVersion:2,manifestSha256:hash(manifest),compiledInputCount:sources.length,issues:issues.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)),inputs:[...rows.values()].filter(Boolean).sort((a,b)=>a.path.localeCompare(b.path)),buildOutputs:[...buildOutputs.values()].sort((a,b)=>a.path.localeCompare(b.path)),installedDependencies:[...installed.values()].sort((a,b)=>a.root.localeCompare(b.root)||a.package.localeCompare(b.package)),siblings:[...siblings].sort(([a],[b])=>a.localeCompare(b)).map(([name,via])=>({name,via:[...via].sort()}))};
}
async function batchBlobs(repo,oids){
 const data=await new Promise((resolve,reject)=>{
  const child=spawn('git',['-C',repo,'cat-file','--batch'],{stdio:['pipe','pipe','pipe']}),chunks=[];let size=0;
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>128*1024*1024){child.kill();reject(Error('release_blob_limit'));}else chunks.push(chunk);});child.stderr.resume();child.on('error',reject);child.on('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(Error('release_git_read_failed')));child.stdin.on('error',reject);child.stdin.end(oids.join('\n')+'\n');
 });
 const result=[];let offset=0;
 for(const oid of oids){const end=data.indexOf(10,offset),header=data.subarray(offset,end).toString().split(' '),length=Number(header[2]);if(end<offset||header[0]!==oid||header[1]!=='blob'||!Number.isSafeInteger(length)||length<0||end+1+length>=data.length)throw Error('release_git_blob_invalid');result.push(data.subarray(end+1,end+1+length));offset=end+length+2;}
 return result;
}
export async function gitCandidate({repo,ref}){
 const {stdout}=await exec('git',['-C',repo,'rev-parse','--verify','--end-of-options',`${ref}^{tree}`]);const tree=stdout.trim();if(!/^[0-9a-f]{40,64}$/.test(tree))throw Error('release_ref_invalid');
 const out=await exec('git',['-C',repo,'ls-tree','-rz','--full-tree',tree],{maxBuffer:32*1024*1024});const records=new Map();
 for(const row of out.stdout.split('\0').filter(Boolean)){const at=row.indexOf('\t'),[mode,type,oid]=row.slice(0,at).split(' ');records.set(row.slice(at+1),{mode,type,oid});}
 const cache=new Map(),queue=[];let scheduled=false;
 const flush=async()=>{scheduled=false;const pending=queue.splice(0);try {const values=await batchBlobs(repo,pending.map(r=>r.oid));pending.forEach((r,i)=>r.resolve(values[i]));}catch(error){pending.forEach(r=>r.reject(error));}};
 return {tree,paths:[...records.keys()],modes:Object.fromEntries([...records].map(([p,row])=>[p,row.mode])),readCandidate:p=>{
  const row=records.get(p);if(!row||row.type!=='blob')return Promise.resolve(null);if(!cache.has(row.oid))cache.set(row.oid,new Promise((resolve,reject)=>{queue.push({oid:row.oid,resolve,reject});if(!scheduled){scheduled=true;queueMicrotask(flush);}}));return cache.get(row.oid);
 }};
}
export async function auditReleaseTree({repo,ref='HEAD',sourceRoot=repo,manifest,version='1.3.0'}){
 const source=await realpath(sourceRoot),candidate=await gitCandidate({repo,ref});const manifestBytes=await readFile(manifest||path.join(source,desktop,'generated/source-inputs.json')).catch(()=>null);
 const result=await inspectReleaseInputs({...candidate,manifest:manifestBytes,version,readSource:async p=>{const full=await realpath(path.join(source,p));if(!full.startsWith(source+path.sep))throw Error('release_path_scope');return readFile(full);}});
 return {...result,tree:candidate.tree,ref,version};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const value=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];},repo=path.resolve(value('repo')||fileURLToPath(new URL('../../..',import.meta.url)));
 try {const result=await auditReleaseTree({repo,ref:value('ref')||'HEAD',sourceRoot:path.resolve(value('source-root')||repo),manifest:value('manifest'),version:value('version')||'1.3.0'});if(value('output')){await mkdir(path.dirname(path.resolve(value('output'))),{recursive:true});await writeFile(value('output'),JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
