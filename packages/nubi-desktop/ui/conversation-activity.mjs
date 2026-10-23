// Locate progress by its host run, never by the latest assistant message alone.
// A question can end a run; a stopped run can end without an answer at all.
export function currentActivityRunId(task) {
  return (task?.state === 'waiting_input' && task.question?.runId) ||
    task?.responseTiming?.runId || task?.checkpoint?.runId || task?.workPlan?.runId;
}

export function conversationActivity(task) {
  const messages = task?.messages || [], before = new Map(), after = new Map(), root = [];
  const runId = currentActivityRunId(task);
  const question = task?.state === 'waiting_input' ? task.question : null;
  const sameRun = message => !message.runId || !runId || message.runId === runId;
  let questionMessage = question?.id && messages.findLast(message => message.role === 'assistant' &&
    message.questionId === question.id && sameRun(message));
  // Older messages may lack questionId. Text alone must never attach a new form
  // to an earlier question: accept only the latest message of this known run.
  const latest = messages.at(-1);
  if (question && !questionMessage && runId && latest?.role === 'assistant' && latest.runId === runId &&
      !latest.questionId && latest.content === (typeof question === 'string' ? question : question.text)) questionMessage = latest;
  const anchors = new Map();
  for (const message of messages) if (message.role === 'assistant' && message.runId && !anchors.has(message.runId)) anchors.set(message.runId, message);
  const add = (map, message, run) => map.set(message, [...(map.get(message) || []), run]);
  // A run that stopped at an approval or a failure and went on in the next run belongs to the same request: it has
  // no answer and no question of its own and it followed the same message. Such runs become predecessors of the run
  // that continued them, so one request shows one plan and one record (2026-10-14). A run nobody continued keeps
  // its place after its message.
  const index = new Map(messages.map((message, at) => [message.id, at]));
  const requestOf = at => {for (let i = Math.min(at, messages.length - 1); i >= 0; i--) if (messages[i].role === 'user') return messages[i].id; return null;};
  const pending = new Map();
  const takePredecessors = key => {const runs = pending.get(key) || []; pending.delete(key); return runs;};
  for (const run of task?.activityHistory || []) {
    if (run.runId === runId) continue;
    const questionAnchor = run.question?.id && messages.findLast(message => message.role === 'assistant' &&
      message.questionId === run.question.id && (!message.runId || message.runId === run.runId));
    const preceding = messages.find(message => message.id === run.afterMessageId);
    const anchor = questionAnchor || (!run.question?.id || !preceding ? anchors.get(run.runId) : null);
    if (!anchor && !run.question?.id && preceding) {pending.set(run.afterMessageId, [...(pending.get(run.afterMessageId) || []), run]); continue;}
    const predecessors = anchor ? takePredecessors(requestOf(index.get(anchor.id) - 1)) : [];
    const placed = predecessors.length ? {...run, predecessors} : run;
    if (task.id && run.responseTiming?.afterMessageId===task.id) root.push(placed);
    else if (run.responseTiming?.afterMessageId && preceding) add(after, preceding, placed);
    else if (anchor) add(before, anchor, placed);
    else if (preceding) add(after, preceding, placed);
    else root.push(placed);
  }
  // A question changes the live control, never the originating position of its
  // plan/record. Only the decision form is presented at the conversation foot.
  const timing = runId && task?.responseTiming?.runId===runId ? task.responseTiming : null;
  const started=Date.parse(timing?.startedAt||'');
  const afterMessage = messages.find(message=>message.id===timing?.afterMessageId) ||
    (Number.isFinite(started) ? messages.findLast(message=>message.role==='user'&&Date.parse(message.at||'')<=started) : null);
  const atStart = timing?.afterMessageId===task?.id && !!task?.id;
  const anchor = afterMessage || atStart ? null : question ? questionMessage || null : anchors.get(runId);
  const predecessors = runId ? takePredecessors(afterMessage ? requestOf(index.get(afterMessage.id)) : anchor ? requestOf(index.get(anchor.id) - 1) : requestOf(messages.length - 1)) : [];
  for (const [key, runs] of pending) {const preceding = messages.find(message => message.id === key); for (const run of runs) {if (preceding) add(after, preceding, run); else root.push(run);}}
  return {runId, before, after, root, anchor, afterMessage, atStart, questionMessage, predecessors};
}
