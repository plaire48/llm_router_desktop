// The form map is given to the executor before its first decision, so a form
// is understood from one compact overview instead of 20-cell pages.
// Replies are scripted: a pass proves what the harness supplies, not model quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startAgent} from '../worker/agent.mjs';
import {createSimHost,hostAction} from '../eval/sim/host.mjs';
import {installTemplates} from '../eval/sim/catalog.mjs';
import {formById} from '../eval/sim/forms.mjs';
import {contract,text,call,verdict} from './harness-fixtures.mjs';

const fast={wait:async()=>{},random:()=>0};
function scripted({task,actor}){
  const seen={actor:[]};let turn=0;
  return{seen,status:()=>({model:'scripted-control-fixture',provider:'fixture'}),complete:async(messages,tools)=>{
    const system=messages[0].content;
    if(system.startsWith('NUBI_TASK_PLANNER'))return text(JSON.stringify(task));
    if(/^NUBI_(ACTION|STEP|RESULT)_REVIEWER/.test(system))return verdict(JSON.parse(messages[1].content));
    seen.actor.push({messages,tools});return actor[turn++]??text('완료했습니다.');
  }};
}
async function run(options,host){
  const agent=startAgent({resilienceOptions:fast,...options});
  for(let i=0;i<2000;i++){
    const status=agent.status();if(status.state!=='running'){await agent.promise;return agent.status();}
    const action=status.action;
    if(action)agent.respond(action.callId,action.name==='show_plan'?{displayed:true}:action.name==='request_approval'?{approved:true}:await hostAction(host,action));
    await new Promise(resolve=>setImmediate(resolve));
  }
  agent.cancel();await agent.promise;throw new Error('test timed out');
}
const shown=providers=>providers.seen.actor[0].messages.filter(message=>message.role==='user').map(message=>{try{return JSON.parse(message.content);}catch{return null;}}).find(value=>value?.formMap);

test('registration starts with the form map and needs no paging to define the fields',async()=>{
  const form=formById('quotation'),host=createSimHost(),{scope}=await host.call('init',form);
  const providers=scripted({task:contract([],{intent:'analyze'}),actor:[call('define_template_fields',{fields:form.fields}),call('register_template',{name:form.title,purpose:form.purpose}),text('양식을 등록했습니다.')]});
  const status=await run({request:form.register.request,scope,mode:'template-register',providers},host);
  assert.equal(status.state,'done',status.error);
  const context=shown(providers);assert.ok(context,'the first request of the executor carries the form map');
  assert.deepEqual([context.formMap.worksheet,context.formMap.address],[scope.worksheet,scope.address]);
  // A table is described by its columns; its input cells are the input columns of every row.
  const tableCells=context.formMap.tables.flatMap(table=>table.columns.filter(column=>column.role==='input').flatMap(column=>Array.from({length:table.lastRow-table.firstRow+1},(_,row)=>column.column+(table.firstRow+row))));
  const offered=new Set([...context.formMap.inputs.map(input=>input.address),...tableCells]);
  assert.deepEqual(form.fields.map(field=>field.address).filter(address=>!offered.has(address)),[],'every answer-key field is visible in the overview');
  assert.match(providers.seen.actor[0].messages[0].content,/formMap/,'the guidance says how to use the overview');
  assert.ok(JSON.stringify(context).length<4000,'the overview stays small');
  assert.equal(status.trace.filter(item=>item.tool==='inspect_template').length,0);
});
test('the map is a hint: the confirmed mapping still goes through the same checks',async()=>{
  const form=formById('expense-report'),host=createSimHost(),{scope}=await host.call('init',form);
  const providers=scripted({task:contract([],{intent:'analyze'}),actor:[call('define_template_fields',{fields:[{address:'B8',label:'부가세',valueType:'number',required:true}]}),text('등록하지 못했습니다.')]});
  await run({request:form.register.request,scope,mode:'template-register',providers},host).catch(()=>{});
  const rejected=providers.seen.actor[1].messages.at(-1).content;
  assert.match(typeof rejected==='string'?rejected:JSON.stringify(rejected),/formula|수식/i,'a computed cell is still refused as an input');
});
test('filling a registered template shows the confirmed fields, not a second map',async()=>{
  const form=formById('expense-report'),host=createSimHost(),installed=await installTemplates(host,[form]);
  const opened=await host.call('template_catalog_use',{templateId:installed.get(form.id).record.id});
  const providers=scripted({task:contract(Object.keys(form.reuse.values).map(address=>({address,field:'value',operator:'not_empty'}))),
    actor:[call('fill_template_fields',{values:Object.entries(form.reuse.values).map(([address,value])=>({fieldId:'field_'+address,value}))}),text('작성했습니다.')]});
  const status=await run({request:form.reuse.request,scope:opened.scope,mode:'template',providers,templateRecord:opened.record,templateBinding:{documentId:opened.scope.documentId,worksheet:opened.scope.worksheet,address:opened.scope.address}},host);
  assert.equal(status.state,'done',status.error);assert.equal(shown(providers),undefined);
});
test('an ordinary edit is not given a form map',async()=>{
  const host=createSimHost(),{scope}=await host.call('init',{id:'plain',mode:'edit',workbookName:'a.xlsx',sheetName:'Sheet1',range:'A1:B2',auditRange:'A1:B2',cells:{A1:{value:'값'},A2:{value:1}}});
  const providers=scripted({task:contract([{address:'A2',field:'value',operator:'equals',expected:4}]),actor:[call('apply_changes',{plan:JSON.stringify({operations:[{type:'set_values',address:'A2',values:[[4]]}]})}),text('바꿨습니다.')]});
  const status=await run({request:'A2를 4로 바꿔줘',scope,mode:'edit',providers},host);
  assert.equal(status.state,'done',status.error);assert.equal(shown(providers),undefined);
});
