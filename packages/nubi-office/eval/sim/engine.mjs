// JavaScript port of native/Nubi.Office.Core/WorkbookEngine.cs and CellStyle.cs
// for the simulated host. Method names and order follow the C# source so a
// change there can be mirrored here. tests/sim-engine.test.mjs ports the native
// contract scenarios. This proves the same RULES, not Excel 2016 COM behavior.
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {OfficeFault,fault} from './fault.mjs';
import {area,cellName} from './workbook.mjs';

export const STYLE_FIELDS=['bold','italic','fillColor','numberFormat','fontName','fontSize','fontColor','horizontalAlignment','verticalAlignment','wrapText'];
export const LAYOUT_FIELDS=['locked','mergedAddress','arrayFormula','validation','rowHeight','columnWidth','hiddenRow','hiddenColumn','borders'];
const HORIZONTAL=['general','left','center','right','fill','justify','centerAcrossSelection','distributed'],VERTICAL=['top','center','bottom','justify','distributed'];
const BLOCKED_FORMULA=/[\[\]|]|(?:WEBSERVICE|HYPERLINK|RTD|DDE|CALL|REGISTER|XLOOKUP|FILTER|UNIQUE|LET|LAMBDA|SEQUENCE)\s*\(/i;
const clone=structuredClone;
const hash=value=>createHash('sha256').update(value,'utf8').digest('base64');
const contains=(outer,inner)=>inner.row>=outer.row&&inner.column>=outer.column&&inner.row+inner.rows<=outer.row+outer.rows&&inner.column+inner.columns<=outer.column+outer.columns;
const isNumber=value=>typeof value==='number';
const equivalent=(a,b)=>isNumber(a)&&isNumber(b)?a===b:isDeepStrictEqual(a??null,b??null);
const grid=(state,field)=>state.cells.map(row=>row.map(cell=>cell[field]===undefined?null:clone(cell[field])));

export function fingerprint(state){return hash([state.documentId,state.sheetId,state.address,state.date1904,state.readOnly,state.protected,JSON.stringify(state.cells)].join('|'));}

function validateStyle(field,value){
  const color=()=>typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value),control=/[\x00-\x1f]/;
  const valid=(()=>{switch(field){
    case'bold':case'italic':case'wrapText':return typeof value==='boolean';
    case'fillColor':return value===null||color();
    case'fontColor':return color();
    case'numberFormat':return typeof value==='string'&&value.length>0&&value.length<=120&&!control.test(value);
    case'fontName':return typeof value==='string'&&value.trim().length>0&&value.length<=100&&!control.test(value);
    case'fontSize':return isNumber(value)&&value>=1&&value<=409&&value*2===Math.trunc(value*2);
    case'horizontalAlignment':return HORIZONTAL.includes(value);
    case'verticalAlignment':return VERTICAL.includes(value);
    default:return false;
  }})();
  if(!valid)fault('invalid_format');
  return field.endsWith('Color')&&typeof value==='string'?value.toUpperCase():clone(value);
}
function validateState(state){
  const r=area(state.address);
  if(r.rows*r.columns>1000||!Array.isArray(state.cells)||state.cells.length!==r.rows||state.cells.some(row=>!Array.isArray(row)||row.length!==r.columns))fault('range_limit');
  if(JSON.stringify(state.cells).length>120000)fault('range_limit');
}
// A merged form input is one value at its top-left anchor. Never change a
// follower, formula, style, or a merge extending outside the scope.
export function validateTarget(state,row,column,field){
  if(state.readOnly||state.protected)fault('workbook_not_writable');
  const scope=area(state.address),original=state.cells[row-scope.row][column-scope.column];
  if(original.arrayFormula===true||original.hiddenRow===true||original.hiddenColumn===true)fault('unsupported_target');
  if(typeof original.mergedAddress!=='string')return;
  const merge=area(original.mergedAddress);
  if(!contains(scope,merge)||merge.row!==row||merge.column!==column||field!=='value'||typeof original.formula==='string')fault('unsupported_target');
}
function compile(state,plan){
  if(!plan||typeof plan!=='object'||!Array.isArray(plan.operations)||plan.operations.length>30||Object.keys(plan).some(key=>!['operations','answer','sourceDependencies'].includes(key)))fault('invalid_plan');
  const scope=area(state.address),patches=[],occupied=new Set();
  for(const op of plan.operations){
    if(!op||typeof op!=='object'||Array.isArray(op))fault('invalid_plan');
    const type=op.type,target=area(op.address??'');
    if(!contains(scope,target))fault('out_of_scope');
    const allowed=type==='set_values'?['type','address','values']:type==='set_formulas'?['type','address','formulas']:type==='format_range'?['type','address',...STYLE_FIELDS]:fault('unsupported_operation');
    if(Object.keys(op).some(key=>!allowed.includes(key)))fault('invalid_plan');
    const values=type==='set_values'?op.values:type==='set_formulas'?op.formulas:null;
    if(type!=='format_range'&&(!Array.isArray(values)||values.length!==target.rows||values.some(row=>!Array.isArray(row)||row.length!==target.columns)))fault('invalid_grid');
    for(let r=0;r<target.rows;r++)for(let c=0;c<target.columns;c++){
      const row=target.row+r,column=target.column+c;
      const add=(field,value)=>{
        const original=state.cells[row-scope.row][column-scope.column],content=field==='value'||field==='formula';
        validateTarget(state,row,column,field);
        if(content&&original.error===true&&typeof original.formula!=='string')fault('unsupported_target');
        if(content&&original.validation?.status==='unreadable')fault('validation_unavailable');
        const key=`${row}:${column}:${field==='formula'?'value':field}`;
        if(occupied.has(key))fault('overlapping_operations');occupied.add(key);
        patches.push({row:row-scope.row,column:column-scope.column,field,value:clone(value)});
      };
      if(type==='set_values'){
        const value=values[r][c];
        if(!(value===null||['string','boolean'].includes(typeof value)||isNumber(value)&&Number.isFinite(value))||typeof value==='string'&&(value.length>10000||/^\s*[=+@]/.test(value)))fault('invalid_value');
        add('value',value);
      }else if(type==='set_formulas'){
        const value=values[r][c],text=typeof value==='string'?value:'';
        if(!text.startsWith('=')||text.length>2000||BLOCKED_FORMULA.test(text))fault('unsupported_formula');
        add('formula',value);
      }else for(const field of STYLE_FIELDS)if(Object.hasOwn(op,field))add(field,validateStyle(field,op[field]));
    }
  }
  return patches;
}
function applyTo(original,patches){
  const state=clone(original);
  for(const patch of patches){const cell=state.cells[patch.row][patch.column];cell[patch.field]=clone(patch.value);if(patch.field==='value')cell.formula=null;}
  return state;
}
function verify(expected,actual,patches,restoring=false){
  if(['documentId','sheetId','address','date1904','readOnly','protected'].some(key=>expected[key]!==actual[key]))fault('wrong_document');
  // Protect the whole bound range, including cells outside the patch.
  // Formula results may recalculate; formulas and other fields may not drift.
  for(let r=0;r<expected.cells.length;r++)for(let c=0;c<expected.cells[r].length;c++){
    const wanted=expected.cells[r][c],observed=actual.cells[r][c];
    for(const field of ['formula',...LAYOUT_FIELDS,...STYLE_FIELDS])if(!equivalent(wanted[field],observed[field]))fault('verification_failed');
    if(typeof wanted.formula!=='string'&&!equivalent(wanted.value,observed.value))fault('verification_failed');
    if(observed.error===true&&wanted.error!==true)fault('verification_failed');
  }
  for(const patch of patches){
    const observed=actual.cells[patch.row][patch.column],prior=expected.cells[patch.row][patch.column],content=patch.field==='value'||patch.field==='formula';
    if(!restoring&&content&&observed.validationValid===false)fault('validation_failed');
    if(!equivalent(prior[patch.field],observed[patch.field])||content&&observed.error===true&&!(restoring&&prior.error===true))fault('verification_failed');
  }
}
function publicState(id,state){
  return{scopeId:id,documentId:state.documentId,worksheet:state.worksheet,workbook:state.workbook,address:state.address,date1904:state.date1904,readOnly:state.readOnly,protected:state.protected,
    values:grid(state,'value'),formulas:grid(state,'formula'),errors:grid(state,'error'),displayTexts:grid(state,'displayText'),
    formats:Object.fromEntries(STYLE_FIELDS.map(field=>[field,grid(state,field)])),
    properties:Object.fromEntries([...LAYOUT_FIELDS,'validationValid'].map(field=>[field,grid(state,field)])),
    fingerprint:fingerprint(state)};
}
const previewValue=value=>typeof value==='string'&&value.length>512?value.slice(0,512)+'…':value===undefined?null:clone(value);
function preview(change){
  const origin=area(change.before.address);
  return change.patches.slice(0,60).map(patch=>({cell:cellName(origin.row+patch.row,origin.column+patch.column),field:patch.field,
    before:previewValue(change.before.cells[patch.row][patch.column][patch.field]),after:previewValue(change.after.cells[patch.row][patch.column][patch.field])}));
}
export function describe(state){validateState(state);return publicState('',state);}

