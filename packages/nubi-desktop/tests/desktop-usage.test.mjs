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
