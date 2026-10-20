import {loadOfficeEvaluationCases} from './synthetic-values.mjs';
// Source-only audit probes. Scripted providers expose control defects; they do
// not measure a model's document quality and never launch Excel or a build.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createWorker} from '../worker/main.mjs';
import {scoreCase} from './scoring.mjs';
import {collectProvenance} from './provenance.mjs';
import {documentProvider, request} from '../tests/document-fixtures.mjs';
import {call, workbook} from '../tests/harness-fixtures.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function auditHarness() {
  const rubric = JSON.parse(await readFile(resolve(root, 'eval/harness-rubric.json'), 'utf8'));
  if (rubric.dimensions.reduce((sum, d) => sum + d.weight, 0) !== 100 || rubric.dimensions.some(d => d.score < 0 || d.score > 5)) throw new Error('invalid_review_rubric');
  const corpus = await loadOfficeEvaluationCases();
  const snapshot = workbook().snapshot();
  const scorerProbes = [
    {id: 'irrelevant-question', state: 'awaiting_user', question: '오늘 날씨는 어때요?'},
    {id: 'invented-chart-completion', state: 'unsupported', answer: '완료했습니다. 차트를 만들었습니다.'}
  ].map(state => {
    const scored = scoreCase({state: state.state, checks: [], allowedChanges: []}, state, snapshot, snapshot, snapshot);
    return {id: state.id, passed: scored.passed, outcome: scored.outcome, semanticReview: scored.semanticReview.status};
  });
  const base = documentProvider(); let plannerCalls = 0, asked = false;
  const providers = {...base, dispose() {}, async complete(messages, ...args) {
    if (messages[0].content.startsWith('NUBI_DOCUMENT_PLANNER')) plannerCalls++;
    if (messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')) {
      const input = JSON.parse(messages.findLast(m => m.role === 'user').content);
      if (input.currentSheet.name === '예산'){
        if(!asked){asked=true;return call('ask_user', {question: '식비 단가를 확정해 주세요.'});}
        return new Promise((_,reject)=>{const signal=args[1];if(signal.aborted)reject(new Error('cancelled'));else signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});
      }
    }
    return base.complete(messages, ...args);
  }};
  const worker = createWorker(providers); let clarificationProbe;
  try {
    let state = await worker.dispatch('runStart', {requestId:'audit-start-000001',mode: 'document', request});
    for (let i = 0; state.state === 'running' && state.action?.name!=='request_input' && i < 1000; i++) {
      if (state.action) {
        if (state.action.name !== 'show_plan') throw new Error('audit_unexpected_action');
        await worker.dispatch('toolResult', {id: state.id, callId: state.action.callId, result: {displayed: true}});
      }
      await new Promise(resolve => setImmediate(resolve)); state = await worker.dispatch('runStatus', {id: state.id});
    }
    if (state.action?.name !== 'request_input') throw new Error('audit_question_not_reached');
    await worker.dispatch('toolResult',{id:state.id,callId:state.action.callId,result:{text:'식비 단가는 12000원입니다.'}});
    await new Promise(resolve=>setImmediate(resolve));
    const next=await worker.dispatch('runLookup',{requestId:'audit-start-000001'});
    let previousRunAccessible = true;
    try {await worker.dispatch('runStatus', {id: state.id});} catch {previousRunAccessible = false;}
    clarificationProbe = {stateBefore: state.state, acceptedDraftsBefore: state.writes, newRunId: next.id !== state.id, acceptedDraftsAfter: next.writes, previousRunAccessible, plannerCalls, preserved: next.id === state.id && next.writes === state.writes};
  } finally {worker.dispose();}
  return {
    kind: 'source-harness-assessment', generatedAt: new Date().toISOString(), rubric,
    implementationScore: rubric.dimensions.reduce((sum, d) => sum + d.weight * d.score / 5, 0),
    liveAccuracy: null, enterpriseReady: false, evidence: {liveModel: false, windowsExcel2016: false, nasca: false, built: false},
    coverage: {caseVersion: corpus.version, total: corpus.cases.length, modes: Object.fromEntries(['edit', 'document', 'template'].map(mode => [mode, corpus.cases.filter(c => c.mode === mode).length]))},
    scorerProbes, clarificationProbe,
    provenance: await collectProvenance(root, {sharedRoot: fileURLToPath(new URL('../../../extensions/aipro-chat/', import.meta.url))})
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await auditHarness(); await mkdir(resolve(root, 'verification'), {recursive: true});
  await writeFile(resolve(root, 'verification/harness-assessment.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({score: report.implementationScore, scoreKind: report.rubric.kind, liveAccuracy: report.liveAccuracy, coverage: report.coverage, scorerProbes: report.scorerProbes, clarificationProbe: report.clarificationProbe}, null, 2));
}
