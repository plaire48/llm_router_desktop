// One actionable invitation per conversation. Every later gate gets its own ID.
// Merely opening a notice must never choose, approve, apply, bind or resume.
export function humanDecisions(project,{computerUse=false}={}){
 if(!project?.projectId)return [];
 const output=[];
 for(const task of project.tasks||[]){
  if(['running','cancelled'].includes(task.state))continue;
  let decision;
  const found=(rows,predicate)=>rows?.find(row=>row.taskId===task.id&&predicate(row));
  if(task.state==='waiting_input'&&task.question)decision={kind:'question',localId:task.question.id||task.id};
  else if(computerUse&&['pending','connected'].includes(task.computerConnectionRequest?.state))decision={kind:'computer',localId:task.computerConnectionRequest.id+':'+task.computerConnectionRequest.state};
  else {
   const proposal=found(project.proposals,row=>row.state==='proposed');
   const setup=found(project.setupActions,row=>row.state==='proposed'&&!(row.afterProposals||[]).some(id=>project.proposals?.some(p=>p.id===id&&p.state==='proposed')));
   const repair=found(project.commandRepairs,row=>row.state==='proposed');
   const computer=computerUse&&found(project.computer?.actions,row=>(['proposed','attention'].includes(row.state)||row.state==='observed'&&!['running','finished'].includes(row.review?.state)));
   if(proposal)decision={kind:'proposal',localId:proposal.id};
   else if(setup)decision={kind:'command',localId:setup.id};
   else if(repair)decision={kind:'command',localId:repair.id};
   else if(computer)decision={kind:'computer',localId:computer.id+':'+computer.state};
  }
  if(decision)output.push({...decision,taskId:task.id,id:`${project.projectId}:${decision.kind}:${decision.localId}`});
 }
 return output;
}
