import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {McpRegistry,mcpToolName,parseMcpToolName,describeToolResult,MCP_SECRET_PREFIX} from '../runtime/mcp.mjs';

const fixture=fileURLToPath(new URL('./mcp-fixture-server.mjs',import.meta.url));
const memorySecrets=()=>{const map=new Map();return {get:async key=>map.get(key)??null,set:async(key,value)=>{map.set(key,value);},delete:async key=>{map.delete(key);},map};};
const temp=async t=>{const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mcp-'));removeLater(root);return root;};

test('tool names round-trip and results are bounded text',()=>{
  assert.equal(mcpToolName('ghes','list_issues'),'mcp__ghes__list_issues');
  assert.deepEqual(parseMcpToolName('mcp__ghes__list_issues'),{serverId:'ghes',tool:'list_issues'});
  assert.equal(parseMcpToolName('read_source'),null);
  const long=describeToolResult({content:[{type:'text',text:'x'.repeat(30000)}]});assert.ok(long.text.length<24100);assert.match(long.text,/생략/);
  assert.equal(describeToolResult({isError:true,content:[{type:'text',text:'boom'}]}).ok,false);
});

test('a stdio server is registered with its secret in the vault, connected, listed and called',async t=>{
  const root=await temp(t),secrets=memorySecrets();
  const registry=new McpRegistry({file:path.join(root,'mcp-servers.json'),secrets});
  t.after(()=>registry.dispose());
  const saved=await registry.save({id:'fixture',name:'검사 서버',transport:'stdio',command:process.execPath,args:[fixture,'stdio'],envKeys:['FIXTURE_SECRET'],secrets:{FIXTURE_SECRET:'s3cret'}});
  assert.equal(saved.state,'disconnected');
  const file=JSON.parse(await readFile(path.join(root,'mcp-servers.json'),'utf8'));
  assert.equal(JSON.stringify(file).includes('s3cret'),false,'the file never holds the secret');assert.deepEqual(file.servers[0].envKeys,['FIXTURE_SECRET']);
  assert.equal(JSON.parse(secrets.map.get(MCP_SECRET_PREFIX+'fixture')).FIXTURE_SECRET,'s3cret');
  const connected=await registry.connect('fixture');
  assert.equal(connected.state,'connected');assert.deepEqual(connected.tools.map(tool=>[tool.name,tool.readOnly]),[['echo',true],['add_note',false]]);
  const definitions=registry.definitions();
  assert.deepEqual(definitions.map(item=>item.function.name),['mcp__fixture__echo','mcp__fixture__add_note']);
  assert.match(definitions[0].function.description,/읽기 전용/);assert.match(definitions[1].function.description,/승인 필요/);
  assert.equal(definitions[0].function.parameters.properties.text.type,'string');
  const echoed=await registry.call('mcp__fixture__echo',{text:'안녕'});
  assert.equal(echoed.ok,true);assert.equal(echoed.text,'echo: 안녕 (env s3cret)');
  assert.equal(registry.tool('mcp__fixture__add_note').readOnly,false);
  await assert.rejects(registry.call('mcp__other__echo',{}),/mcp_tool_unavailable/);
  await registry.remove({id:'fixture'});
  assert.deepEqual(await registry.list(),[]);assert.equal(secrets.map.has(MCP_SECRET_PREFIX+'fixture'),false);
});

test('a streamable HTTP server is reached with a header from the vault',async t=>{
  const root=await temp(t),secrets=memorySecrets();
  const child=spawn(process.execPath,[fixture,'http'],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{child.kill();});
  const port=await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',chunk=>{out+=chunk;const match=/PORT (\d+)/.exec(out);if(match)resolve(Number(match[1]));});child.on('exit',code=>reject(Error('fixture exited '+code)));});
  const registry=new McpRegistry({file:path.join(root,'mcp-servers.json'),secrets});
  t.after(()=>registry.dispose());
  await registry.save({id:'remote',transport:'http',url:`http://127.0.0.1:${port}/mcp`,headerKeys:['Authorization'],secrets:{Authorization:'Bearer fixture-token'}});
  const connected=await registry.connect('remote');
  assert.equal(connected.state,'connected');assert.deepEqual(connected.tools.map(tool=>tool.name),['echo','add_note']);
  assert.equal((await registry.call('mcp__remote__echo',{text:'http'})).text,'echo: http (env none)');
});

test('invalid registrations are refused and a failed connection reports its state',async t=>{
  const root=await temp(t);
  const registry=new McpRegistry({file:path.join(root,'mcp-servers.json'),secrets:null});
  t.after(()=>registry.dispose());
  await assert.rejects(registry.save({id:'Bad Id',transport:'stdio',command:'x'}),/mcp_server_invalid/);
  await assert.rejects(registry.save({id:'nohttp',transport:'http',url:'ftp://x'}),/mcp_server_invalid/);
  await assert.rejects(registry.save({id:'s',transport:'stdio',command:'x',secrets:{A:'b'}}),/mcp_server_invalid|secret_unavailable/);
  await registry.save({id:'broken',transport:'stdio',command:process.execPath,args:['-e','process.exit(3)']});
  await assert.rejects(registry.connect('broken'),/mcp_connect_failed|mcp_connect_timeout/);
  assert.equal((await registry.list())[0].state,'failed');
});

test('built-in Playwright is default, is not overwritten, and stays disabled after restart',async t=>{
 const root=await temp(t),file=path.join(root,'mcp.json');let connections=0,closed=0;
 const playwright=async()=>{connections++;return {listTools:async()=>({tools:[{name:'browser_tabs',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},{name:'browser_click',inputSchema:{type:'object',properties:{tabId:{type:'string'}}},annotations:{readOnlyHint:false}}]}),callTool:async()=>({content:[{type:'text',text:'tabs'}]}),close:async()=>{closed++;}};};
 const registry=new McpRegistry({file,playwright});t.after(()=>registry.dispose());
 await Promise.all([registry.load(),registry.load()]);assert.equal((await registry.list()).length,1);
 await Promise.all([registry.connect('playwright'),registry.connect('playwright')]);assert.equal(connections,1);
 assert.equal(registry.tool('mcp__playwright__browser_click').readOnly,false);
 assert.equal((await registry.call('mcp__playwright__browser_tabs')).text,'tabs');
 await assert.rejects(registry.save({id:'playwright',transport:'stdio',command:'wrong'}),/mcp_server_invalid/);
 await registry.remove({id:'playwright'});assert.equal(closed,1);
 const restored=new McpRegistry({file,playwright});t.after(()=>restored.dispose());
 await restored.connectEnabled();assert.equal(connections,1);assert.equal((await restored.list())[0].enabled,false);
});

test('disconnect during built-in startup closes the late client without resurrecting it',async t=>{
 const root=await temp(t);let finish,closed=0;
 const registry=new McpRegistry({file:path.join(root,'mcp.json'),playwright:()=>new Promise(resolve=>{finish=()=>resolve({listTools:async()=>({tools:[]}),close:async()=>{closed++;}});})});
 await registry.load();const pending=registry.connect('playwright');await new Promise(resolve=>setImmediate(resolve));
 await registry.disconnect('playwright');finish();await assert.rejects(pending,/mcp_disconnected/);
 assert.equal(registry.definitions().length,0);assert.ok(closed>=1);
});
