// Actual Pi -> normalized plan -> compiled WorkbookEngine. Excel COM/model responses are test doubles.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startAgent} from '../worker/agent.mjs';
import {scriptedProvider,contract,planCall,text,drive} from './harness-fixtures.mjs';
const host=spawn(process.env.NUBI_DOTNET||'dotnet',['native/Nubi.Office.Tests/bin/Release/net8.0/Nubi.Office.Tests.dll','--rpc'],{stdio:['pipe','pipe','inherit']}),pending=new Map();let serial=0;
createInterface({input:host.stdout}).on('line',line=>{const reply=JSON.parse(line),p=pending.get(reply.id);pending.delete(reply.id);reply.ok?p.resolve(reply.result):p.reject(new Error(reply.error));});
const rpc=(method,payload={})=>new Promise((resolve,reject)=>{const id=String(++serial);pending.set(id,{resolve,reject});host.stdin.write(JSON.stringify({id,method,payload})+'\n');});
try {
  const initial=await rpc('selection');
  await rpc('apply',{scopeId:initial.scopeId,operationId:'reference-style',plan:{operations:[{type:'format_range',address:'B2',fontName:'Arial',fontSize:14,fontColor:'#1B64DA',horizontalAlignment:'center'}]}});
  const before=await rpc('selection'),checks=[
    {address:'A1',field:'value',operator:'equals',expected:'00123'}, {address:'A1',field:'numberFormat',operator:'equals',expected:'@'},
    {address:'B1',field:'value',operator:'equals',expected:.125},{address:'B1',field:'numberFormat',operator:'equals',expected:'0.0%'},
    {address:'A2',field:'value',operator:'equals',expected:'2026-09-23',valueType:'date'},{address:'A2',field:'numberFormat',operator:'equals',expected:'yyyy-mm-dd'},
    ...Object.entries({fontName:'Arial',fontSize:14,fontColor:'#1B64DA',horizontalAlignment:'center'}).map(([field,expected])=>({address:'A1:B1',field,operator:'equals',expected}))
  ];
  const operations=[{type:'set_typed_values',address:'A1',valueType:'text',values:[['00123']]},{type:'set_typed_values',address:'B1',valueType:'percent',values:[['12.5%']],numberFormat:'0.0%'},{type:'set_typed_values',address:'A2',valueType:'date',values:[['2026-09-23']]},{type:'copy_format',address:'A1:B1',sourceAddress:'B2',fields:['fontName','fontSize','fontColor','horizontalAlignment']}];
  const run=startAgent({request:'A1에 코드 00123, B1에 12.5%(소수점 한 자리), A2에 2026-09-23 날짜를 넣고 A1:B1의 글꼴과 크기, 색, 가로 정렬은 B2와 맞춰줘. 기존 수식은 유지해줘.',scope:before,mode:'edit',providers:scriptedProvider({task:contract(checks),actor:[planCall(operations),text('값의 형식과 기준 셀 서식을 반영하고 수식을 유지했습니다.')]})});
  const result=await drive(run,action=>rpc(action.name==='apply_changes'?'apply':'read',{scopeId:action.scopeId,operationId:action.callId,plan:action.plan}));
  assert.equal(result.state,'done');assert.equal(result.writes,1);
  const after=await rpc('read',{scopeId:before.scopeId});
  assert.equal(after.values[0][0],'00123');assert.equal(after.values[0][1],.125);assert.equal(after.values[1][0],46288);
  assert.equal(after.formulas[1][1],before.formulas[1][1]);assert.equal(after.formats.fontName[0][0],'Arial');assert.equal(after.formats.fontSize[0][1],14);assert.equal(after.formats.numberFormat[0][0],'@');assert.equal(after.formats.numberFormat[0][1],'0.0%');
  const history=await rpc('history');assert.equal(history.length,2);assert.ok(history[0].preview.length>6);
  await rpc('restore',{changeId:history[0].id});const restored=await rpc('read',{scopeId:before.scopeId});assert.deepEqual(restored.values,before.values);assert.deepEqual(restored.formats,before.formats);assert.deepEqual(restored.formulas,before.formulas);
  await mkdir('verification',{recursive:true});await writeFile('verification/value-format-native.json',JSON.stringify({checkedAt:new Date().toISOString(),engine:'real Pi and compiled WorkbookEngine',excelCom:'simulated',model:'scripted',checks:result.validation.checks,state:result.state,typedInput:true,referenceStyle:true,formulaPreserved:true,restore:true,liveExcelVerified:false,realModelAccuracy:null},null,2)+'\n');
  console.log('PASS: code, percent, date, reference font/alignment, formula preservation and restore across Pi -> compiled native engine. COM/model responses simulated.');
}finally {host.stdin.end();host.kill();}
