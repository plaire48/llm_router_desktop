// Evaluation limits are not production task limits. A test must terminate even
// when its subject hangs or asks repeatedly to recover. Never approve that HITL.
export const EVALUATION_LIMITS = Object.freeze({timeoutMs: 600000, maxModelCalls: 80, maxActions: 120});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function driveEvaluationRun({run, execute, interaction, approveTransactions = false, limits = EVALUATION_LIMITS, pollMs = 20}) {
  const budget = {...EVALUATION_LIMITS, ...limits};
  if (Object.values(budget).some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('evaluation_invalid_budget');
  const handled = new Set(); let timer, expired = false;
  const deadline = new Promise((_, reject) => {timer = setTimeout(() => {expired = true; run.cancel(); reject(new Error('evaluation_case_timeout'));}, budget.timeoutMs);});
  const bounded = value => Promise.race([value, deadline]);
  try {
    while (run.status().state === 'running') {
      const state = run.status(), action = state.action;
      if ((state.metrics?.modelCalls || 0) > budget.maxModelCalls) throw new Error('evaluation_model_budget');
      if (action) {
        if (handled.has(action.callId)) throw new Error('evaluation_action_repeated');
        if (handled.size >= budget.maxActions) throw new Error('evaluation_action_budget');
        handled.add(action.callId);
        let result;
        if (action.name === 'show_plan') result = {displayed: true};
        else if (action.name === 'request_approval') {
          if (action.payload?.kind === 'recovery') throw new Error('evaluation_recovery_requires_human');
          if(!approveTransactions)throw new Error('evaluation_approval_required');
          result=action.payload?.kind==='edit'?{approved:true}:interaction?.(action);
          if(result?.approved!==true)throw new Error('evaluation_approval_required');
        } else if (action.name === 'request_input') {
          result=interaction?.(action);if(typeof result?.text!=='string')throw new Error('evaluation_interaction_requires_human');
        }
        else result = await bounded(execute(action));
        if (!expired && run.status().state === 'running') run.respond(action.callId, result);
      }
      await bounded(pause(pollMs));
    }
    await bounded(run.promise);
    if (expired) throw new Error('evaluation_case_timeout');
    if ((run.status().metrics?.modelCalls || 0) > budget.maxModelCalls) throw new Error('evaluation_model_budget');
    return run.status();
  } catch (error) {
    run.cancel();
    // Consume cancellation rejections without waiting indefinitely for the SUT.
    Promise.resolve(run.promise).catch(() => {});
    throw error;
  } finally {clearTimeout(timer);}
}
