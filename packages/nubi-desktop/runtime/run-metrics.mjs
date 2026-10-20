// Per-run cost telemetry. Stores sizes, counts and typed codes only: never
// message bodies, tool arguments or tool results. A recording failure must
// never change the run under measurement.
import {contextTokens} from '../../../extensions/aipro-chat/context-manager.js';

// wiki_update: an OpenWiki update that the user approved, apart from any task.
export const METRIC_PURPOSES = Object.freeze(['actor', 'planner', 'reviewer', 'summary', 'analysis', 'research', 'document', 'wiki_update']);
export const METRIC_TRIGGERS = Object.freeze(['history', 'threshold', 'overflow']);
export const METRIC_KINDS = Object.freeze(['metric_model', 'metric_tool', 'metric_compaction']);
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const code = value => value === undefined || value === null || value === '' ? null : typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : 'unknown';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const textLength = content => typeof content === 'string' ? content.length : JSON.stringify((Array.isArray(content) ? content : []).filter(part => part?.type === 'text')).length;
const imageParts = content => Array.isArray(content) ? content.filter(part => part?.type === 'image_url' || part?.type === 'image').length : 0;

// The newest tool result a request carries, as typed codes only (wiki quality design C10):
// which tool answered and the status/code field of its JSON result. Never the body.
export function latestToolOutcome(messages = []) {
  let last = null;
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index]?.role === 'tool') { last = messages[index]; break; }
  if (!last) return null;
  let tool = null;
  for (const message of messages) for (const call of message?.tool_calls || []) if (call?.id === last.tool_call_id) tool = call.function?.name;
  let status = null, outcome = null;
  try {
    const parsed = typeof last.content === 'string' ? JSON.parse(last.content) : null;
    if (parsed && typeof parsed === 'object') { status = code(parsed.status); outcome = code(parsed.code ?? parsed.error); }
  } catch {
    // A thrown tool error reaches the model as text ('Error: <message>'); keep only a code-shaped message.
    // LangChain wraps a failing tool as "Error invoking tool '<name>' with kwargs {...} with error: <Error>";
    // a tool whose input failed the schema is "Received tool input did not match expected schema".
    const text = typeof last.content === 'string' ? last.content : '';
    const tail = /^Error invoking tool '[^']*' with kwargs [\s\S]*? with error: ([\s\S]{0,200})/.exec(text)?.[1] ?? text;
    const thrown = /^[A-Za-z]*(?:Error|Exception): ([a-z_][a-z0-9_]{0,63})(?![a-z0-9_])/.exec(tail);
    if (/Received tool input did not match expected schema/.test(tail.slice(0, 120))) { status = 'error'; outcome = 'tool_input_schema'; }
    else if (thrown) { status = 'error'; outcome = code(thrown[1]); }
  }
  return {tool: code(tool) || 'unknown', status, code: outcome};
}

export function measureRequest(messages = [], tools = []) {
  let messageCharacters = 0, systemCharacters = 0, imageCount = 0;
  for (const message of messages) {
    const length = textLength(message.content) + JSON.stringify(message.tool_calls || []).length;
    messageCharacters += length; imageCount += imageParts(message.content);
    if (message.role === 'system') systemCharacters += length;
  }
  return {messageCharacters, systemCharacters, toolCharacters: JSON.stringify(tools).length, imageCount, estimatedTokens: contextTokens(messages, tools), lastTool: latestToolOutcome(messages)};
}

function usageFacts(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = count(usage.prompt_tokens), completion = count(usage.completion_tokens), cached = count(usage.prompt_tokens_details?.cached_tokens);
  if (prompt === null && completion === null) return null;
  return {prompt_tokens: prompt, completion_tokens: completion, cached_tokens: cached};
}

