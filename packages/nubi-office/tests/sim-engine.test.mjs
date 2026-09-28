// Ports the scenarios of native/Nubi.Office.Tests/Program.cs so the simulated
// engine keeps the same contract as WorkbookEngine.cs. Excel COM is simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine,validateTarget,fingerprint,describe} from '../eval/sim/engine.mjs';
import {OfficeFault} from '../eval/sim/fault.mjs';

const clone=structuredClone;
function fakePort(){
  const cell=(value,formula=null)=>({value,formula,error:false,bold:false,fillColor:null,numberFormat:'General',italic:false,fontName:'맑은 고딕',fontSize:11,fontColor:'#000000',horizontalAlignment:'general',verticalAlignment:'bottom',wrapText:false,displayText:String(value),locked:true,mergedAddress:null,arrayFormula:false,rowHeight:18,columnWidth:12,validation:null,validationValid:null});
  const port={writes:0,failAfter:0,closed:false,loseReadAfterWrite:false,formulaError:false,failBefore:false,damageOtherCell:false,dependentError:false,damageFont:false,rejectValidation:false,damageLayout:false,
    state:{documentId:'book-a',sheetId:'sheet-a',workbook:'Budget.xlsx',worksheet:'Sheet1',address:'A1:B2',date1904:false,readOnly:false,protected:false,cells:[[cell(1),cell(2)],[cell(3),cell(3,'=SUM(A1:B1)')]]},
    captureSelection:()=>clone(port.state),
    read(){if(port.closed)throw new OfficeFault('document_closed');if(port.loseReadAfterWrite&&port.writes>0)throw new Error('read failed');return clone(port.state);},
    write(target,patches){
      if(port.failBefore)throw new OfficeFault('workbook_not_writable');port.writes++;let count=0;
      for(const patch of patches){const at=port.state.cells[patch.row][patch.column];at[patch.field]=clone(patch.value);
        if(patch.field==='value'){at.formula=null;at.error=false;}
        if(patch.field==='formula'){at.value=3;at.error=port.formulaError;}
        if(++count===port.failAfter)throw new Error('simulated partial failure');}
      if(port.damageLayout)port.state.cells[0][1].columnWidth=30;
      if(port.damageFont)port.state.cells[0][1].fontColor='#FF0000';
      if(port.rejectValidation)port.state.cells[0][0].validationValid=false;
      for(const row of port.state.cells)for(const at of row)at.displayText=String(at.value);
      if(port.damageOtherCell)port.state.cells[0][1].value=99;
      if(port.dependentError)port.state.cells[1][1].error=true;
    },
    listSheets:anchor=>({documentId:anchor.documentId,items:[{sheetId:'sheet-b',name:'Criteria'}]}),
    inspectSheet:()=>({items:[]}),
    readRange(anchor,sheetId,address){if(port.closed)throw new OfficeFault('document_closed');if(anchor.documentId!==port.state.documentId||sheetId!=='sheet-b'||address!=='A1:B2')throw new OfficeFault('out_of_scope');return clone(port.source);}
  };
  port.source={...clone(port.state),sheetId:'sheet-b',worksheet:'Criteria'};
  return port;
}
function setup(prepare=()=>{}){const port=fakePort();prepare(port);const engine=createEngine(port);return{port,engine,scope:engine.selection().scopeId};}
const plan=operations=>({operations});
const write=plan([{type:'set_values',address:'A1',values:[[42]]}]);
const faults=(code,action)=>assert.throws(action,error=>error instanceof OfficeFault&&error.code===code,code);

