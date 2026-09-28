import {INPUT_TEXT_LIMIT, validateAnswer} from '../worker/input-contract.mjs';

// The form stays mounted until the worker acknowledges this exact answer.
// Recoverable validation failures never consume the pending question.
export function createInputDelivery(action, {deliver, cancelled, onAccepted}) {
  let resolve, reject, sending = false, settled = false;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  function cancel() {if (!settled) {settled = true; resolve({cancelled: true});}}
  async function choose(choice) {
    if (settled || sending || cancelled() || choice?.questionId !== action.callId) return false;
    const text = choice.text ?? action.payload.options?.find(option => option.id === choice.optionId)?.label;
    validateAnswer({text}, action.payload.inputLimit ?? INPUT_TEXT_LIMIT);
    sending = true;
    try {
      await deliver({text});
      if (settled || cancelled()) {cancel(); return false;}
      settled = true; onAccepted(text); resolve({delivered: true}); return true;
    } catch (error) {
      if (cancelled()) cancel();
      else if (!['invalid_question', 'input_context_limit'].includes(error.message)) {settled = true; reject(error);}
      throw error;
    } finally {sending = false;}
  }
  return {promise, choose, cancel};
}
