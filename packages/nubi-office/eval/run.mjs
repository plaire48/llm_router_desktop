import {loadOfficeEvaluationCases} from './synthetic-values.mjs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createProviders, safeError} from '../worker/providers.mjs';
import {startAgent} from '../worker/agent.mjs';
import {scoreCase} from './scoring.mjs';
import {scoreDocumentCase} from './document-scoring.mjs';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {writeDocument} from '../worker/document-file.mjs';
import {fixtureInteraction} from './interactions.mjs';
import {reviewTemplate} from './review.mjs';
import {driveEvaluationRun, EVALUATION_LIMITS} from './driver.mjs';
import {collectProvenance} from './provenance.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(r => setTimeout(r, ms));

function startNative(executable) {
  const process = spawn(executable, [], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  const pending = new Map(); let closed = false;
  function fail() {closed = true; for (const item of pending.values()) {clearTimeout(item.timer); item.reject(new Error('excel_host_disconnected'));} pending.clear();}
  process.once('error', fail); process.once('exit', fail);
  process.stdin.on('error', fail);
  createInterface({input: process.stdout}).on('line', line => {
    try {const reply = JSON.parse(line), item = pending.get(reply.id); if (!item) return;
      pending.delete(reply.id); clearTimeout(item.timer); reply.ok ? item.resolve(reply.result) : item.reject(new Error(reply.error));
    } catch {fail();}
  });
  // Never surface raw native stderr, which can contain user paths.
  process.stderr.resume();
  return {call(method, payload = {}) {
    if (closed) return Promise.reject(new Error('excel_host_disconnected'));
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => {pending.delete(id); reject(new Error('office_timeout'));}, 45000);
      pending.set(id, {resolve, reject, timer}); process.stdin.write(JSON.stringify({id, method, payload}) + '\n');
    });
  }, async close() {process.stdin.end(); await Promise.race([new Promise(r => process.once('exit', r)), pause(3000)]); if (!closed) process.kill();}};
}
async function connect(providers, env) {
  const provider = env.NUBI_EVAL_PROVIDER;
  if (['aipro', 'chatgpt'].includes(provider)) {
    await providers.login(provider);
    while (providers.status().pending) await pause(200);
    if (!providers.status().connected) throw new Error(providers.status().loginError || 'no_credential');
  } else await providers.connect({provider, baseUrl: env.NUBI_EVAL_BASE_URL, endpoint: env.NUBI_EVAL_BASE_URL, token: env.NUBI_EVAL_TOKEN, clientKey: env.NUBI_EVAL_CLIENT_KEY, model: env.NUBI_EVAL_MODEL});
  providers.model(env.NUBI_EVAL_MODEL);
}
export async function evaluate({caseIds, env = process.env, outputDir} = {}) {
  const corpus = await loadOfficeEvaluationCases();
  const cases = caseIds ? corpus.cases.filter(c => caseIds.includes(c.id)) : corpus.cases;
  if (!cases.length || caseIds?.some(id => !cases.some(c => c.id === id))) throw new Error('unknown_case');
  if (cases.some(c => !['edit','template','document'].includes(c.mode))) throw new Error('evaluation_mode_not_supported');
  const analysisConcurrency=env.NUBI_EVAL_ANALYSIS_CONCURRENCY===undefined?2:Number(env.NUBI_EVAL_ANALYSIS_CONCURRENCY);
  if(![1,2].includes(analysisConcurrency))throw new Error('invalid_analysis_concurrency');
  const report = {kind: 'live-excel-model-evaluation', schema: 4, analysisConcurrency, limits: EVALUATION_LIMITS, supportedModes: ['edit','template','document'], caseVersion: corpus.version, startedAt: new Date().toISOString(), status: 'blocked', accuracy: null, cases: [], limitations: ['Synthetic edit, document and template cases do not establish representative company-template accuracy.', 'Separate context review uses the selected model; it is not an independent-model guarantee.', 'Native COM evaluation does not prove VSTO installation or the Office 2016 edition.', 'Questions and unsupported-feature answers require independent semantic review; pending review is not a pass.', 'Source and existing artifact hashes do not establish that an artifact was built from those sources.']};
  const blockers = [];
  if(env.NUBI_EVAL_APPROVE_TRANSACTIONS!=='1')blockers.push('evaluation_transaction_approval_required');
  if (process.platform !== 'win32') blockers.push('windows_excel_unavailable');
  if (!env.NUBI_EVAL_PROVIDER || !env.NUBI_EVAL_MODEL) blockers.push('provider_model_not_configured');
  if (env.NUBI_EVAL_PROVIDER === 'fabrix' && !env.NUBI_EVAL_CLIENT_KEY) blockers.push('fabrix_client_key_not_configured');
  if (!['aipro', 'chatgpt'].includes(env.NUBI_EVAL_PROVIDER) && (!env.NUBI_EVAL_BASE_URL || !env.NUBI_EVAL_TOKEN)) blockers.push('dedicated_connection_not_configured');
  const executable = resolve(root, 'native/Nubi.Office.EvalHost/bin/Release/net472/Nubi.Office.EvalHost.exe');
  try {await access(executable);} catch {blockers.push('evaluation_host_not_built');}
  report.provenance = await collectProvenance(root, {sharedRoot: fileURLToPath(new URL('../../../extensions/aipro-chat/', import.meta.url))});
  report.sourceHash = report.provenance.sourceHash;
  if (blockers.length) report.blockers = blockers;
  else {
    const providers = createProviders(), native = startNative(executable);
    const artifacts = outputDir || resolve(root, 'verification/live', randomUUID()); await mkdir(artifacts, {recursive: true});
    report.artifacts = artifacts;
    try {
      const initialize=async testCase=>{const initial=await native.call('init',{...testCase,evaluationDirectory:resolve(artifacts,testCase.id)});if(initial.host?.evaluationProtocol!==4)throw new Error('evaluation_host_version_mismatch');return initial;};
      const first = await initialize(cases[0]); report.host = first.host;
      await connect(providers, env); report.provider = env.NUBI_EVAL_PROVIDER; report.model = env.NUBI_EVAL_MODEL;
      for (const testCase of cases) {
        let run;
        try {
          const initial = testCase === cases[0] ? first : await initialize(testCase); report.host = initial.host;
          run = testCase.mode==='document'?startDocumentAgent({request:testCase.request,providers,writeFile:(task,specs)=>writeDocument(task,specs,{directory:resolve(artifacts,testCase.id,'drafts')})}):startAgent({request: testCase.request, scope: initial.scope, mode: testCase.mode, providers,workbookOptions:{concurrency:analysisConcurrency}});
          const state = await driveEvaluationRun({run, interaction:fixtureInteraction(testCase), approveTransactions: env.NUBI_EVAL_APPROVE_TRANSACTIONS === '1', execute: async action => {
            try {
              if(testCase.mode==='document'){if(!['document_open','document_read','document_save','document_reconcile'].includes(action.name))throw new Error('evaluation_action_not_supported');return await native.call(action.name,action.payload);}
              if (['workbook_sheets', 'workbook_structure', 'workbook_range'].includes(action.name)) return await native.call(action.name, {...action.payload, scopeId: action.scopeId});
              if (action.name === 'reconcile_changes') return await native.call('reconcile', {scopeId: action.scopeId, ...action.payload});
              if (action.name === 'restore_change') return await native.call('restore', action.payload);
              if (!['apply_changes', 'read_selection', 'verify_selection'].includes(action.name)) throw new Error('evaluation_action_not_supported');
              return await native.call(action.name === 'apply_changes' ? 'apply' : 'read', {scopeId: action.scopeId, operationId: action.callId, plan: action.plan});
            } catch (error) {
              const code = safeError(error);
              // A lost native response may still be executing. Close the host;
              // do not initialize another workbook or blindly redeliver a write.
              if (['office_timeout', 'excel_host_disconnected', 'evaluation_action_not_supported'].includes(code)) throw error;
              return {error: code};
            }
          }});
          let after,reopened,scored,sourcesAfter=[],sourcesReopened=[];
          if(testCase.mode==='document'){
            if(state.state==='done'&&state.artifact?.saved===true){
              after=await native.call('document_audit',{documentId:state.artifact.documentId});
              reopened=await native.call('document_reopen',{documentId:state.artifact.documentId});
            }
            scored=scoreDocumentCase(testCase,state,after,reopened);
          }else{
            after=await native.call('audit');sourcesAfter=await native.call('auditSources');
            reopened=await native.call('saveReopen',{path:resolve(artifacts,testCase.id+'.xlsx')});sourcesReopened=await native.call('auditSources');
            scored=scoreCase(testCase,state,initial.before,after,reopened,{before:initial.sourcesBefore||[],after:sourcesAfter,reopened:sourcesReopened});
          }
          report.cases.push({id: testCase.id, ...scored, plan: state.plan, metrics: state.metrics, trace: state.trace, recoveries: state.recoveries, review: state.review, question: state.question, answer: state.answer, error: state.error});
          await writeFile(resolve(artifacts, testCase.id + '.json'), JSON.stringify({before: initial.before, after, reopened, sources:{before:initial.sourcesBefore||[],after:sourcesAfter,reopened:sourcesReopened},result: report.cases.at(-1)}, null, 2));
        } catch (error) {run?.cancel(); if (run) Promise.resolve(run.promise).catch(() => {}); report.cases.push({id: testCase.id, passed: false, outcome: 'failed', error: safeError(error)}); report.status = 'aborted'; report.blockers = [safeError(error)]; break;}
      }
      if (report.status !== 'aborted') {
        report.status = 'measured'; report.accuracy = {passed: report.cases.filter(c => c.passed === true).length, failed: report.cases.filter(c => c.passed === false).length, pending: report.cases.filter(c => c.passed === null).length, total: cases.length};
      }
    } catch (error) {report.blockers = [safeError(error)];}
    finally {providers.dispose(); await native.close();}
  }
  report.finishedAt = new Date().toISOString();
  if(report.status==='measured')await writeFile(resolve(report.artifacts,'review-template.json'),JSON.stringify(reviewTemplate(report),null,2)+'\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await evaluate(); const path = report.artifacts ? resolve(report.artifacts, 'report.json') : resolve(root, 'verification/live-preflight.json');
  await mkdir(resolve(root, 'verification'), {recursive: true});
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({status: report.status, accuracy: report.accuracy, blockers: report.blockers, report: path}, null, 2));
  process.exitCode = report.status === 'blocked' ? 2 : report.status === 'measured' && report.accuracy.passed === report.accuracy.total ? 0 : 1;
}
