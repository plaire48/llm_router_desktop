export function validEvaluationAttachment({attachment, reuseProfile, candidateSha256, plannedTaskIds, publicReadPages, fixtureApprovals, suite30, selectedTasks, freshAfterInterruption, repeatRecorded, unrunRemainder, modelComparison, retryUnsent, model}) {
  if (retryUnsent) return !!reuseProfile && suite30 && !fixtureApprovals && !freshAfterInterruption && !repeatRecorded && !unrunRemainder && !modelComparison &&
    attachment?.candidateSha256===candidateSha256 && attachment.model===model && /^[a-f0-9]{64}$/.test(attachment.evaluatorSha256||'') &&
    selectedTasks.every(task=>task.environment==='public-live'&&task.readOnly) &&
    JSON.stringify(attachment.publicReadCapture?.allowedPages)===JSON.stringify(publicReadPages) &&
    JSON.stringify(attachment.plannedTaskIds)===JSON.stringify(plannedTaskIds) &&
    Array.isArray(attachment.trials) && attachment.trials.length===plannedTaskIds.length &&
    attachment.trials.every((trial,index)=>trial.id===plannedTaskIds[index]&&trial.status==='runner_error'&&trial.modelRequests===0&&!trial.submission);
  if (modelComparison) {
    const fullSuite=['E','M','H'].flatMap(level=>Array.from({length:10},(_,index)=>`${level}-${String(index+1).padStart(2,'0')}`));
    return !!reuseProfile && suite30 && !freshAfterInterruption && !repeatRecorded && !unrunRemainder &&
      attachment?.candidateSha256 === candidateSha256 && attachment.status === 'trials_recorded' &&
      ['gpt-5.6-sol','gpt-5.6-luna'].every(value=>[model,attachment.model].includes(value)) &&
      /^[a-f0-9]{64}$/.test(attachment.evaluatorSha256 || '') &&
      Array.isArray(attachment.trials) && attachment.trials.length > 0 &&
      attachment.trials.every(trial=>['answered','agent_error','awaiting_user'].includes(trial.status)||trial.status==='timeout'&&trial.stopConfirmed===true) &&
      JSON.stringify(plannedTaskIds) === JSON.stringify(fullSuite) &&
      JSON.stringify(selectedTasks.map(task=>task.id)) === JSON.stringify(fullSuite) &&
      JSON.stringify(attachment.publicReadCapture?.allowedPages) === JSON.stringify(publicReadPages) &&
      (!fixtureApprovals || attachment.operatorSetup?.fixtureTransferApprovals === true);
  }
  // Recover the evaluation screen, not an interrupted agent operation. Never
  // replay a recorded task, including a fixture whose write outcome is unknown.
  if (unrunRemainder) {
    const recorded = new Set((attachment?.trials || []).map(trial => trial.id));
    const remaining = attachment?.plannedTaskIds?.filter(id => !recorded.has(id));
    return !!reuseProfile && suite30 && !freshAfterInterruption && !repeatRecorded &&
      attachment?.candidateSha256 === candidateSha256 && attachment.model === model &&
      /^[a-f0-9]{64}$/.test(attachment.evaluatorSha256 || '') &&
      ['setup_error', 'interrupted'].includes(attachment.status) &&
      Array.isArray(attachment.trials) && Array.isArray(remaining) && remaining.length > 0 &&
      JSON.stringify(remaining) === JSON.stringify(plannedTaskIds) &&
      JSON.stringify(selectedTasks.map(task => task.id)) === JSON.stringify(plannedTaskIds) &&
      JSON.stringify(attachment.publicReadCapture?.allowedPages) === JSON.stringify(publicReadPages) &&
      (!fixtureApprovals || attachment.operatorSetup?.fixtureTransferApprovals === true);
  }
  if (!reuseProfile || attachment.candidateSha256 !== candidateSha256 ||
      !(freshAfterInterruption ? publicReadPages.every(page => attachment.publicReadCapture?.allowedPages?.includes(page)) :
        JSON.stringify(attachment.publicReadCapture?.allowedPages) === JSON.stringify(publicReadPages)) ||
      !/^[a-f0-9]{64}$/.test(attachment.evaluatorSha256) || fixtureApprovals || !suite30 ||
      selectedTasks.some(task => task.environment !== 'public-live' || !task.readOnly)) return false;
  // A new measured trial, never continuation of the saved task. Only completed
  // evaluations of the identical public read-only suite may reuse the browser.
  if (repeatRecorded) return !freshAfterInterruption && attachment.status === 'trials_recorded' &&
    JSON.stringify(attachment.plannedTaskIds) === JSON.stringify(plannedTaskIds) &&
    attachment.trials?.length === plannedTaskIds.length &&
    attachment.trials.every((trial,index) => trial.id === plannedTaskIds[index] &&
      (trial.status === 'answered' || trial.status === 'timeout' && trial.stopConfirmed === true));
  if (freshAfterInterruption) return attachment.status === 'harness_interrupted' &&
    plannedTaskIds.length > 0 && plannedTaskIds.every(id => attachment.trials?.some(trial => trial.id === id && trial.status === 'harness_interrupted'));
  return attachment.status === 'login_not_completed' && attachment.trials?.length === 0 &&
    JSON.stringify(attachment.plannedTaskIds) === JSON.stringify(plannedTaskIds);
}
