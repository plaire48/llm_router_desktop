import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {normalizeMailReadArgs} from '../runtime/mail-tool-arguments.mjs';
import {workPlanSteps,reviewPlanSteps} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

test('mail read repairs only equivalent source aliases and canonical offsets',()=>{
 for(const key of ['sourceId','source_id','mailId','mail_id'])assert.deepEqual(normalizeMailReadArgs({[key]:'known-id',offset:'120'}),{id:'known-id',offset:120});
 assert.deepEqual(normalizeMailReadArgs({id:'a',sourceId:'a'}),{id:'a'});
 for(const args of [{id:'a',sourceId:'b'},{ids:['a','b']},{id:['a','b']},{offset:'1.2'},{offset:'-1'},{offset:'1e3'},{offset:'9007199254740993'}])assert.deepEqual(normalizeMailReadArgs(args),args);
});
test('all-complete updates are accepted only after planning and remain subject to evidence review',()=>{
 const steps=[1,2,3].map(i=>({text:'단계 '+i,expected_outcome:'확인 '+i,status:'completed'}));
 assert.throws(()=>workPlanSteps({steps},{initial:true}),/work_plan_invalid/);
 assert.equal(workPlanSteps({steps}).length,3);
 const checks=steps.map((_,i)=>({requirementId:'intent:step:'+i,state:i===2?'unknown':'supported',evidenceIds:i===2?[]:['tool:1']}));
 assert.deepEqual(reviewPlanSteps(steps,{status:'ready',checks}).map(step=>step.status),['completed','completed','pending']);
 checks[2]={...checks[2],state:'supported',evidenceIds:['tool:1']};assert(reviewPlanSteps(steps,{status:'ready',checks}).every(step=>step.status==='completed'&&step.verified));
});
test('project-free AI Pro mail lookup accepts sourceId, reads the original and finishes a reviewed three-step plan',async t=>{
 const {service,directory}=await fixture(t,{scriptedPlanning:true,scriptedReview:true});
 const home=path.join(directory,'conversation');await mkdir(home);await service.open(home,{kind:'conversation',initializeWiki:false});assert.equal(service.workspaceKind,'conversation');
 const id='a'.repeat(64),sourceHash='b'.repeat(64),steps=['메일 찾기','원문 확인','결과 정리'].map((text,i)=>({text,expected_outcome:text,status:i?'pending':'in_progress'}));
 const call=(name,args)=>({content:'',calls:[{id:'call-'+(++sequence),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 let sequence=0,round=0,read=0,citation;
 service.mail=async args=>{if(args.action==='query')return {results:[{id,sourceId:id,title:'일정'}],total:1};assert.equal(args.action,'read');assert.equal(args.id,id);read++;return {id,sourceHash,mail:{subject:'일정',from:'fixture@example.test',text:'배포 일정은 10월 20일입니다.',attachments:[]},knowledge:{state:'current',text:'배포는 10월 20일',sourceHash}};};
 service.providers={status:()=>({connected:true,provider:'aipro',model:'fixture-aipro',models:[{id:'fixture-aipro',contextLength:128000}]}),dispose(){},complete:async messages=>{
  if(messages[0]?.content.startsWith(REVIEW_PROMPT)){const data=JSON.parse(messages[1].content),source=data.evidence.find(e=>e.tool==='read_personal_mail');assert(source);return {content:JSON.stringify({status:'ready',checks:data.requirements.map(r=>({requirementId:r.id,state:'supported',evidenceIds:[source.id],detail:'합성 원문과 답변 대조'})),nextStep:''}),calls:[]};}
  round++;
  if(round===1)return call('update_plan',{intent:{goal:'배포 일정 확인',constraints:[],outcomes:['배포 일정 설명'],workflowIds:['mail'],skillPaths:[]},steps});
  if(round===2)return call('personal_mail_query',{query:'배포 일정'});
  if(round===3)return call('read_personal_mail',{sourceId:id,offset:'0'});
  if(round===4){const packet=JSON.parse(messages.findLast(m=>m.role==='tool').content);assert.equal(packet.mail.text,'배포 일정은 10월 20일입니다.');citation=packet.citations[0].href;return call('update_plan',{steps:steps.map(step=>({...step,status:'completed'}))});}
  assert.equal(JSON.parse(messages.findLast(m=>m.role==='tool').content).ok,true);
  return {content:`배포 일정은 10월 20일입니다. [1](${citation})`,calls:[]};
 }};
 const task=await service.createTask({request:'/mail 배포 일정 알려줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
 const saved=service.task(task.id);assert.equal(read,1);assert.equal(saved.state,'review');assert.equal(saved.resultReview.status,'ready');assert.equal(saved.workPlan.steps.length,3);assert(saved.workPlan.steps.every(step=>step.status==='completed'&&step.verified));assert(!saved.trace.some(row=>row.reason==='tool_arguments_invalid'));assert(saved.messages.findLast(m=>m.role==='assistant').content.includes('10월 20일'));
});
