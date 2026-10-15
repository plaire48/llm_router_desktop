import {notifyWikiCompleted} from './wiki-notification.mjs';
import {requireWikiGit} from './git-runtime.mjs';
import {pullSources} from './wiki-refresh.mjs';
import {snapshotFolderHistory} from './wiki-folder-history.mjs';
import {wikiPreparationGit} from './wiki-git-preparation.mjs';
// OpenWiki update, proposed by Desktop and run on approval (user decision 2026-09-29).
//
// The status is read without a model: the source changed since the generation
// record, and the pages whose evidence no longer matches. An approved run
// works in a temporary Git worktree at HEAD, so the workspace changes only
// when the user approves the result, and only under openwiki/. OpenWiki's
// code is not changed: the runner is the one OpenWiki uses for `--update`.
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rm,unlink,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {git,hash,fail,readSource,scopedFile,gitOpenFailure,privatePath} from './files.mjs';
import {wikiSources,wikiFiles,listWikiPages,listWikiSourceFiles,writeWikiSnapshot,checkpointSnapshotWiki,readWikiSource,wikiSourceHead,WIKI_CHECKPOINT} from './wiki-snapshot.mjs';
import {stalePages} from './wiki-evidence.mjs';
import {OpenWikiIgnore,RepositoryEvidenceResolver,parseRepositoryEvidenceResource} from '../generated/openwiki.mjs';
import {modelTransport} from './recovery.mjs';
import {createRunMetrics} from './run-metrics.mjs';
import {wikiInitializationError} from './wiki-initialization-error.mjs';
import {wikiPlanPending,WIKI_PLAN_REQUIRED} from './wiki-plan-completion.mjs';

const WIKI='openwiki/',CLAIMS='openwiki/.claims/',RECORD='openwiki/.last-update.json',KEPT=20,EVENTS=40;
const inWiki=rel=>rel.startsWith(WIKI);
// Source changes that count, as OpenWiki counts them: outside openwiki/ and not in .openwikiignore.
const counted=ignore=>rel=>rel&&!inWiki(rel)&&!ignore.ignores(rel);
// The rows of `git status`, NUL-separated so that a name with spaces or Korean letters is not quoted and escaped.
// A rename's origin path is skipped.
async function statusPaths(root){
  const records=(await git(root,['status','--porcelain','-z','--untracked-files=all'])).split('\0'),rows=[];
  for(let i=0;i<records.length;i++){const record=records[i];if(!record)continue;const code=record.slice(0,2);rows.push({code,path:record.slice(3)});if(/^[RC]/.test(code))i++;}
  return rows;
}

export async function wikiUpdateStatus(root){
  if(!(await listWikiPages(root)).length)return {state:'unknown',reason:'no_wiki_pages'};
  let record;
  try{record=JSON.parse((await readSource(root,RECORD)).content);}catch{
    record={};
  }
  const lastUpdate={updatedAt:record.updatedAt||null,gitHead:record.gitHead||null,status:record.status||null,language:record.language||null};
  let head=null;try{head=(await git(root,['rev-parse','HEAD'])).trim();}catch(error){if(!['not_git_repository','git_unavailable'].includes(gitOpenFailure(error)))throw error;}
  const source=counted(await OpenWikiIgnore.load(root));
  if(!head||!lastUpdate.gitHead){
    let checkpoint;try{checkpoint=JSON.parse((await readSource(root,WIKI_CHECKPOINT,{maxBytes:64*1024*1024})).content);}catch{}
    const files=await wikiSources(root),current=Object.fromEntries(files.map(file=>[file.path,file.hash]));
    const known=checkpoint?.schemaVersion===1&&checkpoint.files&&typeof checkpoint.files==='object';
    const changedFiles=known?[...new Set([...Object.keys(checkpoint.files),...Object.keys(current)])].filter(rel=>checkpoint.files[rel]!==current[rel]):[];
    const pages=await stalePages(root),reason=record.status==='interrupted'?'interrupted':!known?'no_generation_record':null;
    const uncommitted=head?(await statusPaths(root)).map(row=>row.path).filter(source):[];
    return {state:reason||changedFiles.length||pages.length?'stale':'current',...(reason?{reason}:{}),head,lastUpdate,changedFiles,stalePages:pages,uncommitted,sourceMode:head?'committed':'folder'};
  }
  let changedFiles=[],reason=null;
  if(!lastUpdate.gitHead)reason='no_base';
  else if(lastUpdate.gitHead!==head){
    try{changedFiles=(await git(root,['diff','--name-only',lastUpdate.gitHead,head])).split('\n').filter(source);}
    catch{reason='unknown_base';}
  }
  if(lastUpdate.status==='interrupted')reason='interrupted';
  const uncommitted=(await statusPaths(root)).map(row=>row.path).filter(source);
  // Uncommitted edits reach the Wiki through an update (user decision 2026-10-12), so they count once they differ
  // from the sources the last run read, which the checkpoint names. Without a checkpoint they are only named.
  const checkpoint=await readCheckpoint(root);
  if(checkpoint)for(const rel of await changedSinceCheckpoint(root,checkpoint,uncommitted))if(!changedFiles.includes(rel))changedFiles.push(rel);
  const pages=await stalePages(root);
  const stale=!!reason||changedFiles.length>0||pages.length>0;
  return {state:stale?'stale':'current',...(reason?{reason}:{}),head,lastUpdate,changedFiles,stalePages:pages,uncommitted};
}

