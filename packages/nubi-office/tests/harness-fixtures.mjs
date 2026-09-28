// Scripted fault injection only. These fixtures never measure model accuracy.
import {FORMAT_FIELDS} from '../worker/cell-format.mjs';
import {createHash, randomUUID} from 'node:crypto';
export const text = content => ({content, calls: [], finishReason: 'stop'});
export const call = (name, args = {}) => ({content: '', calls: [{id: randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}], finishReason: 'tool_calls'});
export const planCall = operations => call('apply_changes', {plan: JSON.stringify({operations})});
export const valueEdit = value => ({type: 'set_values', address: 'A1', values: [[value]]});
export const valueCheck = value => ({address: 'A1', field: 'value', operator: 'equals', expected: value});
export function contract(checks = [valueCheck(42)], overrides = {}) {
  const task={intent: 'edit', summary: '요청한 셀과 서식 변경', requirements: ['요청한 셀 변경을 모두 반영한다'], questions: [], preserveFormulas: true, checks, ...overrides};
  task.steps=overrides.steps||(['clarify','unsupported'].includes(task.intent)?[]:[{id:'inspect',title:'선택한 표와 기존 수식 확인',kind:'inspect',checkIndexes:[]},{id:'work',title:task.intent==='edit'?'요청한 값과 서식 반영':'표의 핵심 내용 분석',kind:task.intent==='edit'?'edit':'analyze',checkIndexes:checks.map((_,i)=>i)},{id:'verify',title:'최종 셀과 요청 조건 확인',kind:'verify',checkIndexes:checks.map((_,i)=>i)}]);return task;
}
export function verdict(payload, status = 'complete', next_step = '') {
  return text(JSON.stringify({status, checks: [{requirement: '요청 조건 충족', status: status === 'complete' ? 'met' : 'unmet', evidence_ids: [payload.evidence[0].id]}], next_step}));
}
export const recoveryVerdict = (overrides = {}) => text(JSON.stringify({decision:'revise',summary:'실패한 입력과 현재 셀을 확인했습니다.',nextAction:'이미 완료한 작업을 유지하고 실패한 입력을 고쳐 다시 실행하겠습니다.',question:'',...overrides}));
export function scriptedProvider({task = contract(), actor = [planCall([valueEdit(42)]), text('A1을 42로 변경했습니다.')], actionReview, stepReview, resultReview, recovery} = {}) {
  let index = 0;
  return {status: () => ({model: 'scripted-control-fixture'}), complete: async (messages, tools) => {
    const system = messages[0].content;
    if (system.startsWith('NUBI_TASK_PLANNER')) return text(JSON.stringify(task));
    if (system.startsWith('NUBI_RECOVERY_PLANNER')) return recovery?.(JSON.parse(messages[1].content)) ?? recoveryVerdict();
    if (system.startsWith('NUBI_ACTION_REVIEWER')) return actionReview?.(JSON.parse(messages[1].content)) ?? verdict(JSON.parse(messages[1].content));
    if (system.startsWith('NUBI_STEP_REVIEWER')) return stepReview?.(JSON.parse(messages[1].content)) ?? verdict(JSON.parse(messages[1].content));
    if (system.startsWith('NUBI_RESULT_REVIEWER')) return resultReview?.(JSON.parse(messages[1].content)) ?? verdict(JSON.parse(messages[1].content));
    return typeof actor === 'function' ? actor(messages, tools) : actor[index++] ?? text('완료했다고 주장합니다.');
  }};
}
export function workbook() {
  const state = {scopeId: 'scope-1', documentId: 'book-1', worksheet: 'Sheet1', workbook: 'Book.xlsx', address: 'A1:B1', values: [[1, 2]], formulas: [[null, null]], errors: [[false, false]], date1904:false, formats: {italic:[[false,false]],fontName:[['맑은 고딕','맑은 고딕']],fontSize:[[11,11]],fontColor:[['#000000','#000000']],horizontalAlignment:[['general','general']],verticalAlignment:[['bottom','bottom']],wrapText:[[false,false]],bold: [[false, false]], fillColor: [[null, null]], numberFormat: [['General', 'General']]}};
  state.properties=Object.fromEntries(Object.entries({locked:true,mergedAddress:null,arrayFormula:false,validation:null,rowHeight:18,columnWidth:12,hiddenRow:false,hiddenColumn:false}).map(([key,value])=>[key,[[value,value]]]));
  let writes = 0;
  const snapshot = () => ({...structuredClone(state), fingerprint: createHash('sha256').update(JSON.stringify(state)).digest('hex')});
  return {state, snapshot, get writes() {return writes;}, action(action) {
    if(action.name==='show_plan')return{displayed:true};
    if (action.name !== 'apply_changes') return snapshot();
    writes++;
    for (const op of action.plan.operations) {
      const col = op.address[0].charCodeAt(0) - 65;
      if (op.type === 'set_values') {state.values[0][col] = op.values[0][0]; state.formulas[0][col] = null;}
      else if (op.type === 'set_formulas') state.formulas[0][col] = op.formulas[0][0];
      else for (const field of FORMAT_FIELDS) if (Object.hasOwn(op, field)) {state.formats[field]??=[[null,null]];state.formats[field][0][col] = op[field];}
    }
    return {applied: true, snapshot: snapshot()};
  }};
}
export async function drive(run, onAction) {
  for (let i = 0; i < 1000; i++) {
    const status = run.status();
    if (status.state !== 'running') {await run.promise; return run.status();}
    if (status.action) run.respond(status.action.callId, status.action.name==='show_plan'?{displayed:true}:status.action.name==='request_approval'?{approved:true}:await onAction(status.action));
    await new Promise(resolve => setImmediate(resolve));
  }
  run.cancel(); await run.promise; throw new Error('Control test timed out');
}
