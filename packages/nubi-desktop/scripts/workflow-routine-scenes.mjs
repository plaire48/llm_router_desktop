import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {hash} from '../runtime/files.mjs';
import {captureDesign,assertAccessibilityRules} from './design-rules.mjs';
export async function seedRoutineScenes(root,storage){
 const projectId=hash(root).slice(7,31),dir=path.join(root,'.nubi/workflows/routine-flow');await mkdir(dir,{recursive:true});
 const workflow={name:'합성 예약 절차',version:1,trigger:{kind:'routine',schedule:'daily 09:00'},inputs:{subject:{type:'string',required:true,default:'합성 주제'},count:{type:'integer',default:0},ratio:{type:'number',default:1.5},include:{type:'boolean',default:false}},permissions:{tools:[],externalWrite:'never'},steps:[{id:'confirm',kind:'human',ask:'합성 자료를 확인해 주세요.'}]};await writeFile(path.join(dir,'workflow.yaml'),JSON.stringify(workflow));
 const shared=new Store(path.join(storage,'routines')),project=new Store(path.join(storage,projectId));
 try{for(const [id,name] of [['promote','합성 반복 정리'],['dismiss','합성 나중에 정리']]){const row={id,name,projectId,kind:'prompt',request:'합성 요청을 정리해 주세요',enabled:false,schedule:{kind:'daily',time:'09:00'},createdAt:new Date().toISOString()};shared.set('routine:'+id,row);project.set('workflow-promotion:'+id,{...row,routineId:id,state:'proposed'});}}finally{shared.close();project.close();}
 return projectId;
}
export async function checkRoutineScenes({page,request,width,dir,checks}){
 const accessibility=[];
 await page.getByRole('button',{name:'합성 예약 절차',exact:true}).click();await page.getByRole('button',{name:'루틴으로 등록',exact:true}).click();await page.getByText('루틴 켜짐',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'루틴으로 등록',exact:true}).count(),0);await page.getByText('감독 실행 필요',{exact:true}).waitFor();await captureDesign(page,{path:path.join(dir,`routines-catalog-${width}.png`)});accessibility.push(await assertAccessibilityRules(page));
 const open=async()=>{await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('button',{name:'루틴',exact:true}).click();return page.getByRole('dialog',{name:'루틴',exact:true});};
 let dialog=await open();await dialog.getByRole('button',{name:'합성 예약 절차 수정',exact:true}).click();let form=page.getByRole('dialog',{name:'루틴 설정',exact:true});await form.getByLabel('subject',{exact:true}).fill('합성 입력');await form.getByLabel('count',{exact:true}).fill('0');await form.getByLabel('ratio',{exact:true}).fill('2.5');await form.getByLabel('include',{exact:true}).selectOption('false');await captureDesign(page,{path:path.join(dir,`routines-settings-${width}.png`)});accessibility.push(await assertAccessibilityRules(page));await form.getByRole('button',{name:'저장',exact:true}).click();await form.waitFor({state:'hidden'});
 const row=(await request('listRoutines')).items.find(row=>row.slug==='routine-flow');assert.deepEqual(row.inputs,{subject:'합성 입력',count:0,ratio:2.5,include:false});
 // The existing runtime blocks unsupervised scheduled execution. UI opens its detail, not a model call.
 const routine=dialog.locator('li').filter({has:page.getByRole('switch',{name:'합성 예약 절차',exact:true})});await routine.getByRole('button',{name:'지금 실행',exact:true}).click();await routine.getByRole('button',{name:'감독 실행 열기',exact:true}).waitFor();await routine.getByRole('button',{name:'감독 실행 열기',exact:true}).click();await page.getByRole('heading',{name:'합성 예약 절차',exact:true}).waitFor();assert.equal((await request('listWorkflows')).find(row=>row.slug==='routine-flow').lastRun,null);
 dialog=await open();await dialog.getByRole('button',{name:'워크플로우로 만들기',exact:true}).first().waitFor();accessibility.push(await assertAccessibilityRules(page));const dismiss=dialog.locator('li').filter({has:page.getByRole('switch',{name:'합성 나중에 정리',exact:true})});await dismiss.getByRole('button',{name:'나중에',exact:true}).click();await dismiss.getByRole('button',{name:'워크플로우로 만들기',exact:true}).waitFor({state:'hidden'});
 const promotion=dialog.locator('li').filter({has:page.getByRole('switch',{name:'합성 반복 정리',exact:true})});await promotion.getByRole('button',{name:'워크플로우로 만들기',exact:true}).click();await page.getByRole('heading',{name:'합성 반복 정리',exact:true}).waitFor();const draft=(await request('listWorkflows')).find(row=>row.name==='합성 반복 정리');assert.equal(draft.trigger.kind,'manual');assert.equal(draft.lastRun,null);assert.equal(draft.qualified,false);const definition=await request('validateWorkflow',{slug:draft.slug});assert.equal(definition.workflow.steps.length,1);assert.deepEqual(definition.workflow.steps[0].tools,[]);checks.push({width,scene:'routine-ui',registration:true,typedInputs:true,supervision:true,promotion:true,dismissal:true,autoRuns:0,accessibility});
}
