export async function openWikiNotice(event,{currentProjectId,switchProject,present}){
  if(event?.type!=='wiki_open'||![event.projectId,event.jobId].every(id=>typeof id==='string'&&/^[\w-]{1,100}$/.test(id))||!['created','ready','applied'].includes(event.phase))return false;
  if(currentProjectId()!==event.projectId)await switchProject(event.projectId);
  if(currentProjectId()!==event.projectId)return false;
  present({target:event.phase==='ready'?'wiki-update':'wiki',projectId:event.projectId,jobId:event.jobId});return true;
}