// The model connections reject a response with more than 8 tool calls, or with neither text nor a tool call
// (response_invalid). Measured 2026-09-29 with gpt-5.6-sol: OpenWiki's planner read a repository in parallel and
// asked for more calls; told the limit, it split them. After submit_plan it ended with an empty response; asked
// for a short reply, it wrote one. A rejected response is asked for again with that request, up to three more times
// (2026-10-12: three rejections in a row ended a five-minute generation).
export const CALL_LIMIT={role:'system',content:'Host limit: return at most 8 tool calls in one response. Split larger sets of calls across responses.'};
export const TEXT_REPLY={role:'user',content:'Host note: if no tool call is needed now, reply with one short sentence.'};
const withCallLimit=wire=>{const at=wire.findIndex(message=>message.role!=='system');return at<0?[...wire,CALL_LIMIT]:[...wire.slice(0,at),CALL_LIMIT,...wire.slice(at)];};
// Repository reasoning may be slow. Parsed model activity keeps it alive; a
// silent request pauses for explicit resume instead of repeating ten-minute waits.
export const WIKI_MODEL_WAIT_POLICY=Object.freeze({idleMs:600000,attemptMs:0,slowMs:30000,retryTimeouts:false});

export async function prepareNativeWikiCopy(root,mode='update'){
  try{
    const {ensureCodeModeRepoSetup}=await import('../generated/openwiki-update/index.mjs');
    await ensureCodeModeRepoSetup(root,{createWorkflow:mode==='init'});
  }catch(error){if(['ENOENT','ERR_MODULE_NOT_FOUND'].includes(error?.code))fail('wiki_runtime_missing');throw error;}
}