export function createEngine(port){
  const scopes=new Map(),ledger=new Map(),attempts=new Map(),changes=[];
  const scope=id=>scopes.get(id)??fault('scope_expired');
  const remember=change=>{changes.push(change);if(changes.length>20)changes.shift();};
  function readWorkbookRange(id,sheetId,address){
    const live=port.readRange(scope(id),sheetId,address);validateState(live);
    const {scopeId,...result}=publicState('',live);
    return{...result,sourceScopeId:id,sheetId,readOnly:true,kind:'workbook_range'};
  }
  function checkSources(scopeId,plan){
    if(plan.sourceDependencies===undefined)return;
    const sources=plan.sourceDependencies;
    if(!Array.isArray(sources)||sources.length>8)fault('invalid_plan');
    for(const item of sources){
      if(!item||typeof item!=='object'||Object.keys(item).length!==3||['sheetId','address','fingerprint'].some(key=>typeof item[key]!=='string'))fault('invalid_plan');
      if(readWorkbookRange(scopeId,item.sheetId,item.address).fingerprint!==item.fingerprint)fault('source_changed');
    }
  }
  return{
    selection(){
      const state=port.captureSelection();validateState(state);
      if(scopes.size>=32)scopes.delete(scopes.keys().next().value);
      const id=randomUUID().replaceAll('-','');scopes.set(id,state);return publicState(id,state);
    },
    read(id){const live=port.read(scope(id));validateState(live);return publicState(id,live);},
    boundState(id,expected){const live=port.read(scope(id));validateState(live);if(fingerprint(live)!==expected)fault('cells_changed');return clone(live);},
    listSheets(id,offset){return{...port.listSheets(scope(id),offset),sourceScopeId:id};},
    inspectSheet(id,sheetId,part,offset){return{...port.inspectSheet(scope(id),sheetId,part,offset),sourceScopeId:id};},
    readWorkbookRange,
    apply(scopeId,operationId,plan){
      if(typeof operationId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId))fault('invalid_operation_id');
      const signature=hash(scopeId+JSON.stringify(plan)),old=ledger.get(operationId);
      if(old){if(old.signature!==signature)fault('operation_collision');return clone(old.result);}
      if(ledger.size>=500)fault('session_limit');
      const before=scope(scopeId),live=port.read(before);validateState(live);
      if(fingerprint(live)!==fingerprint(before))fault('cells_changed');
      checkSources(scopeId,plan);
      const patches=compile(before,plan),expected=applyTo(before,patches);validateState(expected);
      if(!patches.length)return{applied:false,changedCells:0};
      const change={id:operationId,scopeId,before:clone(before),after:null,patches,restored:false,partial:false,recoverable:true};
      // Register the request BEFORE touching the workbook; uncertain writes must never be retried.
      const result={applied:false,error:'write_uncertain',changeId:operationId,recoverable:false};
      ledger.set(operationId,{signature,result});attempts.set(operationId,change);
      try{
        port.write(before,patches);
        change.after=port.read(before);validateState(change.after);
        verify(expected,change.after,patches);
        result.applied=true;delete result.error;
      }catch(failure){
        change.partial=true;
        if(failure instanceof OfficeFault)result.cause=failure.code;
        try{change.after=port.read(before);validateState(change.after);}catch{return clone(result);}
        if(fingerprint(change.after)===fingerprint(before)){
          result.error=failure instanceof OfficeFault?failure.code:'write_failed';result.changedCells=0;return clone(result);
        }
        result.error='partial_change';
        // Include unintended changes in the guarded recovery record. Unchanged
        // formulas may recalculate; their cached values are not edits.
        for(let r=0;r<before.cells.length;r++)for(let c=0;c<before.cells[r].length;c++){
          const original=before.cells[r][c],observed=change.after.cells[r][c];
          for(const field of ['value','formula',...STYLE_FIELDS]){
            if(field==='value'&&(typeof original.formula==='string'||typeof observed.formula==='string'))continue;
            if(equivalent(original[field],observed[field]))continue;
            const content=field==='value'||field==='formula';
            if(change.patches.some(p=>p.row===r&&p.column===c&&(p.field===field||content&&(p.field==='value'||p.field==='formula'))))continue;
            change.patches.push({row:r,column:c,field,value:clone(observed[field])});
          }
        }
      }
      for(let r=0;r<before.cells.length;r++)for(let c=0;c<before.cells[r].length;c++)
        if(LAYOUT_FIELDS.some(field=>!equivalent(before.cells[r][c][field],change.after.cells[r][c][field])))change.recoverable=false;
      remember(change);
      scopes.set(scopeId,clone(change.after));
      result.recoverable=change.recoverable;
      result.changedCells=new Set(patches.map(p=>p.row+':'+p.column)).size;
      result.preview=preview(change);
      result.snapshot=publicState(scopeId,change.after);
      return clone(result);
    },
    reconcile(scopeId,operationId,plan){
      const receipt=ledger.get(operationId);if(!receipt)return{outcome:'not_started'};
      if(receipt.signature!==hash(scopeId+JSON.stringify(plan)))fault('operation_collision');
      const attempt=attempts.get(operationId),live=port.read(attempt.before);validateState(live);
      if(receipt.result.applied===true){
        if(receipt.result.snapshot?.fingerprint!==fingerprint(live))fault('cells_changed');
        return{outcome:'complete',result:clone(receipt.result)};
      }
      // Readback can fail after every requested field was written. Verify the
      // entire original contract before converting it into a receipt.
      const patches=compile(attempt.before,plan),expected=applyTo(attempt.before,patches);
      try{
        verify(expected,live,patches);attempt.after=clone(live);attempt.partial=false;
        if(!changes.includes(attempt))remember(attempt);
        scopes.set(scopeId,clone(live));
        Object.assign(receipt.result,{applied:true,recoverable:true,snapshot:publicState(scopeId,live)});delete receipt.result.error;
        return{outcome:'complete',result:clone(receipt.result)};
      }catch(failure){
        if(!(failure instanceof OfficeFault))throw failure;
        if(receipt.result.error==='partial_change'&&receipt.result.recoverable===true){
          if(fingerprint(attempt.after)!==fingerprint(live))fault('cells_changed');
          return{outcome:'partial',result:clone(receipt.result)};
        }
        return{outcome:'uncertain'};
      }
    },
    restore(id){
      const change=changes.find(item=>item.id===id)??fault('recovery_expired');
      if(change.restored)return{restored:true,changeId:id};
      if(!change.recoverable)fault('unsupported_recovery');
      if(fingerprint(port.read(change.after))!==fingerprint(change.after))fault('recovery_conflict');
      const reverse=change.patches.map(patch=>{
        const prior=change.before.cells[patch.row][patch.column],content=patch.field==='value'||patch.field==='formula';
        const field=content?typeof prior.formula==='string'?'formula':'value':patch.field;
        return{row:patch.row,column:patch.column,field,value:clone(prior[field]??null)};
      });
      try{port.write(change.before,reverse);const after=port.read(change.before);validateState(after);verify(change.before,after,reverse,true);scopes.set(change.scopeId,after);}
      catch{fault('recovery_uncertain');}
      change.restored=true;
      return{restored:true,changeId:id};
    },
    history(){return[...changes].reverse().map(change=>({id:change.id,scopeId:change.scopeId,workbook:change.before.workbook,worksheet:change.before.worksheet,address:change.before.address,
      restored:change.restored,partial:change.partial,recoverable:change.recoverable,preview:preview(change),previewTotal:change.patches.length}));}
  };
}
