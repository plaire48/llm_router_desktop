import path from 'node:path';

// Only called after a newly finished job is persisted, never by status reads.
export function notifyWikiCompleted(service,job,{root=service.root,projectId=service.projectId}={}){
  if(typeof service.notifyWiki!=='function'||!['completed','ready','applied'].includes(job?.state)||!job.id||job.error)return;
  const phase=job.state==='completed'?'created':job.state;
  try{Promise.resolve(service.notifyWiki({projectId,jobId:job.id,phase,projectName:path.basename(root),
    ...(phase==='created'?{pages:job.pages}: {files:job.changes?.length})})).catch(()=>{});}catch{/* Notification failures must not fail saved work. */}
}