// The runner OpenWiki uses for `openwiki --update`, with the model the user logged in to Desktop.
// Model calls are counted under the purpose wiki_update. Only progress facts leave the run:
// stage, page and position, never page text.
export function defaultWikiUpdater(service,{load=()=>import('../generated/openwiki-update/index.mjs')}={}){
  // mode init serves only the evaluation, which generates the Wiki that it then updates.
  return async({root,language,signal,onEvent,updateId,mode='update'})=>{
    const status=service.providers?.status?.();
    if(!status?.connected)fail('model_unavailable');
    onEvent?.({type:'progress',stage:'preparing_runtime'});
    let runtime;
    try{runtime=await load();}catch(error){if(['ENOENT','ERR_MODULE_NOT_FOUND'].includes(error?.code))fail('wiki_runtime_missing');throw error;}
    const {runNativeRepositoryGeneration,NubiOpenWikiModel,syncBundledSkills}=runtime;
    // As `openwiki --update` does: the runner's agents read the skills from the OpenWiki home.
    onEvent?.({type:'progress',stage:'preparing_skills'});
    try{await syncBundledSkills?.();}catch(error){if(error?.code==='ENOENT')fail('wiki_skills_missing');throw error;}
    const invoke=modelTransport(service,{signal,waitPolicy:WIKI_MODEL_WAIT_POLICY,onSlow:()=>onEvent?.({type:'model_wait',waiting:true}),onResumed:()=>onEvent?.({type:'model_wait',waiting:false}),onRetry:(attempt,detail)=>onEvent?.({type:'model_retry',attempt,code:detail.code||'network_error'}),metrics:createRunMetrics({store:service.store,taskId:'wiki-update:'+updateId,runId:updateId})});
    let terminalModelError;
    const complete=async(wire,tools,options={})=>{
      if(terminalModelError)throw terminalModelError;
      const active=service.providers.status();if(!active.connected||active.model!==status.model||active.provider!==status.provider||active.connectionId!==status.connectionId)fail('provider_changed');
      const request=withCallLimit(wire),planPending=wikiPlanPending(wire,tools);let attempt=request,planRepairs=0;
      for(let retry=0;;retry++){
        try{
          const result=await invoke(attempt,tools,options.signal||signal,'wiki_update',{retryInvalidResponse:false});
          if(result.finishReason==='length')fail('output_limit');
          if(planPending&&!result.calls?.length){
            if(planRepairs++>=2)fail('wiki_plan_missing');
            attempt=[...attempt,{role:'assistant',content:result.content||''},WIKI_PLAN_REQUIRED];
            onEvent?.({type:'model_retry',attempt:planRepairs,code:'wiki_plan_missing'});
            continue;
          }
          return result;
        }
        catch(error){
          if(error.message==='response_invalid'&&retry<3){attempt=[...attempt,planPending?WIKI_PLAN_REQUIRED:TEXT_REPLY];continue;}
          // The runner turns a page worker's failure into a skipped page: without this the host saw only an empty Wiki (2026-10-12).
          terminalModelError=error;
          onEvent?.({type:'model_error',code:/^[a-z_]{3,60}$/.test(error?.message||'')?error.message:'model_failed'});throw error;
        }
      }
    };
    const model=new NubiOpenWikiModel({complete,signal,modelId:status.model,taskId:null});
    const progress=event=>{
      // Native finalization removes .run.json even when a worker was skipped.
      // Stop BEFORE that boundary so accepted plans/pages remain resumable.
      if(event?.type==='repository_progress'&&event.stage==='finalizing'&&terminalModelError)throw terminalModelError;
      if(event?.type==='repository_progress')onEvent?.({type:'progress',stage:String(event.stage),...(typeof event.page==='string'?{page:event.page.slice(0,300)}:{}),...(Number.isSafeInteger(event.pageIndex)?{index:event.pageIndex}:{}),...(Number.isSafeInteger(event.pageCount)?{total:event.pageCount}:{}),...(Number.isSafeInteger(event.completedPages)?{completed:event.completedPages}:{})});
    };
    const result=await runNativeRepositoryGeneration({root,mode,language:language||null,modelId:status.model,model,onEvent:progress});
    // OpenWiki may return after skipping failed pages. Keep the durable run for
    // resume instead of publishing a partial generation as a completed Wiki.
    if(terminalModelError)throw terminalModelError;
    return result;
  };
}