test('numeric writes verify and a replay is idempotent',()=>{
  const {port,engine,scope}=setup(),first=engine.apply(scope,'one',write);
  assert.equal(first.applied,true);assert.equal(first.snapshot.values[0][0],42);assert.equal(engine.apply(scope,'one',write).changedCells,1);assert.equal(port.writes,1);
});
test('a lost mutation reply is reconciled from the receipt without a second write',()=>{
  const {port,engine,scope}=setup();engine.apply(scope,'lost',write);
  assert.equal(engine.reconcile(scope,'lost',write).outcome,'complete');assert.equal(port.writes,1);
  port.state.cells[0][1].value=99;faults('cells_changed',()=>engine.reconcile(scope,'lost',write));
});
test('an unknown operation is reported as not started',()=>{
  const {engine,scope}=setup();assert.deepEqual(engine.reconcile(scope,'never',write),{outcome:'not_started'});
});
test('a temporary readback loss is reconciled by full expected-state verification',()=>{
  const {port,engine,scope}=setup();port.loseReadAfterWrite=true;
  assert.equal(engine.apply(scope,'lost',write).error,'write_uncertain');
  port.loseReadAfterWrite=false;assert.equal(engine.reconcile(scope,'lost',write).outcome,'complete');assert.equal(port.writes,1);
  engine.restore('lost');assert.equal(port.state.cells[0][0].value,1);
});
test('a partial mutation receipt allows a guarded restore but never claims complete',()=>{
  const {port,engine,scope}=setup();port.failAfter=1;const wide=plan([{type:'set_values',address:'A1:B1',values:[[40,50]]}]);
  const result=engine.apply(scope,'partial',wide);assert.equal(result.error,'partial_change');
  assert.equal(engine.reconcile(scope,'partial',wide).outcome,'partial');engine.apply(scope,'partial',wide);assert.equal(port.writes,1);
  port.failAfter=0;engine.restore('partial');assert.equal(port.state.cells[0][0].value,1);
});
test('an operation ID collision cannot overwrite data',()=>{
  const {port,engine,scope}=setup();engine.apply(scope,'one',write);faults('operation_collision',()=>engine.apply(scope,'one',plan([])));assert.equal(port.writes,1);
});
test('operation IDs must be plain identifiers',()=>{
  const {engine,scope}=setup();for(const id of ['','a b','x'.repeat(101),null])faults('invalid_operation_id',()=>engine.apply(scope,id,write));
});
test('direct user edits invalidate the pending plan',()=>{
  const {port,engine,scope}=setup();port.state.cells[0][0].value=99;faults('cells_changed',()=>engine.apply(scope,'one',write));assert.equal(port.writes,0);
});
test('scope bounds are enforced before mutation',()=>{
  const {port,engine,scope}=setup();faults('out_of_scope',()=>engine.apply(scope,'one',plan([{type:'set_values',address:'C1',values:[[1]]}])));assert.equal(port.writes,0);
});
test('closed documents never fall back to another workbook',()=>{
  const {port,engine,scope}=setup();port.closed=true;faults('document_closed',()=>engine.apply(scope,'one',write));assert.equal(port.writes,0);
});
test('an expired scope is refused',()=>{
  const {engine}=setup();faults('scope_expired',()=>engine.read('missing'));faults('scope_expired',()=>engine.apply('missing','one',write));
});
test('restore brings back formulas and supported formatting',()=>{
  const {port,engine,scope}=setup(),before=clone(port.state.cells);
  const edit=plan([{type:'set_values',address:'B2',values:[[5]]},{type:'format_range',address:'B2',bold:true,fillColor:'#AA00FF',numberFormat:'0.00'}]);
  assert.equal(engine.apply(scope,'one',edit).applied,true);engine.restore('one');
  // The fake port recomputes display text from values; formulas and formats must match.
  assert.deepEqual(port.state.cells.map(row=>row.map(({displayText,...rest})=>rest)),before.map(row=>row.map(({displayText,...rest})=>rest)));
  engine.restore('one');assert.equal(port.writes,2);
});
test('later user changes prevent a destructive restoration',()=>{
  const {port,engine,scope}=setup();engine.apply(scope,'one',write);port.state.cells[0][1].value=88;faults('recovery_conflict',()=>engine.restore('one'));assert.equal(port.writes,1);
});
test('an unknown change cannot be restored',()=>{
  const {engine}=setup();faults('recovery_expired',()=>engine.restore('missing'));
});
test('a missing readback never reports a successful edit',()=>{
  const {port,engine,scope}=setup();port.loseReadAfterWrite=true;const result=engine.apply(scope,'one',write);
  assert.equal(result.error,'write_uncertain');assert.equal(result.recoverable,false);engine.apply(scope,'one',write);assert.equal(port.writes,1);
});
test('formula errors fail verification and retain recovery',()=>{
  const {port,engine,scope}=setup();port.formulaError=true;
  const result=engine.apply(scope,'one',plan([{type:'set_formulas',address:'A1',formulas:[['=1/0']]}]));
  assert.equal(result.error,'partial_change');assert.equal(result.recoverable,true);
});
test('unsupported operations, values, grids and formulas are rejected before any write',()=>{
  const {port,engine,scope}=setup();let n=0;
  for(const [code,operations] of [
    ['unsupported_operation',[{type:'executevba',address:'A1'}]],
    ['invalid_value',[{type:'set_values',address:'A1',values:[['=1+1']]}]],
    ['invalid_value',[{type:'set_values',address:'A1',values:[[' +1']]}]],
    ['invalid_value',[{type:'set_values',address:'A1',values:[['@x']]}]],
    ['invalid_value',[{type:'set_values',address:'A1',values:[[{a:1}]]}]],
    ['invalid_value',[{type:'set_values',address:'A1',values:[['x'.repeat(10001)]]}]],
    ['invalid_grid',[{type:'set_values',address:'A1:B1',values:[[1]]}]],
    ['invalid_grid',[{type:'set_formulas',address:'A1',formulas:'=1'}]],
    ['unsupported_formula',[{type:'set_formulas',address:'A1',formulas:[['=WEBSERVICE(A2)']]}]],
    ['unsupported_formula',[{type:'set_formulas',address:'A1',formulas:[['=XLOOKUP(1,A1:A2,B1:B2)']]}]],
    ['unsupported_formula',[{type:'set_formulas',address:'A1',formulas:[['=filter (A1:A2,A1:A2>0)']]}]],
    ['unsupported_formula',[{type:'set_formulas',address:'A1',formulas:[["='[other.xlsx]S'!A1"]]}]],
    ['unsupported_formula',[{type:'set_formulas',address:'A1',formulas:[['1+1']]}]],
    ['unsupported_formula',[{type:'set_formulas',address:'A1',formulas:[['='+'1+'.repeat(1000)+'1']]}]],
    ['overlapping_operations',[{type:'format_range',address:'A1',bold:true},{type:'format_range',address:'A1',bold:false}]],
    ['overlapping_operations',[{type:'set_values',address:'A1',values:[[1]]},{type:'set_formulas',address:'A1',formulas:[['=1']]}]],
    ['invalid_plan',[{type:'set_values',address:'A1',values:[[1]],extra:true}]],
    ['invalid_plan',['text']],
    ['invalid_range',[{type:'set_values',values:[[1]]}]]
  ])faults(code,()=>engine.apply(scope,'case-'+n++,plan(operations)));
  faults('invalid_plan',()=>engine.apply(scope,'keys',{operations:[],note:'x'}));
  faults('invalid_plan',()=>engine.apply(scope,'many',plan(Array.from({length:31},()=>({type:'format_range',address:'A1',bold:true})))));
  assert.equal(port.writes,0);
});
test('an empty plan changes nothing and records no receipt',()=>{
  const {port,engine,scope}=setup();assert.deepEqual(engine.apply(scope,'empty',plan([])),{applied:false,changedCells:0});assert.equal(port.writes,0);assert.equal(engine.history().length,0);
});
test('the plan may carry an answer and a formula may be replaced by a value',()=>{
  const {port,engine,scope}=setup();
  const result=engine.apply(scope,'one',{operations:[{type:'set_values',address:'B2',values:[[7]]}],answer:'완료'});
  assert.equal(result.applied,true);assert.deepEqual([port.state.cells[1][1].value,port.state.cells[1][1].formula],[7,null]);
});
test('selection size and text limits are enforced',()=>{
  faults('range_limit',()=>setup(port=>{port.state.address='A1:A1001';}));
  faults('range_limit',()=>setup(port=>{port.state.cells[0][0].value='x'.repeat(120001);}));
});
test('constant Excel errors cannot be overwritten without a faithful restore',()=>{
  const {port,engine,scope}=setup(port=>{port.state.cells[0][0].error=true;});faults('unsupported_target',()=>engine.apply(scope,'one',write));assert.equal(port.writes,0);
});
test('a pre-write failure does not create a false recovery record',()=>{
  const {port,engine,scope}=setup();port.failBefore=true;const result=engine.apply(scope,'one',write);
  assert.equal(result.error,'workbook_not_writable');assert.equal(engine.history().length,0);assert.equal(result.recoverable,false);engine.apply(scope,'one',write);assert.equal(port.writes,0);
});
test('a pre-existing formula error can be faithfully restored',()=>{
  const {port,engine,scope}=setup(port=>{port.state.cells[1][1].error=true;});
  engine.apply(scope,'one',plan([{type:'set_values',address:'B2',values:[[5]]}]));port.formulaError=true;
  assert.equal(engine.restore('one').restored,true);assert.equal(port.state.cells[1][1].error,true);
});
test('unexpected changes outside the patch fail readback and can be restored',()=>{
  const {port,engine,scope}=setup(),before=clone(port.state.cells);port.damageOtherCell=true;
  const result=engine.apply(scope,'one',write);assert.equal(result.error,'partial_change');assert.equal(result.recoverable,true);
  port.damageOtherCell=false;engine.restore('one');assert.deepEqual(port.state.cells.map(row=>row.map(c=>c.value)),before.map(row=>row.map(c=>c.value)));
});
test('new calculation errors in dependent cells fail the readback',()=>{
  const {port,engine,scope}=setup();port.dependentError=true;assert.equal(engine.apply(scope,'one',write).error,'partial_change');
});
test('all supported style fields are written, verified and restored together',()=>{
  const {port,engine,scope}=setup(),before=clone(port.state.cells);
  const result=engine.apply(scope,'styles',plan([{type:'format_range',address:'A1',fontName:'Arial',fontSize:14,fontColor:'#1234ab',italic:true,horizontalAlignment:'center',verticalAlignment:'top',wrapText:true,fillColor:null}]));
  assert.equal(result.applied,true);assert.equal(result.snapshot.formats.fontColor[0][0],'#1234AB');
  engine.restore('styles');assert.deepEqual(port.state.cells,before);
});
test('invalid style attributes are rejected before any write',()=>{
  const {port,engine,scope}=setup();let n=0;
  for(const format of [{fontSize:'huge'},{fontSize:0},{fontSize:500},{fontSize:11.3},{fontColor:'red'},{fontColor:null},{fillColor:'#12345'},{bold:'yes'},{numberFormat:''},{numberFormat:'x'.repeat(121)},{fontName:' '},{horizontalAlignment:'middle'},{verticalAlignment:'left'},{wrapText:1}])
    faults('invalid_format',()=>engine.apply(scope,'format-'+n++,plan([{type:'format_range',address:'A1',...format}])));
  assert.equal(port.writes,0);
});
test('unexpected font damage outside the edit fails verification and can be restored',()=>{
  const {port,engine,scope}=setup(),before=clone(port.state.cells);port.damageFont=true;
  assert.equal(engine.apply(scope,'damage',write).error,'partial_change');port.damageFont=false;engine.restore('damage');
  assert.deepEqual(port.state.cells.map(row=>row.map(c=>[c.value,c.fontColor])),before.map(row=>row.map(c=>[c.value,c.fontColor])));
});
test('validation failures cannot claim success and retain a guarded recovery',()=>{
  const {port,engine,scope}=setup(port=>{port.state.cells[0][0].validation={type:1,operator:1,formula1:'1',formula2:'10'};port.state.cells[0][0].validationValid=true;});
  port.rejectValidation=true;const result=engine.apply(scope,'invalid',write);
  assert.equal(result.error,'partial_change');assert.equal(result.cause,'validation_failed');engine.apply(scope,'invalid',write);assert.equal(port.writes,1);
});
test('unreadable validation and a changed date system cannot be bypassed',()=>{
  const {port,engine,scope}=setup(port=>{port.state.cells[0][0].validation={status:'unreadable'};});
  faults('validation_unavailable',()=>engine.apply(scope,'blocked',write));assert.equal(port.writes,0);
  port.state.date1904=true;faults('cells_changed',()=>engine.apply(scope,'changed',write));assert.equal(port.writes,0);
});
test('unexpected layout drift is not reported as automatically recoverable',()=>{
  const {port,engine,scope}=setup();port.damageLayout=true;const result=engine.apply(scope,'layout',write);
  assert.equal(result.error,'partial_change');assert.equal(result.recoverable,false);assert.equal(engine.history()[0].recoverable,false);faults('unsupported_recovery',()=>engine.restore('layout'));
});
test('worksheet reads do not grant a new editable scope',()=>{
  const {port,engine,scope}=setup();assert.equal(engine.listSheets(scope,0).sourceScopeId,scope);
  const read=engine.readWorkbookRange(scope,'sheet-b','A1:B2');
  assert.equal(Object.hasOwn(read,'scopeId'),false);assert.deepEqual([read.readOnly,read.worksheet,read.kind,read.sheetId,read.sourceScopeId],[true,'Criteria','workbook_range','sheet-b',scope]);
  faults('scope_expired',()=>engine.apply('sheet-b','foreign',write));assert.equal(port.writes,0);
});
test('source fingerprint drift blocks edits before any mutation',()=>{
  const {port,engine,scope}=setup(),read=engine.readWorkbookRange(scope,'sheet-b','A1:B2');
  const guarded={...clone(write),sourceDependencies:[{sheetId:'sheet-b',address:'A1:B2',fingerprint:read.fingerprint}]};
  port.source.cells[0][0].value=999;faults('source_changed',()=>engine.apply(scope,'stale-source',guarded));assert.equal(port.writes,0);
  guarded.sourceDependencies[0].fingerprint=engine.readWorkbookRange(scope,'sheet-b','A1:B2').fingerprint;
  assert.equal(engine.apply(scope,'fresh-source',guarded).applied,true);assert.equal(port.writes,1);
  port.source.cells[0][0].value=1000;assert.equal(engine.apply(scope,'fresh-source',guarded).applied,true);assert.equal(port.writes,1);
});
test('source dependencies cannot escape the bound workbook or omit their fingerprint',()=>{
  const {port,engine,scope}=setup();
  faults('out_of_scope',()=>engine.apply(scope,'foreign-source',{...clone(write),sourceDependencies:[{sheetId:'foreign',address:'A1:B2',fingerprint:'x'}]}));
  faults('invalid_plan',()=>engine.apply(scope,'missing-hash',{...clone(write),sourceDependencies:[{sheetId:'sheet-b',address:'A1:B2'}]}));
  faults('invalid_plan',()=>engine.apply(scope,'too-many',{...clone(write),sourceDependencies:Array.from({length:9},()=>({sheetId:'sheet-b',address:'A1:B2',fingerprint:'x'}))}));
  assert.equal(port.writes,0);
});
test('a merged anchor accepts only values and keeps its layout on restore',()=>{
  const {port,engine,scope}=setup(port=>{port.state.cells[0][0].mergedAddress='A1:B1';Object.assign(port.state.cells[0][1],{mergedAddress:'A1:B1',value:null,displayText:''});});
  const before=clone(port.state.cells);
  assert.equal(engine.apply(scope,'merged-input',write).applied,true);assert.equal(port.state.cells[0][1].mergedAddress,'A1:B1');
  engine.restore('merged-input');assert.deepEqual(port.state.cells.map(row=>row.map(c=>[c.value,c.mergedAddress])),before.map(row=>row.map(c=>[c.value,c.mergedAddress])));
});
test('merged followers, partial merges, formulas and style changes fail before mutation',()=>{
  for(const [merge,row,column,field] of [['A1:B1',1,2,'value'],['A1:C1',1,1,'value'],['A1:B1',1,1,'formula'],['A1:B1',1,1,'bold']]){
    const port=fakePort();port.state.cells[0][0].mergedAddress=merge;port.state.cells[0][1].mergedAddress=merge;
    faults('unsupported_target',()=>validateTarget(port.state,row,column,field));
  }
  const {port,engine,scope}=setup(port=>{port.state.cells[0][0].mergedAddress='A1:B1';port.state.cells[0][0].formula='=2';});
  faults('unsupported_target',()=>engine.apply(scope,'formula-anchor',write));assert.equal(port.writes,0);
});
test('array formulas and hidden cells are not writable targets',()=>{
  for(const field of ['arrayFormula','hiddenRow','hiddenColumn']){
    const {port,engine,scope}=setup(port=>{port.state.cells[0][0][field]=true;});faults('unsupported_target',()=>engine.apply(scope,'one',write));assert.equal(port.writes,0);
  }
});
test('protected and read-only states reject writes and stay visible in observations',()=>{
  for(const readOnly of [true,false]){
    const port=fakePort();port.state.readOnly=readOnly;port.state.protected=!readOnly;const engine=createEngine(port),observation=engine.selection();
    assert.equal(observation[readOnly?'readOnly':'protected'],true);faults('workbook_not_writable',()=>engine.apply(observation.scopeId,'locked',write));assert.equal(port.writes,0);
  }
});
test('a bound state requires the expected fingerprint',()=>{
  const {port,engine,scope}=setup(),current=engine.read(scope).fingerprint;
  assert.equal(engine.boundState(scope,current).address,'A1:B2');faults('cells_changed',()=>engine.boundState(scope,'other'));
  port.state.cells[0][0].value=5;faults('cells_changed',()=>engine.boundState(scope,current));
});
test('the public state exposes the native grids and a stable fingerprint',()=>{
  const {port,engine,scope}=setup(),state=engine.read(scope);
  assert.deepEqual(Object.keys(state),['scopeId','documentId','worksheet','workbook','address','date1904','readOnly','protected','values','formulas','errors','displayTexts','formats','properties','fingerprint']);
  assert.deepEqual(Object.keys(state.formats),['bold','italic','fillColor','numberFormat','fontName','fontSize','fontColor','horizontalAlignment','verticalAlignment','wrapText']);
  assert.deepEqual(Object.keys(state.properties),['locked','mergedAddress','arrayFormula','validation','rowHeight','columnWidth','hiddenRow','hiddenColumn','borders','validationValid']);
  assert.deepEqual(state.values,[[1,2],[3,3]]);assert.deepEqual(state.formulas,[[null,null],[null,'=SUM(A1:B1)']]);assert.deepEqual(state.properties.hiddenRow,[[null,null],[null,null]]);
  assert.equal(state.fingerprint,engine.read(scope).fingerprint);assert.equal(state.fingerprint,fingerprint(port.state));assert.equal(describe(port.state).scopeId,'');
  port.state.cells[0][0].value=9;assert.notEqual(engine.read(scope).fingerprint,state.fingerprint);
});
test('the change history lists the newest change first with a preview',()=>{
  const {engine,scope}=setup();engine.apply(scope,'one',write);engine.apply(scope,'two',plan([{type:'format_range',address:'B1',bold:true}]));
  const history=engine.history();assert.deepEqual(history.map(item=>item.id),['two','one']);
  assert.deepEqual(history[1].preview,[{cell:'A1',field:'value',before:1,after:42}]);assert.deepEqual([history[1].restored,history[1].partial,history[1].recoverable,history[1].previewTotal],[false,false,true,1]);
});
