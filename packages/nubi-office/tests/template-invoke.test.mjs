// A registered template is called by "/name" or by a sentence about it. The
// host opens a fresh copy of the saved form and the executor fills that copy.
// Model replies are scripted: these tests prove the routing rules only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startIntentAgent,parseIntent} from '../worker/intent-agent.mjs';
import {createSimHost,hostAction} from '../eval/sim/host.mjs';
import {installTemplates,blankWorkbook} from '../eval/sim/catalog.mjs';
import {forms,formById,catalogForms} from '../eval/sim/forms.mjs';
import {contract,text,call,verdict} from './harness-fixtures.mjs';

const fast={wait:async()=>{},random:()=>0};
async function office(templates=catalogForms){
  const host=createSimHost(),installed=await installTemplates(host,templates),blank=await host.call('init',blankWorkbook);
  return{host,installed,scope:blank.scope};
}
const fillCall=form=>call('fill_template_fields',{values:Object.entries(form.reuse.values).map(([address,value])=>({fieldId:'field_'+address,value}))});
function scripted({router=[],form,actor}){
  const seen={router:[],planner:[],actor:[]};let routed=0,turn=0;
  const task=contract(Object.keys(form?.reuse.values||{A2:1}).map(address=>({address,field:'value',operator:'not_empty'})));
  return{seen,status:()=>({model:'scripted-control-fixture',provider:'fixture'}),complete:async(messages,tools)=>{
    const system=messages[0].content;
    if(system.startsWith('NUBI_INTENT_ROUTER')){seen.router.push(messages);return text(JSON.stringify(router[routed++]??{mode:'analyze'}));}
    if(system.startsWith('NUBI_TASK_PLANNER')){seen.planner.push(messages);return text(JSON.stringify(task));}
    if(/^NUBI_(ACTION|STEP|RESULT)_REVIEWER/.test(system))return verdict(JSON.parse(messages[1].content));
    seen.actor.push({messages,tools});return(actor??[fillCall(form),text('작성했습니다.')])[turn++]??text('완료했습니다.');
  }};
}
async function drive(agent,host,{answers=[],decline=[]}={}){
  const actions=[],questions=[];
  for(let i=0;i<3000;i++){
    const status=agent.status();if(status.state!=='running'){await agent.promise;return{status:agent.status(),actions,questions};}
    const action=status.action;
    if(action){
      actions.push(action.name);let result;
      if(action.name==='show_plan')result={displayed:true};
      else if(action.name==='request_approval')result={approved:true};
      else if(action.name==='request_input'){questions.push(action.payload);result={text:answers.shift()??'모름'};}
      else if(decline.includes(action.name))result={cancelled:true};
      else result=await hostAction(host,action);
      agent.respond(action.callId,result);
    }
    await new Promise(resolve=>setImmediate(resolve));
  }
  agent.cancel();await agent.promise;throw new Error('test timed out');
}
const start=(request,scope,providers,extra={})=>startIntentAgent({request,scope,mode:'auto',providers,resilienceOptions:fast,templateCatalog:true,...extra});