// The checkpoint of a run names the sources it read (path to hash). Files that differ from it now.
async function readCheckpoint(root){
  let checkpoint;try{checkpoint=JSON.parse((await readSource(root,WIKI_CHECKPOINT,{maxBytes:64*1024*1024})).content);}catch{return null;}
  return checkpoint?.schemaVersion===1&&checkpoint.files&&typeof checkpoint.files==='object'?checkpoint:null;
}
async function changedSinceCheckpoint(root,checkpoint,paths){
  const changed=[];
  for(const rel of paths){let current=null;try{current=(await readSource(root,rel)).hash;}catch{current=null;}if(current!==(checkpoint.files[rel]??null))changed.push(rel);}
  return changed;
}
// Without a model, for the host receipts of a run: whether the Wiki is behind its sources. Commits come from Git;
// uncommitted edits, and the files of a folder without Git, from the checkpoint of the last run (2026-10-12: the
// agent answered from a Wiki the card called stale, and a folder without Git never said so). A folder of more than
// 3,000 files is not hashed at every run.
const SUMMARY_FILE_LIMIT=3000;
export async function wikiChangeSummary(root){
  let record;try{record=JSON.parse((await readSource(root,RECORD)).content);}catch{return null;}
  if(record.status==='interrupted')return {state:'stale',reason:'interrupted'};
  let head=null;try{head=(await git(root,['rev-parse','HEAD'])).trim();}catch(error){if(!['not_git_repository','git_unavailable'].includes(gitOpenFailure(error)))throw error;}
  const source=counted(await OpenWikiIgnore.load(root)),changed=[];
  if(head&&record.gitHead&&record.gitHead!==head){
    try{changed.push(...(await git(root,['diff','--name-only',record.gitHead,head])).split('\n').filter(source));}catch{return {state:'stale',reason:'unknown_base'};}
  }
  const checkpoint=await readCheckpoint(root);
  if(checkpoint){
    let paths;
    if(head)paths=(await statusPaths(root)).map(row=>row.path).filter(source);
    else{const listed=await listWikiSourceFiles(root);paths=listed.truncated?null:[...new Set([...Object.keys(checkpoint.files),...listed.paths.filter(source)])];if(paths&&paths.length>SUMMARY_FILE_LIMIT)paths=null;}
    if(paths)for(const rel of await changedSinceCheckpoint(root,checkpoint,paths))if(!changed.includes(rel))changed.push(rel);
  }
  return changed.length?{state:'stale',changedFiles:changed.length,sample:changed.slice(0,8)}:null;
}

const records=service=>service.store.list('wiki-update:').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
const save=(service,value)=>{service.store.set('wiki-update:'+value.id,value);return value;};
const visible=({controller,resume,...value})=>({...value,canResume:!!resume&&['failed','cancelled'].includes(value.state)});
const fileHashes=files=>Object.fromEntries(files.map(file=>[file.path,file.hash]).sort(([a],[b])=>a.localeCompare(b)));
const sameHashes=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function retainedPageProgress(copy){
  try{
    const file=await scopedFile(copy,'openwiki/.run.json');
    if((await lstat(file)).size>2*1024*1024)return null;
    const pages=JSON.parse(await readFile(file,'utf8'))?.plan?.pages;
    if(!Array.isArray(pages)||!pages.length)return null;
    return {completed:pages.filter(page=>page.status==='complete').length,total:pages.length};
  }catch{return null;}
}
async function validateUpdateResume(root,owner,value,{signal}={}){
  const saved=value.resume;if(saved?.schema!==1)fail('wiki_update_resume_missing');
  const expected=path.join(owner.directory,'wiki-update',value.id);
  if(!/^[a-f0-9-]{36}$/.test(value.id)||value.copy!==expected)fail('path_scope');
  try{
    for(const directory of [path.dirname(expected),expected])if((await lstat(directory)).isSymbolicLink())fail('path_scope');
    if(await realpath(expected)!==expected)fail('path_scope');
    if((await git(expected,['rev-parse','HEAD'])).trim()!==saved.copyHead)fail('wiki_update_resume_changed');
    if(!sameHashes(fileHashes(await wikiSources(expected,{signal})),saved.copySources))fail('wiki_update_resume_changed');
  }catch(error){if(error.code==='ENOENT')fail('wiki_update_resume_missing');throw error;}
  if(await wikiSourceHead(root)!==saved.head||!sameHashes(fileHashes(await wikiSources(root,{signal})),saved.sources))fail('wiki_update_sources_changed');
  if(!sameHashes(fileHashes(await wikiFiles(root)),saved.wiki))fail('wiki_update_conflict');
  return expected;
}

