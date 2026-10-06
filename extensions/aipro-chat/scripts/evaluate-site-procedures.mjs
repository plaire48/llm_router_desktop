// Focused before/after experiment using the existing browser evaluator and
// task data. Authentication stays in its dedicated profile. No token import.
import {spawn} from 'node:child_process';
import {writeFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve('verification/site-procedures-2026-10-01'),profile=process.env.NUBI_EVAL_REUSE_PROFILE;
if(!profile)throw Error('dedicated_evaluation_profile_required');
const jobs=[['before-warm-luna','gpt-5.6-luna','before',false],['before-warm-sol','gpt-5.6-sol','before',false],['after-sol','gpt-5.6-sol','after',true],['after-luna','gpt-5.6-luna','after',true]];
const queue={version:1,status:'waiting_for_prior_evaluation',scope:'real-model-on-existing-synthetic-pages',repeats:5,jobs:[]};
const save=()=>writeFile(resolve(root,'queue.json'),JSON.stringify(queue,null,2));await save();
// Wait only for the user's already authorized run in this dedicated profile.
while(await lstat(resolve(profile,'SingletonLock')).catch(()=>null))await new Promise(done=>setTimeout(done,2000));
for(const [name,model,candidate,regression] of jobs){
 if(process.env.NUBI_EVAL_QUEUE_JOBS && !process.env.NUBI_EVAL_QUEUE_JOBS.split(',').includes(name))continue;
 const job={name,model,candidate,startedAt:new Date().toISOString(),status:'running',log:resolve(root,name+'.log')};queue.jobs.push(job);queue.status='running';await save();
 const {open}=await import('node:fs/promises'),log=await open(job.log,'w');
 const env={...process.env,NUBI_EVAL_MODEL:model,NUBI_EVAL_CANDIDATE_ARCHIVE:resolve(root,candidate+'.zip'),NUBI_EVAL_KEEP_PROFILE:'1',NUBI_EVAL_FIXTURE_APPROVALS:'1',NUBI_EVAL_RESULT_HOLD_MS:'5000',NUBI_EVAL_KNOWLEDGE_PROBE:'E-09',NUBI_EVAL_SITE_REPEATS:'5',NUBI_EVAL_LINK_PROCEDURE:'1'};
 delete env.NUBI_EVAL_ATTACH_REPORT;delete env.NUBI_EVAL_KEEP_BROWSER;
 if(regression){env.NUBI_EVAL_ENVIRONMENT='local-fixture';delete env.NUBI_EVAL_TASK_IDS;}else{env.NUBI_EVAL_TASK_IDS='E-09';delete env.NUBI_EVAL_ENVIRONMENT;}
 const child=spawn(process.execPath,['scripts/evaluate-browser-30.mjs'],{env,stdio:['ignore',log.fd,log.fd]});
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done);});await log.close();
 Object.assign(job,{finishedAt:new Date().toISOString(),exitCode:code,status:code===0?'recorded':'failed'});await save();
 if(code!==0){queue.status='stopped';await save();throw Error('evaluation_job_failed:'+name);}
 // Never launch another owner while an interrupted evaluator preserves its browser.
 if(await lstat(resolve(profile,'SingletonLock')).catch(()=>null)){queue.status='browser_attention_required';await save();throw Error('evaluation_browser_preserved:'+name);}
}
queue.status='recorded';await save();