test('a command with the exact name opens a copy of that template without asking the model to route',async()=>{
  const form=formById('quotation'),{host,installed,scope}=await office(),providers=scripted({form});
  const {status,actions}=await drive(start('/견적서 '+form.reuse.request,scope,providers),host);
  assert.equal(status.state,'done',status.error);assert.equal(providers.seen.router.length,0);
  assert.deepEqual(actions.slice(0,2),['template_catalog_list','template_catalog_use']);
  assert.deepEqual([status.templateCopy.entry.name,status.templateCopy.record.id,status.executionMode],['견적서',installed.get('quotation').record.id,'template']);
  assert.notEqual(status.templateCopy.documentId,scope.documentId);assert.equal(status.templateCopy.address,form.range);
  // The copy is compared with the saved form; the status carries the report, not both snapshots.
  assert.deepEqual([status.templateCopy.preservation.stage,status.templateCopy.preservation.differenceCount,status.templateCopy.comparison],['opened_copy',0,undefined]);
  assert.ok(JSON.stringify(status.templateCopy).length<20000,'the polled status stays small');assert.ok(status.preservation,'the executor reports what was preserved after the input');
  assert.equal(JSON.parse(providers.seen.planner[0][1].content).request,form.reuse.request,'the command prefix is not part of the task');
  const after=await host.call('audit',{range:form.auditRange});assert.deepEqual([after.values[2][1],after.values[12][5]],['대한상사',605000]);
  assert.equal((await host.call('read',{scopeId:scope.scopeId})).fingerprint,scope.fingerprint,'the workbook that was open stays untouched');
});
test('a command without further text asks the executor to fill the named form',async()=>{
  const form=formById('expense-report'),{host,scope}=await office(),providers=scripted({form});
  const {status}=await drive(start('/지출결의서',scope,providers),host);
  assert.equal(status.state,'done',status.error);assert.match(JSON.parse(providers.seen.planner[0][1].content).request,/지출 결의서/);
});
test('a command that fits several templates lets the user choose by name',async()=>{
  const form=formById('trip-request'),{host,scope}=await office(),providers=scripted({form});
  const {status,questions}=await drive(start('/출장 '+form.reuse.request,scope,providers),host,{answers:['출장 신청서','50000']});
  assert.equal(status.state,'done',status.error);assert.equal(status.templateCopy.entry.name,'출장 신청서');
  assert.deepEqual(questions[0].options.map(option=>option.label),['출장 신청서','출장 정산서']);assert.equal(providers.seen.router.length,0);
});
test('an answer that names none of the offered templates opens nothing',async()=>{
  const {host,scope}=await office(),providers=scripted({form:formById('trip-request')});
  const {status,actions}=await drive(start('/출장',scope,providers),host,{answers:['회의록']});
  assert.equal(status.state,'unsupported');assert.equal(actions.includes('template_catalog_use'),false);assert.match(status.answer,/출장 신청서/);
});
test('an unknown command reports the registered templates and changes nothing',async()=>{
  const {host,scope}=await office(),providers=scripted({form:formById('quotation')});
  const {status,actions}=await drive(start('/회의록 오늘 회의 내용 정리',scope,providers),host);
  assert.equal(status.state,'unsupported');assert.deepEqual(actions,['template_catalog_list']);
  assert.match(status.answer,/회의록/);assert.match(status.answer,/견적서/);assert.equal(status.templateCopy,undefined);
  assert.equal(providers.seen.router.length+providers.seen.planner.length+providers.seen.actor.length,0);
});
test('a sentence about a registered template is routed with the matching candidates',async()=>{
  const form=formById('trip-request'),{host,installed,scope}=await office(),id=installed.get('trip-request').record.id;
  const providers=scripted({form,router:[{mode:'template',templateId:id}]});
  const {status,actions}=await drive(start(form.reuse.request,scope,providers),host,{answers:['50000']});
  assert.equal(status.state,'done',status.error);assert.equal(status.templateCopy.entry.name,'출장 신청서');
  assert.deepEqual(actions.slice(0,2),['template_catalog_list','template_catalog_use']);
  const offered=JSON.parse(providers.seen.router[0].at(-1).content).registeredTemplates;
  assert.equal(offered[0].id,id);assert.deepEqual(Object.keys(offered[0]),['id','name','summary']);assert.ok(offered.length<=4);
  assert.match(providers.seen.router[0][0].content,/registeredTemplates/);
});
test('the router cannot choose a template that was not offered',async()=>{
  const form=formById('trip-request'),{host,installed,scope}=await office(),id=installed.get('trip-request').record.id;
  const providers=scripted({form,router:[{mode:'template',templateId:installed.get('quotation').record.id.replace(/.$/,'0')},{mode:'template',templateId:id}]});
  const {status}=await drive(start(form.reuse.request,scope,providers),host,{answers:['50000']});
  assert.equal(status.state,'done',status.error);assert.equal(providers.seen.router.length,2);
  assert.match(JSON.parse(providers.seen.router[1].at(-1).content).issue,/templateId/);assert.equal(status.templateCopy.entry.name,'출장 신청서');
});
test('a request about the open workbook is routed as before and opens no template',async()=>{
  const {host,scope}=await office(),providers=scripted({router:[{mode:'edit'}],actor:[call('apply_changes',{plan:JSON.stringify({operations:[{type:'set_values',address:'A2',values:[[4]]}]})}),text('A2를 4로 바꿨습니다.')]});
  providers.complete=(original=>async(messages,tools)=>messages[0].content.startsWith('NUBI_TASK_PLANNER')?text(JSON.stringify(contract([{address:'A2',field:'value',operator:'equals',expected:4}]))):original(messages,tools))(providers.complete);
  const {status,actions}=await drive(start('A2를 4로 바꿔줘',scope,providers),host);
  assert.equal(status.state,'done',status.error);assert.equal(actions.includes('template_catalog_use'),false);assert.equal(status.templateCopy,undefined);
  assert.equal(Object.hasOwn(JSON.parse(providers.seen.router[0].at(-1).content),'registeredTemplates'),false);
  assert.equal((await host.call('audit')).values[1][0],4);
});
test('a copy that differs from the saved form is reported before anything is filled',async()=>{
  const form=formById('quotation'),{host,scope}=await office(),providers=scripted({form});
  const drifted={call:async(method,payload)=>{const result=await host.call(method,payload);if(method==='template_catalog_use'){result.comparison.after=structuredClone(result.comparison.after);result.comparison.after.formulas[12][5]='=1';}return result;}};
  const agent=start('/견적서 '+form.reuse.request,scope,providers);let seen;
  for(let i=0;i<3000&&agent.status().state==='running';i++){
    const status=agent.status(),action=status.action;
    if(status.templateCopy&&!seen){seen=status;agent.cancel();break;}
    if(action)agent.respond(action.callId,await hostAction(drifted,action));
    await new Promise(resolve=>setImmediate(resolve));
  }
  await agent.promise;assert.ok(seen,'the copy was opened');
  assert.equal(seen.templateCopy.preservation.differenceCount,1);assert.deepEqual(seen.templateCopy.preservation.differences[0].address,'F13');
  assert.equal(seen.preservation.stage,'opened_copy','until the executor reports, the comparison of the opened copy is shown');
});
test('declining the copy stops the run before anything is written',async()=>{
  const form=formById('quotation'),{host,scope}=await office(),providers=scripted({form});
  const {status}=await drive(start('/견적서 '+form.reuse.request,scope,providers),host,{decline:['template_catalog_use']});
  assert.equal(status.state,'cancelled');assert.equal(status.writes,0);assert.equal(providers.seen.planner.length,0);
});
test('an unreadable catalog does not block ordinary work',async()=>{
  const {host,scope}=await office(),providers=scripted({router:[{mode:'analyze'}],actor:[text('메모와 숫자 1이 있습니다.')]});
  providers.complete=(original=>async(messages,tools)=>messages[0].content.startsWith('NUBI_TASK_PLANNER')?text(JSON.stringify(contract([],{intent:'analyze'}))):original(messages,tools))(providers.complete);
  const agent=start('선택한 셀을 설명해줘',scope,providers),broken={call:(method,payload)=>method==='template_catalog_list'?Promise.reject(Object.assign(new Error('template_catalog_unavailable'),{code:'template_catalog_unavailable'})):host.call(method,payload)};
  const actions=[];
  for(let i=0;i<3000&&agent.status().state==='running';i++){const action=agent.status().action;if(action){actions.push(action.name);agent.respond(action.callId,action.name==='show_plan'?{displayed:true}:action.name==='template_catalog_list'?{error:'template_catalog_unavailable'}:await hostAction(broken,action));}await new Promise(resolve=>setImmediate(resolve));}
  await agent.promise;assert.equal(agent.status().state,'done',agent.status().error);assert.equal(actions[0],'template_catalog_list');
});
test('without the catalog option the router behaves exactly as before',async()=>{
  const {host,scope}=await office(),providers=scripted({router:[{mode:'analyze'}],actor:[text('설명했습니다.')]});
  providers.complete=(original=>async(messages,tools)=>messages[0].content.startsWith('NUBI_TASK_PLANNER')?text(JSON.stringify(contract([],{intent:'analyze'}))):original(messages,tools))(providers.complete);
  const {actions}=await drive(start('/견적서 작성해줘',scope,providers,{templateCatalog:false}),host);
  assert.equal(actions.includes('template_catalog_list'),false);assert.equal(providers.seen.router.length,1);
});
test('the router reply may carry a template id only as a plain identifier',()=>{
  assert.deepEqual(parseIntent(text('{"mode":"template","templateId":"11111111-1111-1111-1111-111111111111"}')),{mode:'template',templateId:'11111111-1111-1111-1111-111111111111'});
  assert.deepEqual(parseIntent(text('{"mode":"edit","templateId":"11111111-1111-1111-1111-111111111111"}')),{mode:'edit'});
  assert.throws(()=>parseIntent(text('{"mode":"template","templateId":"../etc"}')),/task_plan_invalid/);
  assert.throws(()=>parseIntent(text('{"mode":"template","path":"C:\\\\x.xlsx"}')),/task_plan_invalid/);
});
test('the catalog of the evaluation holds the four forms and one near-duplicate name',()=>{
  assert.deepEqual(catalogForms.map(form=>form.title),['지출 결의서','출장 신청서','교육 신청서','견적서','출장 정산서']);assert.equal(forms.length,4);
});
