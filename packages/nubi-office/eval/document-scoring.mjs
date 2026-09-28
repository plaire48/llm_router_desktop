import {inspectFormula} from '../worker/formula-preflight.mjs';

function observe(snapshot,rule){
  const cell=snapshot?.sheets?.find(sheet=>sheet.name===rule.sheet)?.cells?.find(cell=>cell.address===rule.address);
  if(!cell)return{passed:false,reason:'unobserved_cell',sheet:rule.sheet,address:rule.address};
  const actual=rule.field==='bold'||rule.field==='numberFormat'?cell.style?.[rule.field]:cell[rule.field];
  let passed=false;
  if(rule.field==='formula'&&rule.functions){
    try{
      const parsed=inspectFormula(actual,{worksheet:rule.sheet,strict:true});
      passed=rule.functions.every(name=>parsed.functions.includes(name))&&(rule.references||[]).every(reference=>{
        const expected=inspectFormula('='+reference,{worksheet:rule.sheet,strict:true}).references[0];
        return parsed.references.some(observed=>['sheet','r','c','er','ec'].every(key=>observed[key]===expected[key]));
      });
    }catch{passed=false;}
  }else passed=actual!==undefined&&(typeof rule.expected==='number'?typeof actual==='number'&&Math.abs(actual-rule.expected)<1e-7:JSON.stringify(actual)===JSON.stringify(rule.expected));
  return{...rule,actual,passed};
}
export function scoreDocumentCase(testCase,state,after,reopened){
  const requiredSheets=testCase.expectedSheets||[];
  const controls=snapshot=>snapshot?.calculated===true&&Array.isArray(snapshot.sheets)&&snapshot.sheets.length===requiredSheets.length&&requiredSheets.every(name=>snapshot.sheets.some(sheet=>sheet.name===name))&&snapshot.sheets.every(sheet=>sheet.layoutVerified===true&&Array.isArray(sheet.cells)&&sheet.cells.every(cell=>cell.error===false));
  const checks=(testCase.documentChecks||[]).map(rule=>observe(after,rule)),persistedChecks=(testCase.documentChecks||[]).map(rule=>observe(reopened,rule));
  const deterministicPassed=state.state==='done'&&state.artifact?.saved===true&&requiredSheets.length>0&&checks.length>0&&controls(after)&&controls(reopened)&&checks.every(c=>c.passed)&&persistedChecks.every(c=>c.passed);
  const semanticReview={required:Boolean(testCase.responseRubric?.length),status:testCase.responseRubric?.length?'pending':'not_required',criteria:testCase.responseRubric||[]};
  const passed=deterministicPassed?semanticReview.required?null:true:false;
  return{passed,outcome:passed===null?'needs_review':passed?'passed':'failed',deterministicPassed,semanticReview,checks,persistedChecks};
}