export function createRunMetrics({store, taskId, runId, now = () => Date.now()}) {
  let sequence = 0;
  const write = (kind, value) => { try { store.event(kind, {taskId, runId, sequence: ++sequence, ...value}); } catch { /* Telemetry only. */ } };
  try { store.db.prepare("DELETE FROM events WHERE kind LIKE 'metric\\_%' ESCAPE '\\' AND at < ?").run(new Date(now() - RETENTION_MS).toISOString()); } catch { /* Telemetry only. */ }
  return {
    beginModel({purpose, attempt = 1, messages, tools, model}) {
      let facts, started = now(), settled = false;
      try { facts = {purpose: METRIC_PURPOSES.includes(purpose) ? purpose : 'actor', attempt: count(attempt) || 1, model: typeof model === 'string' ? model.slice(0, 200) : null, ...measureRequest(messages, tools)}; } catch { facts = null; }
      const finish = extra => { if (settled || !facts) return; settled = true; write('metric_model', {...facts, elapsedMs: Math.max(0, now() - started), ...extra}); };
      return {
        end(result) { let extra; try { extra = {usage: usageFacts(result?.usage), finishReason: code(result?.finishReason), calls: (result?.calls || []).map(call => code(call?.function?.name)).filter(Boolean), error: null}; } catch { extra = {usage: null, finishReason: null, calls: [], error: null}; } finish(extra); },
        fail(error) { finish({usage: null, finishReason: null, calls: [], error: code(error) || 'unknown'}); },
      };
    },
    beginTool({tool, scope = 'leader'}) {
      const started = now(); let settled = false;
      const finish = extra => { if (settled) return; settled = true; write('metric_tool', {tool: code(tool) || 'unknown', scope: scope === 'child' ? 'child' : 'leader', elapsedMs: Math.max(0, now() - started), ...extra}); };
      return {
        end(result) { let extra; try { const {image, ...rest} = result && typeof result === 'object' ? result : {}; extra = {resultCharacters: JSON.stringify(rest).length, imageCount: image ? 1 : 0, error: code(rest.error)}; } catch { extra = {resultCharacters: null, imageCount: 0, error: 'unknown'}; } finish(extra); },
        fail(error) { finish({resultCharacters: 0, imageCount: 0, error: code(error) || 'unknown'}); },
      };
    },
    compaction({trigger, beforeTokens, afterTokens}) { write('metric_compaction', {trigger: METRIC_TRIGGERS.includes(trigger) ? trigger : 'threshold', beforeTokens: count(beforeTokens), afterTokens: count(afterTokens)}); },
  };
}

const bump = (target, key, fields) => { const row = target[key] ??= {calls: 0}; row.calls++; for (const [name, value] of Object.entries(fields)) row[name] = (row[name] || 0) + (value || 0); };

