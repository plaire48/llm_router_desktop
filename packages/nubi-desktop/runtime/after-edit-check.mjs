import {fail,readSource} from './files.mjs';
import {shellProfiles} from './processes.mjs';
import {requireChosenShell,prepareSetupAction} from './setup-actions.mjs';
import {afterEditCheckAction} from './development-workflow.mjs';

// Host-only classification. A newly edited manifest cannot certify its own command.
async function changesCheckDefinition(workspace,paths){
  if(paths.some(p=>/(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(p)))return true;
  let manifest;
  try{manifest=JSON.parse((await readSource(workspace,'package.json')).content);}
  catch(error){return error.code!=='ENOENT';}
  const scripts=Object.values(manifest?.scripts||{}).filter(v=>typeof v==='string').map(v=>v.replace(/\\/g,'/'));
  // Include quoted paths and script entry points. Conservative matches require a
  // card rather than trying to interpret shell syntax as a second command runner.
  return paths.some(p=>scripts.some(script=>script.includes(p.replace(/\\/g,'/'))));
}

export async function setAfterEditCheck(service,{projectId,profile,script}){
  service.ready();
  if(projectId!==service.projectId)fail('project_changed');
  if(service.afterEditChecks?.size||service.agent?.running||service.setupBusy)fail('agent_busy');
  if(typeof script!=='string'||script.length>16000||script.includes('\0'))fail('input_invalid');
  const owner=service.store;
  let setting=null;
  if(script.trim()){
    const profiles=await shellProfiles();
    if(!profiles.some(p=>p.id===profile))fail('shell_unavailable');
    requireChosenShell(profiles,service.shellPreference(),profile);
    setting={profile,script:script.trim()};
  }
  if(owner!==service.store||projectId!==service.projectId||service.disposed)fail('project_changed');
  if(service.afterEditChecks?.size||service.agent?.running||service.setupBusy)fail('agent_busy');
  // Enabling this setting does not retroactively run commands for old edits.
  if(!owner.get('setting:after-edit-check')&&setting)owner.set('setting:after-edit-check-baseline',owner.list('proposal:').filter(p=>p.state==='applied').map(p=>p.id));
  owner.set('setting:after-edit-check',setting);
  // Saving the setting is a fresh user choice. Pending cards retain their own
  // flags; later batches use this setting's definition-change history.
  owner.set('setting:after-edit-check-untrusted',[]);
  if(!setting)for(const task of owner.list('task:').filter(t=>t.afterEditCheckError)){
    const {afterEditCheckError,afterEditCheckPath,...rest}=task;owner.set('task:'+task.id,rest);
  }
  return setting;
}

// Reserve before any await. The normal command card still owns execution and
// approval; this journal only prevents repeated confirmation from queuing it twice.
export function queueAfterEditCheck(service,taskId){
  service.afterEditChecks ||= new Map();
  if(service.afterEditChecks.has(taskId))return service.afterEditChecks.get(taskId).then(()=>queueAfterEditCheck(service,taskId));
  const owner=service.store;
  const promise=Promise.resolve().then(async()=>{
    const setting=owner.get('setting:after-edit-check');
    if(!setting||service.disposed||service.task(taskId).state==='cancelled')return null;
    const proposals=owner.list('proposal:').filter(p=>p.taskId===taskId);
    if(proposals.some(p=>['proposed','creating','attention'].includes(p.state)))return null;
    const consumed=new Set([...(owner.get('setting:after-edit-check-baseline')||[]),...owner.list('after-edit-check:').filter(r=>r.taskId===taskId).flatMap(r=>r.proposalIds)]);
    const applied=proposals.filter(p=>p.state==='applied'&&!consumed.has(p.id));
    if(!applied.length)return null;
    const latest=new Map();
    for(const p of [...applied].sort((a,b)=>(a.appliedAt||'').localeCompare(b.appliedAt||'')||(a.createdAt||'').localeCompare(b.createdAt||'')))latest.set(p.path,p);
    const {after,taskId:_,...args}=afterEditCheckAction({setting,applied:[...latest.values()],taskId});
    const workspace=await service.target(taskId),references=[],files=new Map();
    for(const p of latest.values()){
      const source=await readSource(workspace,p.path);
      if(source.hash!==p.afterHash)throw Object.assign(Error('source_stale'),{details:{path:p.path}});
      references.push({path:p.path,hash:source.hash});files.set(p.path,{hash:source.hash});
    }
    const changed=await changesCheckDefinition(workspace,[...latest.keys()]);
    if(owner!==service.store||service.disposed||service.task(taskId).state==='cancelled')fail('setup_cancelled');
    const untrusted=new Set(owner.get('setting:after-edit-check-untrusted')||[]);
    if(changed){untrusted.add(workspace);owner.set('setting:after-edit-check-untrusted',[...untrusted]);}
    const manifestChanged=untrusted.has(workspace);
    if(manifestChanged)for(const journal of owner.list('after-edit-check:')){
      const pending=owner.get('setup-action:'+journal.actionId);
      if(pending?.workspace===workspace&&pending.state==='proposed')owner.set('setup-action:'+pending.id,{...pending,manifestChanged:true});
    }
    // The model schema remains capped at ten observed references. A host batch
    // carries all verified paths through the same hash/approval checks.
    const action=await prepareSetupAction(service,taskId,{...args,references:references.slice(0,10)},{files},references.slice(10));
    if(manifestChanged){action.manifestChanged=true;owner.set('setup-action:'+action.id,action);}
    owner.set('after-edit-check:'+action.id,{taskId,actionId:action.id,proposalIds:[...new Set([...(owner.get('after-edit-check:'+action.id)?.proposalIds||[]),...applied.map(p=>p.id)])]});
    const {afterEditCheckError,afterEditCheckPath,...task}=service.task(taskId);owner.set('task:'+taskId,task);
    return action;
  }).catch(error=>{
    if(owner===service.store&&!service.disposed){
      const task=owner.get('task:'+taskId);
      const code=/^[a-z_]{3,60}$/.test(error.message)?error.message:'check_prepare_failed',path=typeof error.details?.path==='string'?error.details.path:undefined;
      if(task)owner.set('task:'+taskId,{...task,afterEditCheckError:code,afterEditCheckPath:path});
      owner.event('after_edit_check_failed',{taskId,code,path});
    }
    // A failed check preparation must never turn an already confirmed file write
    // into an ambiguous apply failure or cause the edit to be sent again.
    return null;
  }).finally(()=>service.afterEditChecks.delete(taskId));
  service.afterEditChecks.set(taskId,promise);return promise;
}
