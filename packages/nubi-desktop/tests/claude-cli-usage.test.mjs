import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {createClaudeCliUsage,readToken,USAGE_URL}=createRequire(import.meta.url)('../electron-app/claude-cli-usage.cjs');

// The remaining Claude limit comes from the Claude Code sign-in (user decision 2026-10-14): the CLI credential file is
// read for one request, and only percentages and reset times leave the host.
const credentials=async(root,record)=>{await mkdir(path.join(root,'.claude'),{recursive:true});await writeFile(path.join(root,'.claude','.credentials.json'),JSON.stringify(record));};

test('the CLI token is read from the credential file and never returned with the usage',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-cli-usage-'));removeLater(root);
  await credentials(root,{claudeAiOauth:{accessToken:'sk-ant-oat-secret',expiresAt:Date.now()+3600000}});
  const env={CLAUDE_CONFIG_DIR:path.join(root,'.claude')};
  assert.equal(await readToken({platform:'win32',env}),'sk-ant-oat-secret');
  const calls=[];
  const usage=createClaudeCliUsage({platform:'win32',env,now:()=>Date.UTC(2026,9,14,4,0,0),fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({five_hour:{utilization:19,resets_at:'2026-10-14T07:00:00Z'},seven_day:{utilization:51,resets_at:'2026-10-16T14:00:00Z'},iguana_necktie:{utilization:0}}),{status:200});}});
  const value=await usage.read();
  assert.equal(calls[0].url,USAGE_URL);assert.equal(calls[0].init.headers.Authorization,'Bearer sk-ant-oat-secret');assert.equal(calls[0].init.headers['anthropic-beta'],'oauth-2025-04-20');
  assert.deepEqual(value,{source:'claude_cli',fiveHour:{used:19,remaining:81,resetsAt:'2026-10-14T07:00:00Z'},sevenDay:{used:51,remaining:49,resetsAt:'2026-10-16T14:00:00Z'},scoped:[],spend:null,readAt:'2026-10-14T04:00:00.000Z'});
  assert.equal(JSON.stringify(value).includes('secret'),false);assert.deepEqual(usage.status(),value);
});

test('no sign-in, an expired token and a rejected request are reported by code',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-cli-usage-'));removeLater(root);
  const env={CLAUDE_CONFIG_DIR:path.join(root,'.claude')};
  await assert.rejects(createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>{throw Error('unreachable');}}).read(),/claude_cli_login/);
  await credentials(root,{claudeAiOauth:{accessToken:'old',expiresAt:Date.now()-1000}});
  await assert.rejects(createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>{throw Error('unreachable');}}).read(),/claude_cli_expired/);
  await credentials(root,{claudeAiOauth:{accessToken:'fresh',expiresAt:Date.now()+1000000}});
  await assert.rejects(createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>new Response('{}',{status:401})}).read(),/claude_cli_expired/);
  await assert.rejects(createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>new Response(JSON.stringify({}),{status:200})}).read(),/claude_cli_format/);
});

// Enterprise plans are limited by spend in dollars and may have no 5-hour or 7-day window (user report 2026-10-14).
test('spend in dollars and model-scoped weekly limits are read; a spend-only answer is not a format error',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-cli-usage-'));removeLater(root);
  await credentials(root,{claudeAiOauth:{accessToken:'enterprise',expiresAt:Date.now()+3600000}});
  const env={CLAUDE_CONFIG_DIR:path.join(root,'.claude')};
  const body={five_hour:null,seven_day:null,spend:{used:{amount_minor:1234,currency:'USD',exponent:2},limit:{amount_minor:10000,currency:'USD',exponent:2},percent:12.34,enabled:true},
    limits:[{kind:'weekly_scoped',percent:76,resets_at:'2026-10-16T14:00:00Z',scope:{model:{display_name:'Fable'}}},{kind:'session',percent:3}]};
  const value=await createClaudeCliUsage({platform:'win32',env,now:()=>0,fetchImpl:async()=>new Response(JSON.stringify(body),{status:200})}).read();
  assert.deepEqual(value.spend,{used:12.34,limit:100,remaining:87.66,currency:'USD',percent:12.34});
  assert.deepEqual(value.scoped,[{label:'7일 한도 (Fable)',used:76,remaining:24,resetsAt:'2026-10-16T14:00:00Z'}]);
  assert.equal(value.fiveHour,null);
  const extra={extra_usage:{is_enabled:true,monthly_limit:15000,used_credits:3750,utilization:25,currency:'USD'}};
  const fromExtra=await createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>new Response(JSON.stringify(extra),{status:200})}).read();
  assert.deepEqual(fromExtra.spend,{used:37.5,limit:150,remaining:112.5,currency:'USD',percent:25});
});
