// Reuse project-switch cancellation and dirty-editor protection. Opening a toast
// selects a saved conversation only; it cannot submit, resume or approve work.
export async function openAnswerNotice(event,{currentProjectId,switchProject,readTask,present}){
  if(event?.type!=='answer_open'||![event.projectId,event.taskId,event.runId].every(id=>typeof id==='string'&&/^[\w-]{1,100}$/.test(id)))return false;
  if(currentProjectId()!==event.projectId)await switchProject(event.projectId,event.workspaceKind);
  if(currentProjectId()!==event.projectId)return false;
  const task=await readTask(event.taskId);
  if(currentProjectId()!==event.projectId||task?.id!==event.taskId)return false;
  present({target:'answer',projectId:event.projectId,task});return true;
}
