import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fixture} from './fixtures.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {createRoutineManager,dueRoutines} from '../runtime/routines.mjs';
const {PlaywrightHost}=createRequire(import.meta.url)('../electron-app/playwright-host.cjs');
installAgent(ProjectService);

test('retired workflow and teaching RPCs cannot load or execute a feature',async t=>{
 const {service}=await fixture(t);
 for(const method of ['listWorkflows','importBlueprint','importE2eTask','validateWorkflow','dryRunWorkflow','startWorkflow','workflowRun','resumeWorkflow','cancelWorkflow','registerWorkflowRoutine','listRoutineWorkflows','resolveRoutinePromotion','browserTeach']){
  assert.equal(typeof service[method],'undefined',method);
  await assert.rejects(service.invoke(method,{}),/method_invalid/,method);
 }
 assert.equal(service.store.list('task:').length,0);
});

test('saved workflow schedules remain stored and never run, while prompt routines are available',async t=>{
 const {service}=await fixture(t),rows=new Map(),store={get:key=>structuredClone(rows.get(key)),set:(key,value)=>rows.set(key,structuredClone(value)),delete:key=>rows.delete(key),list:prefix=>[...rows].filter(([key])=>key.startsWith(prefix)).map(([,value])=>structuredClone(value))};
 const retired={id:'old',kind:'workflow',name:'이전 작업',projectId:service.projectId,enabled:true,slug:'old',schedule:{kind:'daily',time:'09:00'},createdAt:'2026-10-20T00:00:00Z'};
 store.set('routine:old',retired);
 const manager=createRoutineManager({store,listProjects:async()=>[{id:service.projectId,name:'검증 프로젝트'}],serviceFor:async()=>service,now:()=>new Date(2026,9,22,10).getTime()});t.after(()=>manager.stop());
 assert.deepEqual(dueRoutines(store,new Date(2026,9,22,10)),[]);
 await manager.tick();assert.deepEqual((await manager.list()).items,[]);
 await assert.rejects(manager.runNow({id:'old'}),/feature_removed/);
 await assert.rejects(manager.save({...retired,id:undefined}),/routine_invalid/);
 assert.deepEqual(store.get('routine:old'),retired);assert.equal(service.store.list('task:').length,0);
 const prompt=await manager.save({name:'요청 확인',projectId:service.projectId,request:'자료를 확인해 주세요',enabled:false,schedule:{kind:'daily',time:'09:00'}});
 assert.equal(prompt.kind,'prompt');assert.deepEqual((await manager.list()).items.map(row=>row.id),[prompt.id]);
});

test('old workflow tasks cannot resume as unrestricted agent requests',async t=>{
 const {service}=await fixture(t),task=await service.createTask({request:'이전 단계'});
 service.providers={status:()=>({connected:true}),complete:()=>{throw Error('retired_task_called_model');},dispose(){}};
 service.store.set('task:'+task.id,{...task,kind:'workflow'});
 await assert.rejects(service.startAgent({taskId:task.id}),/feature_removed/);
 assert.notEqual(service.agent?.running,true);
 assert.equal(service.store.get('task:'+task.id).kind,'workflow');
});

test('the browser host rejects recording before touching a browser tab',async()=>{
 let touched=0;
 const host=new PlaywrightHost({tab(){touched++;throw Error('unexpected_browser_access');}});
 for(const op of ['start','status','stop'])await assert.rejects(host.request('demonstration',{tabId:'tab',op}),/browser_action_invalid/);
 assert.equal(touched,0);host.dispose();
});