// What a copy holds under openwiki/ that HEAD does not, and what the runner changed outside. The overlay names the
// working tree's own uncommitted sources in the copy (path to hash, null for a deleted one): those are not the runner's.
async function changesOf(copy,overlay=new Map()){
  const changes=[],outside=[];
  for(const {code,path:rel} of await statusPaths(copy)){
    if(!inWiki(rel)){
      if(overlay.has(rel)){let now=null;try{now=hash(await readFile(path.join(copy,rel)));}catch(error){if(error.code!=='ENOENT')throw error;}if(now===overlay.get(rel))continue;}
      outside.push(rel);continue;
    }
    changes.push({path:rel,change:code.includes('D')?'deleted':code.includes('?')||code.includes('A')?'added':'modified'});
  }
  return {changes:changes.sort((a,b)=>a.path.localeCompare(b.path)),outside:outside.sort()};
}
// Claims of the result that cite a file outside the Wiki that the run changed, as the part of AGENTS.md that
// OpenWiki manages. That change is not applied, so the evidence is read from the workspace version of the file;
// those that it does not hold are named before the result is applied (measured 2026-09-29: a page became unavailable).
async function outsideEvidence(root,copy,changes,outside){
  if(!outside.length)return [];
  const resolver=new RepositoryEvidenceResolver({rootDir:root}),found=new Map();
  for(const change of changes){
    if(change.change==='deleted'||!change.path.startsWith(CLAIMS)||!change.path.endsWith('.json'))continue;
    let claims;try{claims=JSON.parse(await readFile(path.join(copy,change.path),'utf8'));}catch{continue;}
    for(const claim of claims.claims||[])for(const evidence of claim.evidence||[]){
      let cited;try{cited=parseRepositoryEvidenceResource(evidence.resource).path;}catch{continue;}
      if(!outside.includes(cited))continue;
      let version=null;try{version=(await resolver.resolve(evidence.resource))?.evidence?.version??null;}catch{version=null;}
      if(version===evidence.version)continue;
      const page=WIKI+change.path.slice(CLAIMS.length).replace(/\.json$/,'.md');found.set(page+'\n'+cited,{page,path:cited});
    }
  }
  return [...found.values()].slice(0,20);
}
async function fileHash(root,rel){try{return hash(await readFile(await scopedFile(root,rel)));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function removeCopy(root,copy){
  try{await git(root,['worktree','remove','--force',copy]);}catch{/* Already removed. */}
  await rm(copy,{recursive:true,force:true});
}

export async function wikiUpdate({method='status',id,fingerprint}={}){
  this.ready();const root=this.root,owner=this.store,projectId=this.projectId;
  // An orphaned run retains its private copy and durable native page checkpoints.
  for(const item of records(this).filter(item=>item.state==='running'&&!(item.id===this.wikiUpdateRun?.id&&this.wikiUpdateRun.owner===owner))){save(this,{...item,state:'failed',pageProgress:await retainedPageProgress(item.copy),error:'wiki_update_interrupted',finishedAt:new Date().toISOString()});}
  if(method==='status')return {status:await wikiUpdateStatus(root),updates:records(this).slice(0,KEPT).map(visible)};
  if(method==='propose'){
    const status=await wikiUpdateStatus(root);
    if(this.store!==owner||this.root!==root)fail('project_changed');
    if(status.state!=='stale')fail(status.state==='unknown'?'wiki_update_unavailable':'wiki_update_not_needed');
    const value={id:randomUUID(),state:'proposed',createdAt:new Date().toISOString(),status};
    value.fingerprint=hash(JSON.stringify([value.id,status.head,status.changedFiles,status.stalePages]));
    return save(this,value);
  }
  // "오픈위키 갱신" from the conversation or /wiki_update (user request 2026-10-14): pull the git remote when there is
  // one, then propose and run the update as the 위키 갱신 button does. Nothing to update is a plain result, not an error.
  if(method==='refresh'){
    if(this.wikiUpdateRun||this.wikiRefreshOwner||this.wikiInitController||this.agent?.running||this.processes?.active.size)fail('wiki_update_busy');
    this.wikiRefreshOwner=owner;
    const controller=new AbortController();
    this.wikiRefreshJob={id:randomUUID(),projectId:this.projectId,kind:'update',state:'running',stage:'syncing',startedAt:new Date().toISOString(),percent:null,controller};
    try{
      const sourceMode=owner.get('setting:wiki-source')?.mode;
      const pulled=sourceMode==='local'?{attempted:false,reason:'local_project'}:await (this.syncWikiSources||pullSources)(root,{signal:controller.signal});
      if(sourceMode==='remote'&&!pulled.attempted)fail('git_upstream_missing');
      if(controller.signal.aborted)fail('wiki_refresh_cancelled');
      if(this.store!==owner||this.root!==root)fail('project_changed');
      if(pulled.attempted&&!pulled.ok)fail(pulled.reason);
      if(!pulled.attempted&&!['no_remote','not_git_repository','local_project'].includes(pulled.reason))fail(pulled.reason);
      const status=await wikiUpdateStatus(root);
      if(this.store!==owner||this.root!==root)fail('project_changed');
      if(controller.signal.aborted)fail('wiki_refresh_cancelled');
      if(status.reason==='no_wiki_pages'){
        this.wikiInitEnabled=true;owner.set('wiki-init',null);
        const initialization=await this.initializeWiki();
        return {pulled,status,update:null,initialization};
      }
      // Never revive an older failed proposal after a newer result was applied
      // or discarded. Repeated refresh also keeps a ready result awaiting approval.
      const latest=records(this)[0];
      const retained=latest?.resume&&['failed','cancelled','ready'].includes(latest.state)?latest:null;
      if(retained){
        let usable=true;
        try{await validateUpdateResume(root,owner,retained);}catch(error){
          if(!['wiki_update_sources_changed','wiki_update_conflict','wiki_update_resume_changed','wiki_update_resume_missing'].includes(error.message))throw error;
          usable=false;
        }
        if(usable){
          if(retained.state==='ready')return {pulled,status,update:visible(retained)};
          this.wikiRefreshProposalId=retained.id;
          const update=await wikiUpdate.call(this,{method:'resume',id:retained.id,fingerprint:retained.fingerprint});
          return {pulled,status,update,resumed:true};
        }
      }
      if(status.state==='unknown')fail('wiki_update_unavailable');
      if(status.state!=='stale')return {pulled,status,update:null};
      const proposal=await wikiUpdate.call(this,{method:'propose'});
      if(controller.signal.aborted)fail('wiki_refresh_cancelled');
      if(pulled.attempted)save(this,{...proposal,sourceBasis:'remote'});
      this.wikiRefreshProposalId=proposal.id;
      const update=await wikiUpdate.call(this,{method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
      return {pulled,status,update};
    }finally{if(this.wikiRefreshOwner===owner){this.wikiRefreshOwner=null;this.wikiRefreshJob=null;this.wikiRefreshProposalId=null;}}
  }
  if(method==='cancel'&&this.wikiRefreshOwner===owner&&id===this.wikiRefreshJob?.id){this.wikiRefreshJob.controller.abort();return {id,state:'cancelled'};}
  const value=this.store.get('wiki-update:'+id);
  if(!value)fail('wiki_update_missing');
  if(method==='cancel'){this.wikiUpdateRun?.id===id&&this.wikiUpdateRun.controller.abort();return visible(value);}
  if(method==='discard'){
    if(!['ready','proposed','failed','cancelled'].includes(value.state))fail('wiki_update_state');
    if(this.wikiUpdateRun?.id===id)fail('wiki_update_busy');
    if(value.copy)await removeCopy(root,value.copy);
    return save(this,{...value,state:'discarded',finishedAt:new Date().toISOString()});
  }
  if(method==='run'||method==='resume'){
    const resuming=method==='resume';
    if(this.wikiRefreshOwner&&this.wikiRefreshProposalId!==id)fail('wiki_update_busy');
    if(resuming?!['failed','cancelled'].includes(value.state):value.state!=='proposed')fail('wiki_update_state');
    if(value.fingerprint!==fingerprint)fail('wiki_update_changed');
    if(this.wikiUpdateRun||this.wikiInitController||this.agent?.running||this.processes?.active.size)fail('wiki_update_busy');
    const controller=new AbortController(),events=resuming?[...(value.events||[])]:[];
    const active={id:value.id,controller,owner,preparing:true,startedAt:new Date().toISOString()};this.wikiUpdateRun=active;
    let copy=value.copy,running;
    const check=()=>{controller.signal.throwIfAborted();if(this.store!==owner||this.root!==root)fail('project_changed');};
    try{
    await requireWikiGit();check();
    // The proposal holds what was stale. A moved HEAD is a different update.
    if(!resuming&&value.status.head&&(await git(root,['rev-parse','HEAD'])).trim()!==value.status.head)fail('wiki_update_changed');
    copy=path.join(owner.directory,'wiki-update',value.id);
    await mkdir(path.dirname(copy),{recursive:true,mode:0o700});
    if((await lstat(path.dirname(copy))).isSymbolicLink())fail('path_scope');
    const originalWiki=resuming?Object.entries(value.resume?.wiki||{}).map(([path,hash])=>({path,hash})):await wikiFiles(root);
    let folderSources;const overlay=new Map(resuming?value.resume?.overlay:[]);
    let resume=value.resume;
    if(resuming){await validateUpdateResume(root,owner,value,{signal:controller.signal});check();}
    else{
    const sourceBasis=fileHashes(await wikiSources(root,{signal:controller.signal}));
    if(value.status.head){
      await wikiPreparationGit(root,['-c','core.hooksPath='+path.join(copy,'.nubi-no-hooks'),'worktree','add','--detach',copy,value.status.head],{signal:controller.signal},'worktree');
      // The copy then holds the sources as the working tree holds them (user decision 2026-10-12): a developer's edits
      // reach the Wiki before a commit, and the status that proposed this update read those same files. A file the
      // snapshot would not read (private, binary, too large) keeps its committed version.
      const ignore=await OpenWikiIgnore.load(root);
      for(const rel of (value.sourceBasis==='remote'?[]:await statusPaths(root)).map(row=>row.path).filter(counted(ignore)).filter(rel=>!privatePath(rel))){
        let file=null,absent=false;try{file=await readWikiSource(root,rel);}catch(error){if(error.message==='source_stale')absent=true;else if(!['file_too_large','binary_file','file_encoding'].includes(error.message))throw error;}
        if(file){await writeWikiSnapshot(copy,[file]);overlay.set(rel,file.hash);}
        else if(absent){await rm(path.join(copy,rel),{force:true});overlay.set(rel,null);}
      }
      // Files the snapshot never reads (.env, keys, credentials) leave the copy too, as the initialization snapshot leaves them out.
      for(const rel of (await git(copy,['ls-files','-z'])).split('\0').filter(Boolean).filter(privatePath)){await rm(path.join(copy,rel),{force:true});overlay.set(rel,null);}
    }
    else{folderSources=await wikiSources(root,{signal:controller.signal});await snapshotFolderHistory(owner.directory,folderSources,copy,{signal:controller.signal});}
    // Newly generated or edited Wiki files may not be committed. Give OpenWiki
    // the current pages and provenance, never an older/empty HEAD copy.
    await rm(path.join(copy,'openwiki'),{recursive:true,force:true});
    await writeWikiSnapshot(copy,originalWiki);
    if(!this.wikiUpdater){await prepareNativeWikiCopy(copy);check();}
    resume={schema:1,head:await wikiSourceHead(root),sources:sourceBasis,wiki:fileHashes(originalWiki),copyHead:(await git(copy,['rev-parse','HEAD'])).trim(),copySources:fileHashes(await wikiSources(copy,{signal:controller.signal})),overlay:[...overlay],generated:false};
    // Source edits during preparation cannot silently become the resume basis.
    if(resume.head!==value.status.head||!sameHashes(sourceBasis,fileHashes(await wikiSources(root,{signal:controller.signal}))))fail('wiki_update_sources_changed');
    }
    check();
    if(this.wikiRefreshJob?.controller.signal.aborted)fail('wiki_refresh_cancelled');
    check();
    running={...value,state:'running',copy,resume,resumed:resuming,startedAt:new Date().toISOString(),events};
    delete running.error;delete running.finishedAt;
    save(this,running);
    active.preparing=false;
    const runner=this.wikiUpdater||defaultWikiUpdater(this);
    const finish=async patch=>{
      const pageProgress=await retainedPageProgress(copy);
      const current={...running,...(owner.db.isOpen?owner.get('wiki-update:'+value.id):{}),...patch,...(pageProgress?{pageProgress}:{}),events:events.slice(-EVENTS),finishedAt:new Date().toISOString()};
      if(owner.db.isOpen){owner.set('wiki-update:'+value.id,current);notifyWikiCompleted(this,current,{root,projectId});}if(this.wikiUpdateRun===active)this.wikiUpdateRun=null;
    };
    Promise.resolve().then(async()=>{
      let lastSaved=0;
      const result=resume.generated?resume.result:await runner({root:copy,language:value.status.lastUpdate.language,signal:controller.signal,updateId:value.id,onEvent:event=>{
        events.push({...event,at:new Date().toISOString()});if(events.length>EVENTS)events.splice(0,events.length-EVENTS);
        if(owner.db.isOpen&&Date.now()-lastSaved>250){owner.set('wiki-update:'+value.id,{...running,events:[...events]});lastSaved=Date.now();}
      }});
      if(!resume.generated){resume={...resume,generated:true,result:result||{},copySources:fileHashes(await wikiSources(copy,{signal:controller.signal}))};running={...running,resume};if(owner.db.isOpen)owner.set('wiki-update:'+value.id,running);}
      if(controller.signal.aborted||this.store!==owner||this.root!==root)return finish({state:'cancelled'});
      // The checkpoint names the sources this run read; the status reads it for uncommitted edits since.
      // The receipt describes the original sources, not the runner's managed
      // AGENTS snippets, which are intentionally never applied to the project.
      await checkpointSnapshotWiki(copy,Object.entries(resume.sources).map(([path,hash])=>({path,hash})),{gitHead:resume.head});
      const {changes,outside}=await changesOf(copy,overlay);
      // Compare with the actual Wiki snapshot, including deletions of pages that
      // were never committed. Capture conflict hashes before the model ran.
      const before=new Map(originalWiki.map(file=>[file.path,file])),after=new Map((await wikiFiles(copy)).map(file=>[file.path,file]));
      changes.length=0;
      for(const rel of new Set([...before.keys(),...after.keys()]))if(before.get(rel)?.hash!==after.get(rel)?.hash)changes.push({path:rel,change:!after.has(rel)?'deleted':!before.has(rel)?'added':'modified'});
      const base={};for(const change of changes)base[change.path]=before.get(change.path)?.hash??null;
      // The runner reports whether preflight proved no generation was needed, and whether the source moved during the run.
      const ready={state:'ready',changes,outside,outsideEvidence:await outsideEvidence(root,copy,changes,outside),base,result:{skipped:result?.skipped===true,...(result?.sourceChanged?{sourceChanged:true}:{})}};
      ready.fingerprint=hash(JSON.stringify([value.id,changes,base]));
      return finish(ready);
    }).catch(error=>finish(controller.signal.aborted?{state:'cancelled'}:{state:'failed',error:wikiInitializationError(error,'planning')}));
    return visible(running);
    }catch(error){
      if(this.wikiUpdateRun===active)this.wikiUpdateRun=null;
      // Preparation never clears an already retained copy. A failed first
      // preparation can be explicitly discarded along with the proposal.
      if(owner.db.isOpen&&!resuming)owner.set('wiki-update:'+value.id,{...value,copy,state:'failed',error:wikiInitializationError(error,'snapshot_git'),finishedAt:new Date().toISOString()});
      throw error;
    }
  }
  if(method==='apply'){
    if(value.state!=='ready')fail('wiki_update_state');
    if(value.fingerprint!==fingerprint)fail('wiki_update_changed');
    // A page changed in the workspace since the run is the user's: nothing is overwritten.
    for(const change of value.changes)if(await fileHash(root,change.path)!==value.base[change.path])fail('wiki_update_conflict');
    for(const change of value.changes){
      let parent=root;for(const segment of change.path.split('/').slice(0,-1)){parent=path.join(parent,segment);await mkdir(parent,{recursive:true});await scopedFile(root,path.relative(root,parent).split(path.sep).join('/'));}
      const target=await scopedFile(root,change.path,{newFile:true});
      if(change.change==='deleted'){await unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});continue;}
      await mkdir(path.dirname(target),{recursive:true});
      await writeFile(target,await readFile(path.join(value.copy,change.path)));
    }
    await removeCopy(root,value.copy);
    this.store.event('wiki_update_applied',{id:value.id,files:value.changes.length});
    const applied=save(this,{...value,state:'applied',appliedAt:new Date().toISOString()});notifyWikiCompleted(this,applied,{root,projectId});return applied;
  }
  fail('wiki_update_invalid');
}
