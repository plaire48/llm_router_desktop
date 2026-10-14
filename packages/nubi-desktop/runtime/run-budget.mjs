// A run ends on its own when the model keeps working past these (spec 2026-10-15, bundle 3.3): below the evaluation
// limits (80 calls, 20 min) so a product run never runs into them. The last call has no tools and asks for a wrap-up.
export const RUN_BUDGET=Object.freeze({actorCalls:60,wallMs:20*60*1000});
export const WRAP_UP='Budget reached: answer now with no further tool calls. State what was done with its evidence, what remains, and the next concrete step. Do not claim completion of unverified work.';
export function createRunBudget({calls=RUN_BUDGET.actorCalls,wallMs=RUN_BUDGET.wallMs,now=()=>performance.now()}={}){
  const began=now();let used=0;
  return {note(){used++;},reached(){return used>=calls||now()-began>=wallMs;},facts(){return {calls:used,elapsedMs:Math.round(now()-began)};}};
}