// Reads a run's metric events in order and totals them by purpose and tool.
export function readRunMetrics(store, {taskId, runId} = {}) {
  const rows = store.db.prepare("SELECT kind,value FROM events WHERE kind LIKE 'metric\\_%' ESCAPE '\\' ORDER BY sequence").all()
    .map(row => ({kind: row.kind, ...JSON.parse(row.value)}))
    .filter(row => (!taskId || row.taskId === taskId) && (!runId || row.runId === runId));
  const summary = {subagentCalls: 0, modelCalls: 0, retries: 0, toolCalls: 0, compactions: 0, elapsedMs: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, estimatedTokens: 0, measuredCalls: 0, measuredEstimatedTokens: 0,
    peakRequestCharacters: 0, fixedCharacters: 0, requestCharacters: 0, byPurpose: {}, byTool: {}, modelErrors: {}, toolErrors: {}, submissions: {}};
  for (const row of rows) {
    if (row.kind === 'metric_model') {
      const request = row.messageCharacters + row.toolCharacters;
      summary.modelCalls++; if (row.purpose === 'research') summary.subagentCalls++; if (row.attempt > 1) summary.retries++;
      summary.elapsedMs += row.elapsedMs; summary.estimatedTokens += row.estimatedTokens;
      summary.requestCharacters += request; summary.fixedCharacters += row.systemCharacters + row.toolCharacters;
      summary.peakRequestCharacters = Math.max(summary.peakRequestCharacters, request);
      if (row.usage?.prompt_tokens) { summary.measuredCalls++; summary.measuredEstimatedTokens += row.estimatedTokens; }
      summary.promptTokens += row.usage?.prompt_tokens || 0; summary.completionTokens += row.usage?.completion_tokens || 0; summary.cachedTokens += row.usage?.cached_tokens || 0;
      bump(summary.byPurpose, row.purpose, {elapsedMs: row.elapsedMs, estimatedTokens: row.estimatedTokens, promptTokens: row.usage?.prompt_tokens, completionTokens: row.usage?.completion_tokens, cachedTokens: row.usage?.cached_tokens, requestCharacters: request});
      if (row.error) summary.modelErrors[row.error] = (summary.modelErrors[row.error] || 0) + 1;
      // Submission outcomes (C10): the first attempt of a request whose newest tool result came from submit_page or submit_plan.
      if (row.attempt === 1 && ['submit_page', 'submit_plan'].includes(row.lastTool?.tool)) {
        const entry = summary.submissions[row.lastTool.tool] ??= {accepted: 0, rejected: 0, codes: {}};
        if (row.lastTool.status === 'accepted') entry.accepted++;
        else { entry.rejected++; const key = row.lastTool.code || row.lastTool.status || 'unknown'; entry.codes[key] = (entry.codes[key] || 0) + 1; }
      }
    } else if (row.kind === 'metric_tool') {
      summary.toolCalls++;
      bump(summary.byTool, row.tool, {elapsedMs: row.elapsedMs, resultCharacters: row.resultCharacters, imageCount: row.imageCount});
      if (row.error) summary.toolErrors[row.error] = (summary.toolErrors[row.error] || 0) + 1;
    } else if (row.kind === 'metric_compaction') summary.compactions++;
  }
  summary.fixedShare = summary.requestCharacters ? summary.fixedCharacters / summary.requestCharacters : null;
  summary.cacheShare = summary.promptTokens ? summary.cachedTokens / summary.promptTokens : null;
  summary.estimateRatio = summary.measuredEstimatedTokens ? summary.promptTokens / summary.measuredEstimatedTokens : null;
  return {events: rows, summary};
}

// Display only the retained measured facts. A missing token field is not zero.
export function summarizeTaskMetrics(store,taskId){
 const {events}=readRunMetrics(store,{taskId});
 const rows=['planner','actor','reviewer','summary','analysis','research'].map(purpose=>({purpose,calls:0,promptTokens:null,completionTokens:null,cachedTokens:null,reports:{promptTokens:0,completionTokens:0,cachedTokens:0}}));
 const result={taskId,rows,modelCalls:0,toolCalls:0,compactions:0,retries:0,elapsedMs:0,runCount:0,retentionDays:30},runs=new Set();
 for(const event of events){
  if(event.runId)runs.add(event.runId);
  if(event.kind==='metric_tool'){result.toolCalls++;continue;}
  if(event.kind==='metric_compaction'){result.compactions++;continue;}
  if(event.kind!=='metric_model')continue;
  const row=rows.find(row=>row.purpose===event.purpose)||rows.find(row=>row.purpose==='analysis');row.calls++;result.modelCalls++;
  if(event.attempt>1)result.retries++;
  if(Number.isFinite(event.elapsedMs)&&event.elapsedMs>=0)result.elapsedMs+=event.elapsedMs;
  for(const [field,key] of [['promptTokens','prompt_tokens'],['completionTokens','completion_tokens'],['cachedTokens','cached_tokens']]){
   const value=event.usage?.[key];if(Number.isSafeInteger(value)&&value>=0){row[field]=(row[field]??0)+value;row.reports[field]++;}
  }
 }
 result.runCount=runs.size;return result;
}
