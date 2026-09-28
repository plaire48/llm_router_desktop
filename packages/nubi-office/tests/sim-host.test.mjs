import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimHost,hostAction} from '../eval/sim/host.mjs';
import {startAgent} from '../worker/agent.mjs';
import {createTemplateSession} from '../worker/template.mjs';
import {createTemplateRecord} from '../worker/template-library.mjs';
import {scriptedProvider,contract,valueCheck,planCall,valueEdit,text,drive} from './harness-fixtures.mjs';

const edit={id:'value',mode:'edit',range:'A1:B4',auditRange:'A1:F6',cells:{A1:{value:'금액'},A2:{value:100},A3:{value:250},A4:{formula:'=SUM(A2:A3)',numberFormat:'0.00'},B4:{value:'지우지 마세요',bold:true},F6:{value:'보존'}}};
const form={id:'form',mode:'template',range:'A1:C4',auditRange:'A1:F6',workbookName:'업무요청.xlsx',sheetName:'요청서',merges:['B2:C2'],cells:{A1:{value:'업무 요청'},A2:{value:'담당 부서'},A3:{value:'수량'},B3:{value:2},A4:{value:'금액'},B4:{formula:'=B3*1000'}}};
const rejects=(code,promise)=>assert.rejects(promise,error=>error.code===code,code);
function record(scope,fields=[{address:'B2',label:'담당 부서',valueType:'text',required:true}]){
  const session=createTemplateSession(scope);session.confirm(session.propose(fields,scope),scope);
  return createTemplateRecord({name:'업무 요청서',purpose:'부서별 업무 요청',notes:'',profile:session.profile(),model:{model:'fixture',provider:'fixture'}});
}

