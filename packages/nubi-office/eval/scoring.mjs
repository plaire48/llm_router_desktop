import {FORMAT_FIELDS} from '../worker/cell-format.mjs';
import {inspectChecks, region} from '../worker/office-harness.mjs';
import {canonicalFormula} from '../worker/document-schema.mjs';

function formulaRequirements(rules,snapshot){
  const area=region(snapshot.address);
  return(rules||[]).map(rule=>{
    const cell=region(rule.address),raw=snapshot.formulas?.[cell.r-area.r]?.[cell.c-area.c];
    // Text inside a formula cannot masquerade as a function or source reference.
    const formula=typeof raw==='string'?canonicalFormula(raw.replace(/"(?:[^"]|"")*"/g,'""')):'';
    const functions=[...formula.matchAll(/\b([A-Z][A-Z0-9.]*)\s*\(/g)].map(m=>m[1]);
    return{address:rule.address,passed:(rule.functions||[]).every(f=>functions.includes(f.toUpperCase()))&&(rule.sheetReferences||[]).every(name=>formula.includes(name.toUpperCase()+'!'))};
  });
}

export function auditChanges(before, after, allowedChanges) {
  if (before.date1904 !== after.date1904) throw new Error('audit_date_system_changed');
  if (before.address !== after.address) throw new Error('audit_range_mismatch');
  const area = region(before.address), allowed = new Set(allowedChanges), unexpected = [];
  for (let r = 0; r < area.rows; r++) for (let c = 0; c < area.cols; c++) {
    let n = area.c + c, col = '';
    while (n) {n--; col = String.fromCharCode(65 + n % 26) + col; n = Math.floor(n / 26);}
    const cell = col + (area.r + r);
    for (const field of ['value', 'formula', 'error', ...FORMAT_FIELDS, 'locked','mergedAddress','arrayFormula','validation','rowHeight','columnWidth','hiddenRow','hiddenColumn']) {
      const read = state => field === 'value' ? state.values[r][c] : field === 'formula' ? state.formulas[r][c] : field === 'error' ? state.errors[r][c] : (FORMAT_FIELDS.includes(field)?state.formats:state.properties)?.[field]?.[r]?.[c];
      if (read(before)===undefined||read(after)===undefined) {unexpected.push({cell,field,error:'unobserved_property'});continue;}
      if (!allowed.has(`${cell}:${field}`) && JSON.stringify(read(before)) !== JSON.stringify(read(after))) unexpected.push({cell, field, before: read(before), after: read(after)});
    }
  }
  return unexpected;
}
export function scoreCase(testCase, state, before, after, reopened, sources={before:[],after:[],reopened:[]}) {
  const checks = inspectChecks(testCase.checks, after), persistedChecks = inspectChecks(testCase.checks, reopened);
  const unexpectedChanges = auditChanges(before, after, testCase.allowedChanges);
  const persistedUnexpectedChanges = auditChanges(before, reopened, testCase.allowedChanges);
  const replyPresent = testCase.state !== 'awaiting_user' || typeof state.question === 'string' && state.question.trim().length > 0;
  const formulaChecks=[...formulaRequirements(testCase.formulaRequirements,after),...formulaRequirements(testCase.formulaRequirements,reopened)];
  const sourceChecks=(testCase.sourceSheets||[]).map(expected=>{
    const start=sources.before.find(s=>s.worksheet===expected.name),end=sources.after.find(s=>s.worksheet===expected.name),saved=sources.reopened.find(s=>s.worksheet===expected.name);
    if(!start||!end||!saved)return{worksheet:expected.name,passed:false,error:'source_unobserved'};
    const changes=auditChanges(start,end,[]),persisted=auditChanges(start,saved,[]);
    return{worksheet:expected.name,passed:!changes.length&&!persisted.length,unexpectedChanges:changes,persistedUnexpectedChanges:persisted};
  });
  // Workbook checks cannot judge whether a question is relevant or an answer is
  // truthful. Never turn a nonempty reply (or the agent's own review) into a pass.
  const semanticRequired = ['awaiting_user', 'unsupported'].includes(testCase.state) || Boolean(testCase.responseRubric?.length);
  const deterministicPassed = state.state === testCase.state && replyPresent && checks.verified && persistedChecks.verified && !unexpectedChanges.length && !persistedUnexpectedChanges.length && sourceChecks.every(s=>s.passed)&&formulaChecks.every(c=>c.passed);
  const semanticReview = {required: semanticRequired, status: semanticRequired ? 'pending' : 'not_required', criteria: testCase.responseRubric || []};
  const passed = deterministicPassed ? semanticRequired ? null : true : false;
  return {passed, outcome: passed === null ? 'needs_review' : passed ? 'passed' : 'failed', deterministicPassed, semanticReview,
    expectedState: testCase.state, actualState: state.state, checks, persistedChecks, unexpectedChanges, persistedUnexpectedChanges,sourceChecks,formulaChecks};
}
