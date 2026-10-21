import {createPublicReviewIndex} from './safety-public-reviews.mjs';
import {certificateIssuerContacts,publicAttribution} from './safety-public-attributions.mjs';
import {createRequire} from 'node:module';
import {inflateSync} from 'node:zlib';
import path from 'node:path';import {readFileSync} from 'node:fs';import {readFile,writeFile,mkdir,readdir,lstat,realpath} from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath,pathToFileURL} from 'node:url';
import {gitCandidate} from './check-release-inputs.mjs';
const exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex'),manifestPath='packages/nubi-desktop/fixtures-manifest.json';
const verification=p=>p.split('/').includes('verification');
const fixture=p=>/(?:^|\/)(?:fixtures|eval)(?:\/|$)/.test(p)&&/\.(?:json|ya?ml|eml|html|md)$/i.test(p);
const synthetic=p=>/^(?:synthetic-|합성-)/.test(path.posix.basename(p));
const forbidden=p=>/(?:^|\/)(?:profiles\.yaml|\.env(?:\.(?!example$|sample$|template$)[^/]+)?|\.playwright-mcp|__pycache__)(?:\/|$)/i.test(p)||/\.(?:har|webm|pyc)$/i.test(p)||p.includes('개인정보암호화')||verification(p);
const reserved=d=>['example.com','example.net','example.org','localhost'].some(v=>d===v||d.endsWith('.'+v))||/\.(?:invalid|test|example)$/.test(d);
export function scanSensitivePatterns(file,bytes,{classifyPublicAttribution=false}={}){
 const raw=bytes.toString('utf8'),projections=[],result=new Map();
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  try{let at=8,ended=false;while(at+12<=bytes.length){const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),end=at+8+length;if(end+4>bytes.length)throw Error();let data=bytes.subarray(at+8,end);
   if(['tEXt','iTXt','zTXt','eXIf','caBX'].includes(type)){if(type==='zTXt'){const split=data.indexOf(0);if(split<0)throw Error();data=inflateSync(data.subarray(split+2),{maxOutputLength:4*1024*1024});}else if(type==='iTXt'){const split=data.indexOf(0);if(split<0||split+3>data.length)throw Error();const compressed=data[split+1];let start=split+3;for(let i=0;i<2;i++){start=data.indexOf(0,start)+1;if(!start)throw Error();}data=compressed?inflateSync(data.subarray(start),{maxOutputLength:4*1024*1024}):data.subarray(start);}projections.push({text:data.toString('utf8'),projection:'png-'+type,issuerContacts:classifyPublicAttribution&&type==='caBX'?certificateIssuerContacts(data):undefined});}
   at=end+4;if(type==='IEND'){ended=true;if(at<bytes.length)projections.push({text:bytes.subarray(at).toString('utf8'),projection:'png-trailing'});break;}
  }if(!ended)throw Error('png_truncated');}catch{result.set('invalid',{code:'safety_metadata_invalid',path:file});}
 }else projections.push({text:raw,projection:'utf8'});
 if(file.endsWith('.json')){try{const strings=[];const visit=v=>{if(typeof v==='string')strings.push(v);else if(v&&typeof v==='object')for(const child of Object.values(v))visit(child);};visit(JSON.parse(raw));projections.push({text:strings.join('\n'),projection:'decoded-json'});}catch{}}
 for(const {text,projection,issuerContacts} of projections){
  const patterns=[
   ['secret',/(?<![A-Za-z0-9_-])(?:github_pat_[A-Za-z0-9_]{20,256}|gh[pousr]_[A-Za-z0-9]{30,256}|sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{20,256}|AKIA[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9._~-]{20,256})/g],
   ['secret',/["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|session[_-]?token)["']\s*[:=]\s*["']([^"'\s]{16,512})["']/gi],
   ['phone',/(?<!\d)(?:\+82[- ]?)?(?:0?1[016789]|0[2-6]\d?)[- ]\d{3,4}[- ]\d{4}(?!\d)/g],
   ['resident',/(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[- ][1-8]\d{6}(?!\d)/g],
   ['employee',/(?:사번|employee[_ -]?id)["'\s:=：-]{1,8}([A-Za-z]{0,3}\d{5,12})(?!\d)/gi]
  ];
  if(text.includes('@'))patterns.push(['email',/[A-Z0-9._%+-]{1,64}@([A-Z0-9.-]{1,253}\.[A-Z]{2,24})/gi]);
  for(const [kind,pattern] of patterns)for(const match of text.matchAll(pattern)){
   if(kind==='email'&&reserved(match[1].toLowerCase()))continue;
   // OpenSSH SK algorithm names are protocol identifiers, not keys or mailboxes.
   if((kind==='email'||kind==='secret')&&/^sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)(?:-cert-v01)?@openssh\.com(?=[\0\s"'\),;]|$)/.test(text.slice(match.index)))continue;
   if(kind==='secret'&&match[1]?.startsWith('secret:'))continue;
   const attribution=classifyPublicAttribution&&kind==='email'?publicAttribution({file,text,index:match.index,value:match[0],projection,issuerContacts}):undefined;
   const fingerprint=hash(match[0]).slice(0,16),key=kind+'|'+fingerprint+'|'+(attribution||'blocking');
   if(result.has(key)){result.get(key).occurrences++;continue;}
   result.set(key,{code:'safety_sensitive_pattern',path:file,kind,line:text.slice(0,match.index).split('\n').length,projection,fingerprint,occurrences:1,...(attribution?{disposition:'public_attribution',attribution}:{})});
  }
 }
 return [...result.values()];
}
export async function inspectSafetyDelta({paths,basePaths,changedPaths,readCandidate,manifest}){
 const issues=[],present=new Set(paths),base=new Set(basePaths),declared=new Map();
 if(!manifest||manifest.version!==1||!Array.isArray(manifest.fixtures))issues.push({code:'safety_manifest_invalid',path:manifestPath});
 for(const item of manifest?.fixtures||[]){
  const p=item?.path;
  if(typeof p!=='string'||!fixture(p)||synthetic(p)||declared.has(p)||!present.has(p)||!base.has(p)||!item.kind||typeof item.evidence!=='string'||item.evidence.length<8||!item.reviewer||!/^\d{4}-\d{2}-\d{2}$/.test(item.reviewedAt||'')||!/^\w{64}$/.test(item.sha256||'')){issues.push({code:'safety_fixture_declaration',path:typeof p==='string'?p:manifestPath});continue;}
  declared.set(p,item);
  try{const bytes=await readCandidate(p);if(bytes==null)throw Error();if(hash(bytes)!==item.sha256)issues.push({code:'safety_fixture_changed',path:p});issues.push(...scanSensitivePatterns(p,bytes));}catch{issues.push({code:'safety_source_unavailable',path:p});}
 }
 for(const p of base){if(present.has(p)&&fixture(p)&&!/\.md$/i.test(p)&&!synthetic(p)&&!declared.has(p))issues.push({code:'safety_fixture_unreviewed',path:p});}
 for(const p of changedPaths){
  if(!present.has(p))continue;
  if(forbidden(p)){issues.push({code:'safety_upload_path',path:p});continue;}
  if(fixture(p)&&!synthetic(p)&&!declared.has(p))issues.push({code:'safety_fixture_undeclared',path:p});
  if(declared.has(p))continue;
  try{const bytes=await readCandidate(p);if(bytes==null)throw Error();issues.push(...scanSensitivePatterns(p,bytes));}catch{issues.push({code:'safety_source_unavailable',path:p});}
 }
 return {ok:issues.length===0,policyVersion:1,mode:'delta',checkedDelta:changedPaths.length,reviewedFixtures:declared.size,issues};
}
export async function inspectSafetyTree({paths,readCandidate}){
 const publicAttributions=[],issues=[],excludedVerification=[];let checked=0;
 for(let i=0;i<paths.length;i+=16){await Promise.all(paths.slice(i,i+16).map(async p=>{if(verification(p)){excludedVerification.push(p);return;}checked++;try{const bytes=await readCandidate(p);if(bytes==null)throw Error();for(const finding of scanSensitivePatterns(p,bytes,{classifyPublicAttribution:true}))(finding.disposition==='public_attribution'?publicAttributions:issues).push(finding);}catch{issues.push({code:'safety_source_unavailable',path:p});}}));}
 return {ok:issues.length===0,policyVersion:1,mode:'tree',checked,excludedVerification,publicAttributions,issues};
}

// npm installs electron.exe for the build host from the checksum-verified Electron release; reviews pin its exact hash.
const ELECTRON_DIST=fileURLToPath(new URL('../node_modules/electron/dist/',import.meta.url));
export async function inspectSafetyBundle({directory,publicReviews,upstreamRoot=ELECTRON_DIST}){
 const reviews=createPublicReviewIndex(publicReviews,{upstream:item=>readFileSync(path.join(upstreamRoot,item.source.artifactPath)),scan:(file,bytes)=>scanSensitivePatterns(file,bytes,{classifyPublicAttribution:true})}),root=await realpath(path.resolve(directory)),issues=reviews.issues,publicAttributions=[],reviewedPublicFindings=[],visited=new Set();let checked=0,archiveFiles=0;
 const record=(file,bytes)=>{checked++;let sha256;for(const finding of reviews.classify(file,bytes,scanSensitivePatterns(file,bytes,{classifyPublicAttribution:true}))){
  if(finding.disposition==='public_attribution')publicAttributions.push(finding);else if(finding.disposition==='reviewed_public_data')reviewedPublicFindings.push(finding);
  // A blocking finding carries the exact file hash, so a review can pin these bytes without another build.
  else issues.push(finding.code==='safety_sensitive_pattern'?{...finding,sha256:sha256??=hash(bytes)}:finding);
 }};
 const inspectFile=async(absolute,file)=>{
   if(visited.has(absolute))return;visited.add(absolute);
   try{
    if(file.endsWith('.asar')){
     const asar=createRequire(import.meta.url)('@electron/asar');asar.uncache(absolute);
     for(const name of asar.listPackage(absolute)){
      const member=name.replaceAll('\\','/').replace(/^\//,'');
      if(!member||member.split('/').some(p=>p==='..'||p==='')){issues.push({code:'safety_archive_path',path:file});continue;}
      // @electron/asar splits member paths with path.sep, so Windows needs backslashes (forward slashes found nothing and hid the whole archive).
      const inner=member.split('/').join(path.sep),node=asar.statFile(absolute,inner,false),display=file+'/'+member;
      if(node.link){issues.push({code:'safety_bundle_link',path:display});continue;}
      if(node.files)continue;
      if(verification(member)){issues.push({code:'safety_upload_path',path:display});continue;}
      if(/\.(?:asar|zip|7z|gz|tgz|tar)$/i.test(member)){issues.push({code:'safety_archive_unsupported',path:display});continue;}
      if(node.unpacked){
       const physical=path.join(absolute+'.unpacked',inner);
       // Every ancestor must stay inside the payload and must not be a link.
       for(let check=physical;check!==root;check=path.dirname(check)){
        if(!check.startsWith(root+path.sep)||(await lstat(check)).isSymbolicLink())throw Error('unsafe_unpacked');
       }
       if(!((await realpath(physical)).startsWith(root+path.sep)))throw Error('unsafe_unpacked');
      }
      record(display,asar.extractFile(absolute,inner,false));archiveFiles++;
     }
     asar.uncache(absolute);
    }else if(/\.(?:zip|7z|gz|tgz|tar)$/i.test(file))issues.push({code:'safety_archive_unsupported',path:file});
    else record(file,await readFile(absolute));
   }catch{issues.push({code:'safety_source_unavailable',path:file});}
 };
 const visit=async(dir)=>{
  if(visited.has(dir))return;visited.add(dir);
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const absolute=path.join(dir,entry.name),file=path.relative(root,absolute).split(path.sep).join('/');
   if(verification(file)){issues.push({code:'safety_upload_path',path:file});continue;}
   if(entry.isSymbolicLink()){
    try{const resolved=await realpath(absolute);if(!resolved.startsWith(root+path.sep)||verification(path.relative(root,resolved)))throw Error();
     const stat=await lstat(resolved);if(stat.isDirectory())await visit(resolved);else if(stat.isFile())await inspectFile(resolved,path.relative(root,resolved).split(path.sep).join('/'));else throw Error();
    }catch{issues.push({code:'safety_bundle_link',path:file});}continue;
   }
   if(entry.isDirectory()){await visit(absolute);continue;}
   if(!entry.isFile()){issues.push({code:'safety_bundle_type',path:file});continue;}
   await inspectFile(absolute,file);
  }
 };
 if((await lstat(path.resolve(directory))).isSymbolicLink())issues.push({code:'safety_bundle_link',path:'.'});else await visit(root);
 if(!checked)issues.push({code:'safety_bundle_empty',path:'.'});
 return {ok:issues.length===0,policyVersion:1,mode:'bundle',checked,archiveFiles,publicAttributions,reviewedPublicFindings,unusedReviewPaths:reviews.unused(),issues};
}
export async function auditSafety({repo,delta,ref,tree}){
 const candidate=await gitCandidate({repo,ref:tree||ref});if(tree)return {...await inspectSafetyTree(candidate),tree:candidate.tree};
 const base=await gitCandidate({repo,ref:delta}),diff=await exec('git',['-C',repo,'diff','--name-only','--diff-filter=ACMR','-z',base.tree,candidate.tree],{maxBuffer:16*1024*1024});let manifest;
 try{manifest=JSON.parse((await candidate.readCandidate(manifestPath)).toString());}catch{}
 return {...await inspectSafetyDelta({...candidate,basePaths:base.paths,changedPaths:diff.stdout.split('\0').filter(Boolean),manifest}),baseTree:base.tree,tree:candidate.tree};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
 // A push that creates a branch has no 'before' commit (all zeros): the delta is then taken from the parent commit.
 try{const tree=option('tree'),bundle=option('bundle-dir');if((tree&&option('delta'))||(bundle&&(tree||option('delta')||option('ref'))))throw Error('safety_mode_conflict');const repo=path.resolve(option('repo')||fileURLToPath(new URL('../../..',import.meta.url))),result=bundle?await inspectSafetyBundle({directory:bundle,publicReviews:JSON.parse(await readFile(new URL('./safety-public-reviews.json',import.meta.url),'utf8'))}):await auditSafety({repo,tree,ref:option('ref')||process.env.NUBI_SAFETY_REF||'HEAD',delta:option('delta')||(/^0*$/.test(process.env.NUBI_SAFETY_BASE||'')?'':process.env.NUBI_SAFETY_BASE)||'HEAD^'});if(option('output')){const p=path.resolve(option('output'));await mkdir(path.dirname(p),{recursive:true});await writeFile(p,JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
