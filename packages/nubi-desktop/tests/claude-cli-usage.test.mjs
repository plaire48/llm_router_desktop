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
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-cli-usage-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await credentials(root,{claudeAiOauth:{accessToken:'sk-ant-oat-secret',expiresAt:Date.now()+3600000}});
  const env={CLAUDE_CONFIG_DIR:path.join(root,'.claude')};
  assert.equal(await readToken({platform:'win32',env}),'sk-ant-oat-secret');
  const calls=[];
  const usage=createClaudeCliUsage({platform:'win32',env,now:()=>Date.UTC(2026,9,14,4,0,0),fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({five_hour:{utilization:19,resets_at:'2026-10-14T07:00:00Z'},seven_day:{utilization:51,resets_at:'2026-10-16T14:00:00Z'},iguana_necktie:{utilization:0}}),{status:200});}});
  const value=await usage.read();
  assert.equal(calls[0].url,USAGE_URL);assert.equal(calls[0].init.headers.Authorization,'Bearer sk-ant-oat-secret');assert.equal(calls[0].init.headers['anthropic-beta'],'oauth-2025-04-20');
  assert.deepEqual(value,{source:'claude_cli',fiveHour:{used:19,remaining:81,resetsAt:'2026-10-14T07:00:00Z'},sevenDay:{used:51,remaining:49,resetsAt:'2026-10-16T14:00:00Z'},readAt:'2026-10-14T04:00:00.000Z'});
  assert.equal(JSON.stringify(value).includes('secret'),false);assert.deepEqual(usage.status(),value);
});

test('no sign-in, an expired token and a rejected request are reported by code',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-cli-usage-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const env={CLAUDE_CONFIG_DIR:path.join(root,'.claude')};
  await assert.rejects(createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>{throw Error('unreachable');}}).read(),/claude_cli_login/);
  await credentials(root,{claudeAiOauth:{accessToken:'old',expiresAt:Date.now()-1000}});
  await assert.rejects(createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>{throw Error('unreachable');}}).read(),/claude_cli_expired/);
  await credentials(root,{claudeAiOauth:{accessToken:'fresh',expiresAt:Date.now()+1000000}});
  await assert.rejects(createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>new Response('{}',{status:401})}).read(),/claude_cli_expired/);
  await assert.rejects(createClaudeCliUsage({platform:'win32',env,fetchImpl:async()=>new Response(JSON.stringify({}),{status:200})}).read(),/claude_cli_format/);
});