test('init returns the edit scope, the audit observation and a simulated host marker',async()=>{
  const host=createSimHost(),initial=await host.call('init',edit);
  assert.deepEqual([initial.scope.address,initial.before.address,initial.scope.worksheet,initial.scope.workbook],['A1:B4','A1:F6','CaseSheet','Book1.xlsx']);
  assert.deepEqual([initial.host.evaluationProtocol,initial.host.simulated,initial.host.platform],[4,true,'simulated']);
  assert.deepEqual(initial.scope.values,[['금액',null],[100,null],[250,null],[350,'지우지 마세요']]);
  assert.equal(initial.scope.formats.bold[3][1],true);assert.equal(initial.scope.displayTexts[3][0],'350.00');assert.deepEqual(initial.sourcesBefore,[]);
  assert.notEqual(initial.scope.scopeId,initial.before.scopeId);
});
test('document mode is refused because no document host is simulated',async()=>{
  await rejects('evaluation_mode_not_supported',createSimHost().call('init',{...edit,mode:'document'}));
});
test('merges, named sheets and source sheets are built from the case',async()=>{
  const host=createSimHost(),initial=await host.call('init',{...form,sourceSheets:[{name:'동부',auditRange:'A1:C4',cells:{B2:{value:120}}}]});
  assert.deepEqual([initial.scope.workbook,initial.scope.worksheet],['업무요청.xlsx','요청서']);
  assert.deepEqual(initial.scope.properties.mergedAddress[1],[null,'B2:C2','B2:C2']);
  assert.deepEqual(initial.sourcesBefore.map(s=>[s.worksheet,s.address,s.values[1][1]]),[['동부','A1:C4',120]]);
});
test('an applied change is visible in the audit and other sheets stay unchanged',async()=>{
  const host=createSimHost(),initial=await host.call('init',{...edit,sourceSheets:[{name:'동부',auditRange:'A1:C4',cells:{B2:{value:120}}}]});
  const result=await host.call('apply',{scopeId:initial.scope.scopeId,operationId:'op-1',plan:{operations:[{type:'set_values',address:'A2',values:[[150]]}]}});
  assert.equal(result.applied,true);assert.equal(result.snapshot.values[3][0],400);
  const after=await host.call('audit');assert.equal(after.values[1][0],150);assert.equal(after.values[5][5],'보존');
  assert.deepEqual((await host.call('auditSources')).map(s=>s.fingerprint),initial.sourcesBefore.map(s=>s.fingerprint));
  assert.equal((await host.call('read',{scopeId:initial.scope.scopeId})).values[1][0],150);
  assert.equal((await host.call('history')).length,1);
});
test('a rejected plan reports the native error code',async()=>{
  const host=createSimHost(),initial=await host.call('init',edit);
  await rejects('out_of_scope',host.call('apply',{scopeId:initial.scope.scopeId,operationId:'op-1',plan:{operations:[{type:'set_values',address:'F6',values:[[1]]}]}}));
  await rejects('unknown_method',host.call('format_disk'));
});
test('restore and reconcile reach the engine',async()=>{
  const host=createSimHost(),initial=await host.call('init',edit),plan={operations:[{type:'set_values',address:'A2',values:[[1]]}]};
  await host.call('apply',{scopeId:initial.scope.scopeId,operationId:'op-1',plan});
  assert.equal((await host.call('reconcile',{scopeId:initial.scope.scopeId,operationId:'op-1',plan})).outcome,'complete');
  assert.equal((await host.call('restore',{changeId:'op-1'})).restored,true);assert.equal((await host.call('audit')).values[1][0],100);
});
test('save and reopen keeps inputs and formats and recalculates formulas',async()=>{
  const host=createSimHost(),initial=await host.call('init',edit);
  await host.call('apply',{scopeId:initial.scope.scopeId,operationId:'op-1',plan:{operations:[{type:'set_values',address:'A3',values:[[300]]}]}});
  const after=await host.call('audit'),reopened=await host.call('saveReopen',{path:'/sim/value.xlsx'});
  assert.deepEqual(reopened.values,after.values);assert.deepEqual(reopened.formulas,after.formulas);assert.deepEqual(reopened.formats,after.formats);
  assert.equal(reopened.readOnly,true);assert.notEqual(reopened.documentId,after.documentId);
  await rejects('document_closed',host.call('read',{scopeId:initial.scope.scopeId}));
  await rejects('invalid_artifact_path',host.call('saveReopen',{path:'/sim/value.xlsx'}));
  await rejects('invalid_artifact_path',host.call('saveReopen',{path:'/sim/value.xls'}));
});
test('worksheet discovery pages sheets and range reads stay read-only',async()=>{
  const host=createSimHost(),initial=await host.call('init',{...edit,sourceSheets:[{name:'동부',auditRange:'A1:C4',cells:{B1:{value:'매출'},B2:{value:120}}}]}),scopeId=initial.scope.scopeId;
  await rejects('out_of_scope',host.call('workbook_range',{scopeId,sheetId:'guess',address:'A1:B2'}));
  const catalog=await host.call('workbook_sheets',{scopeId});
  assert.deepEqual([catalog.kind,catalog.total,catalog.nextOffset,catalog.sourceScopeId,catalog.workbook],['worksheet_catalog',2,null,scopeId,'Book1.xlsx']);
  assert.deepEqual(catalog.items.map(item=>[item.name,item.protected]),[['CaseSheet',false],['동부',false]]);
  const sheetId=catalog.items[1].sheetId,read=await host.call('workbook_range',{scopeId,sheetId,address:'A1:B2'});
  assert.deepEqual([read.kind,read.readOnly,read.sourceScopeId,read.sheetId,read.worksheet,read.documentId],['workbook_range',true,scopeId,sheetId,'동부',initial.scope.documentId]);
  assert.deepEqual(read.values,[[null,'매출'],[null,120]]);assert.equal(Object.hasOwn(read,'scopeId'),false);
  const layout=await host.call('workbook_structure',{scopeId,sheetId,part:'layout'});
  assert.deepEqual([layout.kind,layout.part,layout.worksheet,layout.items[0].usedRangeHint],['worksheet_structure','layout','동부','B1:B2']);
  assert.deepEqual((await host.call('workbook_structure',{scopeId,sheetId,part:'tables'})).items,[]);
  await rejects('unsupported_operation',host.call('workbook_structure',{scopeId,sheetId,part:'macros'}));
  await rejects('range_limit',host.call('workbook_range',{scopeId,sheetId,address:'A1:A1001'}));
});
test('registering a template saves a copy with the record and leaves the source unchanged',async()=>{
  const host=createSimHost(),initial=await host.call('init',form),scope=initial.scope,item=record(scope);
  const result=await host.call('template_register',{scopeId:scope.scopeId,record:item,expectedFingerprint:scope.fingerprint});
  assert.deepEqual([result.saved,result.id,result.metadataVerified,result.protectionMode,result.nascaEncryptionVerified],[true,item.id,true,'nasca_excel_managed',false]);
  assert.match(result.path,/\.xlsx$/);
  assert.deepEqual(result.comparison.before.values,scope.values);assert.deepEqual(result.comparison.after.values,scope.values);assert.deepEqual(result.comparison.after.formulas,scope.formulas);
  assert.notEqual(result.comparison.after.documentId,scope.documentId);
  assert.equal((await host.call('read',{scopeId:scope.scopeId})).fingerprint,scope.fingerprint);
  const indexed=await host.call('template_catalog_index',{templateId:item.id});
  assert.deepEqual([indexed.catalogued,indexed.id,indexed.entry.name,indexed.entry.host,indexed.entry.inputCount,indexed.entry.available],[true,item.id,'업무 요청서','excel',1,true]);
});
test('registration refuses a changed source, a mismatched record and an unknown template',async()=>{
  const host=createSimHost(),initial=await host.call('init',form),scope=initial.scope,item=record(scope);
  await rejects('cells_changed',host.call('template_register',{scopeId:scope.scopeId,record:item,expectedFingerprint:'stale'}));
  await rejects('template_record_invalid',host.call('template_register',{scopeId:scope.scopeId,record:{...item,profile:{...item.profile,address:'A1:B2'}},expectedFingerprint:scope.fingerprint}));
  await rejects('template_record_invalid',host.call('template_register',{scopeId:scope.scopeId,record:{...item,id:'not-a-guid'},expectedFingerprint:scope.fingerprint}));
  await rejects('template_record_invalid',host.call('template_register',{scopeId:scope.scopeId,expectedFingerprint:scope.fingerprint}));
  await rejects('template_not_found',host.call('template_catalog_index',{templateId:item.id}));
  await rejects('template_not_found',host.call('template_catalog_use',{templateId:item.id}));
});
test('a non-xlsx workbook cannot be registered',async()=>{
  const host=createSimHost(),initial=await host.call('init',{...form,workbookName:'업무요청.xlsm'});
  await rejects('template_format_unsupported',host.call('template_register',{scopeId:initial.scope.scopeId,record:record(initial.scope),expectedFingerprint:initial.scope.fingerprint}));
});
test('using a registered template opens an independent copy bound to a new scope',async()=>{
  const host=createSimHost(),initial=await host.call('init',form),item=record(initial.scope);
  const saved=await host.call('template_register',{scopeId:initial.scope.scopeId,record:item,expectedFingerprint:initial.scope.fingerprint});
  await host.call('template_catalog_index',{templateId:item.id});
  const opened=await host.call('template_catalog_use',{templateId:item.id});
  assert.deepEqual([opened.copied,opened.scope.address,opened.scope.worksheet,opened.entry.id],[true,'A1:C4','요청서',item.id]);assert.deepEqual(opened.record,item);
  assert.notEqual(opened.scope.documentId,initial.scope.documentId);assert.notEqual(opened.scope.documentId,saved.comparison.after.documentId);
  const written=await host.call('apply',{scopeId:opened.scope.scopeId,operationId:'fill-1',plan:{operations:[{type:'set_values',address:'B2',values:[['인사']]}]}});
  assert.equal(written.applied,true);
  assert.equal((await host.call('audit')).values[1][1],'인사');
  assert.equal((await host.call('read',{scopeId:initial.scope.scopeId})).values[1][1],null);
  const again=await host.call('template_catalog_use',{templateId:item.id});assert.equal(again.scope.values[1][1],null);assert.notEqual(again.path,opened.path);
});
test('host actions translate agent requests and turn rejections into error results',async()=>{
  const host=createSimHost(),initial=await host.call('init',edit),scopeId=initial.scope.scopeId;
  assert.equal((await hostAction(host,{name:'read_selection',scopeId,callId:'c1'})).fingerprint,initial.scope.fingerprint);
  assert.equal((await hostAction(host,{name:'apply_changes',scopeId,callId:'c2',plan:{operations:[{type:'set_values',address:'A2',values:[[7]]}]}})).applied,true);
  assert.deepEqual(await hostAction(host,{name:'apply_changes',scopeId,callId:'c3',plan:{operations:[{type:'set_values',address:'F6',values:[[7]]}]}}),{error:'out_of_scope'});
  assert.equal((await hostAction(host,{name:'workbook_sheets',scopeId,callId:'c4',payload:{offset:0}})).kind,'worksheet_catalog');
  assert.equal((await hostAction(host,{name:'restore_change',scopeId,callId:'c5',payload:{changeId:'c2'}})).restored,true);
  await assert.rejects(hostAction(host,{name:'document_save',scopeId,callId:'c6',payload:{}}),/evaluation_action_not_supported/);
});
test('the real Excel agent completes an edit against the simulated host',async()=>{
  const host=createSimHost(),initial=await host.call('init',{...edit,range:'A1:B1',cells:{A1:{value:1},B1:{value:2}}});
  const providers=scriptedProvider({task:contract([valueCheck(42)]),actor:[planCall([valueEdit(42)]),text('A1을 42로 변경했습니다.')]});
  const run=startAgent({request:'A1을 42로 바꿔줘',mode:'edit',scope:initial.scope,providers,resilienceOptions:{wait:async()=>{},random:()=>0}});
  const status=await drive(run,action=>hostAction(host,action));
  assert.equal(status.state,'done',status.error);assert.equal(status.writes,1);
  assert.deepEqual((await host.call('audit')).values[0].slice(0,2),[42,2]);
});
