import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {DesktopUsage} from '../runtime/usage.mjs';
test('the ledger keeps dollar cost per provider for today, the week and the total',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-usage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const usage=new DesktopUsage(dir);t.after(()=>usage.close());
  const first=usage.start({provider:'claude'});usage.finish(first,{prompt_tokens:10,completion_tokens:2,total_tokens:12,cost_usd:0.25});
  const second=usage.start({provider:'claude'});usage.finish(second,{prompt_tokens:4,completion_tokens:1,total_tokens:5,cost_usd:0.1});
  const third=usage.start({provider:'aipro'});usage.finish(third,{prompt_tokens:4,completion_tokens:1,total_tokens:5});
  const {usage:summary}=usage.summary();
  assert.equal(summary.today.claude.costUsd,0.35);assert.equal(summary.week.claude.costUsd,0.35);assert.equal(summary.total.claude.costUsd,0.35);assert.equal(summary.total.claude.total,17);
  assert.equal(summary.today.aipro.costUsd,0);assert.equal(summary.week.aipro.total,5);
  // An older ledger without the cost key keeps counting without NaN.
  usage.ledger.total.claude.costUsd=undefined;delete usage.ledger.days[Object.keys(usage.ledger.days)[0]].claude.costUsd;
  const fourth=usage.start({provider:'claude'});usage.finish(fourth,{prompt_tokens:1,completion_tokens:1,total_tokens:2,cost_usd:0.05});
  assert.equal(usage.summary().usage.total.claude.costUsd,0.05);assert.equal(usage.summary().usage.total.claude.total,19);
});
test('reset clears all providers and periods durably and starts a fresh accounting boundary',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-usage-reset-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let usage=new DesktopUsage(dir);t.after(()=>usage.close());
  for(const provider of ['aipro','chatgpt','fabrix','claude']){const id=usage.start({provider});usage.finish(id,{prompt_tokens:10,completion_tokens:2,total_tokens:12,cost_usd:0.2});}
  const pending=usage.start({provider:'claude'});
  usage.reset();
  for(const period of ['today','week','total'])for(const stats of Object.values(usage.summary().usage[period]))assert(Object.values(stats).every(value=>value===0));
  // A response begun before reset must not restore erased counters.
  usage.finish(pending,{prompt_tokens:100,completion_tokens:20,total_tokens:120});
  const fresh=usage.start({provider:'chatgpt'});usage.finish(fresh,{prompt_tokens:3,completion_tokens:2,total_tokens:5});
  assert.equal(usage.summary().usage.total.chatgpt.total,5);assert.equal(usage.summary().usage.total.claude.total,0);
  usage.close();usage=new DesktopUsage(dir);
  assert.equal(usage.summary().usage.total.chatgpt.total,5);assert.equal(usage.summary().usage.total.aipro.total,0);
});
test('a reset write failure preserves counters and pending calls instead of claiming zero',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-usage-reset-error-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const usage=new DesktopUsage(dir);t.after(()=>usage.close());const id=usage.start({provider:'claude'});
  const set=usage.store.set.bind(usage.store);usage.store.set=()=>{throw Error('disk_full');};
  assert.throws(()=>usage.reset(),/usage_save_failed/);assert.equal(usage.summary().usage.total.claude.calls,1);
  usage.store.set=set;usage.finish(id,{prompt_tokens:4,completion_tokens:2,total_tokens:6});
  assert.equal(usage.summary().usage.total.claude.total,6);
});
