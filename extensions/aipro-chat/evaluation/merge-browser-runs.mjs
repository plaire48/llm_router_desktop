// Derived evidence only. Originals and unsuccessful technical attempts remain
// in provenance; model/task failures must never be replaced with a later win.
export function mergeBrowserRuns(tasks, sources, {technicalRetries=[]}={}) {
  if(!sources.length)throw Error('missing_sources');
  const first=sources[0].report, selected=new Map(), provenance=[];
  const retries=new Set(technicalRetries);
  for(const source of sources){
    const report=source.report;
    if(!/^[a-f0-9]{64}$/.test(source.sha256||'') || report.suite!=='browser-30-v1' ||
      report.candidateSha256!==first.candidateSha256 || report.model!==first.model || report.provider!==first.provider ||
      !['trials_recorded','interrupted','setup_error'].includes(report.status))throw Error('incompatible_evidence');
    provenance.push({path:source.path,sha256:source.sha256,runId:report.runId,status:report.status,evaluatorSha256:report.evaluatorSha256});
    for(const trial of report.trials){
      const task=tasks.find(task=>task.id===trial.id);
      if(!task || trial.goal!==task.goal || trial.model!==first.model || trial.status==='running')throw Error('incompatible_trial');
      const prior=selected.get(trial.id);
      if(prior){
        if(!retries.has(trial.id) || prior.trial.status!=='runner_error' || task.environment!=='public-live' || !task.readOnly || trial.status==='runner_error')throw Error('duplicate_trial');
        selected.set(trial.id,{trial,source:source.path,technicalAttempt:{source:prior.source,status:prior.trial.status,modelRequests:prior.trial.modelRequests,runnerError:prior.trial.runnerError}});
        retries.delete(trial.id);
      }else selected.set(trial.id,{trial,source:source.path});
    }
  }
  if(retries.size || selected.size!==tasks.length || tasks.some(task=>!selected.has(task.id)))throw Error('incomplete_evidence');
  return {...first,status:'derived_composite',runId:null,plannedTaskIds:tasks.map(task=>task.id),taskCount:tasks.length,plannedTrials:tasks.length,
    completedTrials:tasks.length,accuracy:null,accuracyStatus:'independent_grading_required',
    derivedAt:new Date().toISOString(),provenance,technicalRetries:tasks.flatMap(task=>selected.get(task.id).technicalAttempt?[{id:task.id,...selected.get(task.id).technicalAttempt,replacementSource:selected.get(task.id).source}]:[]),
    trials:tasks.map(task=>({...selected.get(task.id).trial,evidenceReport:selected.get(task.id).source})),
    note:'Fixed-candidate composite of disjoint trials. Listed public read-only runner failures retain their original records and technical retry provenance; no model failure is replaced.'};
}
