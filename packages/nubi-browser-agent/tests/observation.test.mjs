import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserAddon} from '../dist/index.js';
import {action,hostFixture,task} from './host.mjs';

test('frame-aware observations require their exact observation id even if top-level document matches',async()=>{
  const {host,controls}=hostFixture(),old=host.browser.observe;
  host.browser.observe=async(...args)=>{const o=await old(...args);o.binding.frameTreeRevision='frame-tree-1';return o;};
  const addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'project-1'});await session.openTask(task);
  const first=await session.observe(task.taskId,'tab-1'),second=await session.observe(task.taskId,'tab-1');
  await assert.rejects(session.execute(task.taskId,action(session,second)),/observation_changed/);
  await assert.rejects(session.execute(task.taskId,{...action(session,first),observationId:first.observationId}),/observation_changed/);
  assert.equal(controls.writes,0);await addon.dispose();
});

test('frame-tree revision cannot be removed or changed in an action binding',async()=>{
  const {host,controls}=hostFixture(),old=host.browser.observe;host.browser.observe=async(...a)=>{const o=await old(...a);o.binding.frameTreeRevision='child-doc-1';return o;};
  const addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'project-1'});await session.openTask(task);const observed=await session.observe(task.taskId,'tab-1');
  const attempt={...action(session,observed),observationId:observed.observationId};
  await assert.rejects(session.execute(task.taskId,{...attempt,binding:{...attempt.binding,frameTreeRevision:'child-doc-2'}}),/observation_required/);
  const binding={...attempt.binding};delete binding.frameTreeRevision;
  await assert.rejects(session.execute(task.taskId,{...attempt,binding}),/observation_required/);assert.equal(controls.writes,0);await addon.dispose();
});

test('confirmed actions reuse only validated ready observations; malformed after-state never blocks receipt',async()=>{
  const {host}=hostFixture(),oldExecute=host.browser.execute,oldObserve=host.browser.observe;
  host.browser.execute=async(...args)=>({...await oldExecute(...args),observation:await oldObserve(args[0],'tab-1')});
  const addon=createBrowserAddon(),session=await addon.attach(host,{projectId:'project-1'});await session.openTask(task);const first=await session.observe(task.taskId,'tab-1');
  const outcome=await session.execute(task.taskId,action(session,first));assert.ok(outcome.observation);
  const second=await session.execute(task.taskId,action(session,outcome.observation,{actionId:'second'}));assert.equal(second.receipt.status,'confirmed');
  host.browser.execute=async(...args)=>({...await oldExecute(...args),observation:{state:'ready',binding:{tabId:'other'},observationId:'bad'}});
  const third=await session.execute(task.taskId,action(session,second.observation,{actionId:'third'}));assert.equal(third.receipt.status,'confirmed');assert.equal(third.observation,undefined);
  await assert.rejects(session.execute(task.taskId,action(session,second.observation,{actionId:'fourth'})),/observation_required/);await addon.dispose();
});
