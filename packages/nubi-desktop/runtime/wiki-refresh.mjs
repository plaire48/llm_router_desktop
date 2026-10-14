import path from 'node:path';
import {git,gitOpenFailure} from './files.mjs';

// Match the configured upstream, never reset, stash, push or merge local commits.
// Do not expose Git stderr: remote URLs can contain credentials.
export async function pullSources(root,{signal,run=git}={}){
  let remotes='';
  try{remotes=(await run(root,['remote'])).trim();}
  catch(error){return {attempted:false,reason:gitOpenFailure(error)};}
  if(!remotes)return {attempted:false,reason:'no_remote'};
  const failure=reason=>({attempted:true,ok:false,reason});
  try{
    const branch=(await run(root,['symbolic-ref','--quiet','--short','HEAD'])).trim();
    const remote=(await run(root,['config','--get',`branch.${branch}.remote`]).catch(()=>'' )).trim();
    const merge=(await run(root,['config','--get',`branch.${branch}.merge`]).catch(()=>'' )).trim();
    if(!remote||!merge.startsWith('refs/heads/')||!remotes.split('\n').includes(remote))return failure('git_upstream_missing');
    const rows=(await run(root,['status','--porcelain','-z','--untracked-files=all'])).split('\0');
    for(let i=0;i<rows.length;i++){
      const row=rows[i];if(!row)continue;
      const renamed=/^[RC]/.test(row),rel=row.slice(3),old=renamed?rows[++i]:null;
      if(!rel.startsWith('openwiki/')||old&&!old.startsWith('openwiki/'))return failure('git_local_changes');
    }
    const options={timeout:180000,signal,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}};
    await run(root,['-c','core.hooksPath='+path.join(root,'.git','nubi-no-hooks'),'fetch','--no-tags',remote],options);
    const target=(await run(root,['rev-parse','--verify','@{upstream}^{commit}'])).trim();
    const [ahead,behind]=(await run(root,['rev-list','--left-right','--count','HEAD...'+target])).trim().split(/\s+/).map(Number);
    if(ahead)return failure(behind?'git_diverged':'git_local_ahead');
    if(behind)await run(root,['-c','core.hooksPath='+path.join(root,'.git','nubi-no-hooks'),'merge','--ff-only','--no-edit',target],options);
    if((await run(root,['rev-parse','HEAD'])).trim()!==target)return failure('git_source_changed');
    return {attempted:true,ok:true,changed:behind>0,head:target};
  }catch(error){
    const detail=String(error?.stderr||error?.message||'');
    return failure(error?.killed?'git_timeout':/symbolic ref|no upstream|does not point to a branch/i.test(detail)?'git_upstream_missing':/not possible to fast-forward|diverg/i.test(detail)?'git_diverged':/could not read|authentication|permission denied|terminal prompts disabled/i.test(detail)?'git_auth':'git_pull_failed');
  }
}
