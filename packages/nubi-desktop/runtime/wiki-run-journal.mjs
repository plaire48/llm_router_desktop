import {ClaimsStore,RepositoryEvidenceResolver,OpenWikiIgnore,parseRepositoryEvidenceResource} from '../generated/openwiki.mjs';
import {hash,relativeFile,readSource,privatePath} from './files.mjs';
import {mkdir,lstat,readFile,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {WIKI_RUN_BUDGET_MS,wikiClock,wikiErrorCode} from './wiki-durable-policy.mjs';

// Source bodies and credentials never enter this host-owned journal.
export function createWikiRunJournal({store,key,identity,generation='default',clock=wikiClock,check=()=>{}}){
 const fingerprint=hash(JSON.stringify(identity));let value=store.get(key);
 if(value?.version!==1||value.identity!==fingerprint)value={version:1,identity:fingerprint,startedAt:clock.now(),deadlineAt:clock.now()+WIKI_RUN_BUDGET_MS,pages:{},continuations:{}};
 // Only the host's completed scope boundary may replace the native run.
 // Keep the original wall deadline, and invalidate late prior-round owners.
 if(value.generation&&value.generation!==generation){
   if(value.phase!=='ready')throw Error('wiki_run_changed');
   value={...value,pages:{},continuations:{},partial:false};delete value.nativeRunId;delete value.phase;
 }
 value={...value,generation};check();store.set(key,value);
 const save=()=>{check();const current=store.get(key);if(current?.identity!==fingerprint||current.generation!==generation)throw Error('wiki_run_changed');value={...value,heartbeatAt:clock.now()};store.set(key,value);return value;};
 save();
 return {
   get value(){return value;},
   beat(){return save();},
   continuation(page){check();if(value.continuations[page])return false;value={...value,continuations:{...value.continuations,[page]:true}};save();return true;},
   retry(page,error,attempt,nextRetryAt){value={...value,pages:{...value.pages,[page]:{...value.pages[page],state:'retrying',attempts:attempt,nextRetryAt,error:wikiErrorCode(error)}}};return save();},
   snapshot(event){
     check();
     if(value.nativeRunId&&value.nativeRunId!==event.runId)throw Error('wiki_run_changed');
     const pages={};
     for(const page of event.pages){const prior=value.pages[page.path]||{},done=page.status==='complete';pages[page.path]={...prior,id:page.id,state:done?'done':page.status==='skipped'?'skipped':(page.durability?.nextRetryAt??0)>clock.now()?'retrying':page.path===event.page&&event.phase==='page_running'||prior.state==='running'?'running':'pending',attempts:page.durability?.attempts??prior.attempts??0,nextRetryAt:done?null:page.durability?.nextRetryAt??prior.nextRetryAt??null,error:done?null:page.path===event.page&&event.error?wikiErrorCode(event.error):page.durability?.error??prior.error??null};}
     value={...value,nativeRunId:event.runId,pages,partial:event.phase==='partial',phase:event.phase};return save();
   },
 };
}

// Publication is not a UI excerpt: validate every Claim and evidence version,
// without the display reader's 24-Claim/12-reference limits.
export async function verifyWikiPages(copy,paths,{check=()=>{}}={}){
 copy=await realpath(copy);const ignore=await OpenWikiIgnore.load(copy),store=new ClaimsStore(copy),resolver=new RepositoryEvidenceResolver({rootDir:copy,openWikiIgnore:ignore});
 const observed=new Map();
 for(const rel of paths){
   check();relativeFile('openwiki/'+rel);
   const page=await readSource(copy,'openwiki/'+rel),sidecar='openwiki/.claims/'+rel.replace(/\.md$/,'.json'),sidecarHash=(await readSource(copy,sidecar)).hash;
   const claims=await store.loadPage('/openwiki/'+rel);if(!claims||claims.pageVersion!==page.hash)throw Error('write_unconfirmed');
   for(const claim of claims.claims)for(const evidence of claim.evidence){
     check();const parsed=parseRepositoryEvidenceResource(evidence.resource);relativeFile(parsed.path);if(privatePath(parsed.path)||ignore.ignores(parsed.path))throw Error('write_unconfirmed');
     const source=await readSource(copy,parsed.path),resolved=await resolver.resolve(evidence.resource,evidence.version);
     if(!resolved||resolved.evidence.version!==evidence.version)throw Error('write_unconfirmed');observed.set(parsed.path,source.hash);
   }
   if((await readSource(copy,sidecar)).hash!==sidecarHash||(await readSource(copy,page.path)).hash!==page.hash)throw Error('write_unconfirmed');
 }
 for(const [rel,expected] of observed){check();if((await readSource(copy,rel)).hash!==expected)throw Error('write_unconfirmed');}
 check();
}

// Only initialization uses this publisher. Approved updates retain their
// separate result approval/apply path. An intent is saved before each write
// so reopening reconciles an interrupted publication by hash, not replay.
export async function publishWikiOutput({root,copy,paths,published,check,save,onFile}){
 root=await realpath(root);copy=await realpath(copy);
 let completed=0;
 for(const rel of paths){
   check();relativeFile('openwiki/'+rel);
   const {content}=await readSource(copy,'openwiki/'+rel,{maxBytes:['.nubi-sources.json','.page-manifest.json'].includes(rel)?64*1024*1024:1024*1024}),expected=hash(content),target=path.join(root,'openwiki',rel);
   let parent=root;
   for(const segment of ['openwiki',...rel.split('/').slice(0,-1)]){parent=path.join(parent,segment);await mkdir(parent,{recursive:true});if((await lstat(parent)).isSymbolicLink())throw Error('path_scope');}
   let existing=false,current;
   try{const stat=await lstat(target);if(stat.isSymbolicLink())throw Error('path_scope');if(!stat.isFile())throw Object.assign(Error('wiki_output_conflict'),{code:'EEXIST'});existing=true;current=hash(await readFile(target));}catch(error){if(error.code!=='ENOENT')throw error;}
   if(existing&&(!published[rel]||published[rel]!==current))throw Object.assign(Error('wiki_output_conflict'),{code:'EEXIST'});
   check();published[rel]=expected;save();
   if(!existing||current!==expected)await writeFile(target,content,{flag:existing?'w':'wx'});
   check();if(hash(await readFile(target))!==expected)throw Error('write_unconfirmed');
   onFile?.(++completed,target,expected,!existing);
 }
}
