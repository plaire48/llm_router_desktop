import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {McpRegistry,describeToolResult} from '../runtime/mcp.mjs';
import {readProcessOutput} from '../runtime/process-output.mjs';
import {saveTaskToolOutput} from '../runtime/tool-output.mjs';
installAgent(ProjectService);
const big=Array.from({length:3000},(_,i)=>`row ${i+1}`).join('\n');
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});

async function setup(t){
 const f=await fixture(t);
 const registry=new McpRegistry({file:f.directory+'/mcp.json',playwright:async()=>({listTools:async()=>({tools:[{name:'dump',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{}}}]}),callTool:async()=>({content:[{type:'text',text:big}]}),close:async()=>{}})});
 await registry.connectEnabled();const entry=registry.connections.get('playwright');registry.connections.delete('playwright');registry.connections.set('docs',entry);
 f.service.mcpRegistry=()=>registry;f.service.mcpDefinitions=async()=>registry.definitions();t.after(()=>registry.dispose());
 return f;
}

test('describeToolResult keeps the whole text when it bounds a long result',()=>{
 const long=describeToolResult({content:[{type:'text',text:'x'.repeat(30000)}]});
 assert.equal(long.full.length,30000);
 assert.equal(describeToolResult({content:[{type:'text',text:'short'}]}).full,undefined);
});

test('a saved tool output is read back page by page through read_process_output, only by its own task',async t=>{
 const {service}=await setup(t),task=await service.createTask({request:'a'}),other=await service.createTask({request:'b'});
 const saved=await saveTaskToolOutput(service,task.id,big,{maxBytes:200});
 assert.match(saved.outputId,/^tool_[0-9a-f]{12}$/);
 assert.match(saved.text,/^row 1\n/);
 assert.match(saved.text,new RegExp(`full output saved to .*${saved.outputId}; read it with read_process_output processId "${saved.outputId}"\\]$`));
 const page=await readProcessOutput(service,task.id,{processId:saved.outputId});
 assert.equal(page.source,'saved_tool_output');assert.match(page.text,/^row 1\nrow 2/);assert.ok(page.nextOffset>0);
 const found=await readProcessOutput(service,task.id,{processId:saved.outputId,query:'row 2999'});
 assert.equal(found.matches.length,1);
 await assert.rejects(readProcessOutput(service,other.id,{processId:saved.outputId}),/process_log_missing/);
 await assert.rejects(readProcessOutput(service,task.id,{processId:'tool_../../x'}),/process_log_arguments/);
});

test('a long MCP result reaches the model as its head plus a saved-output reference the model can read',async t=>{
 const {service}=await setup(t),task=await service.createTask({request:'문서 목록을 모두 확인해 주세요'});let turn=0,outputId;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
  turn++;
  if(turn===1)return call('mcp__docs__dump',{});
  const text=JSON.stringify(messages);
  if(turn===2){
   outputId=/tool_[0-9a-f]{12}/.exec(text)?.[0];
   assert.ok(outputId,'the model is told where the whole output is');
   assert.match(text,/row 1(\\\\)+nrow 2/);assert.doesNotMatch(text,/row 3000/);
   return call('read_process_output',{processId:outputId,query:'row 3000'});
  }
  assert.match(text,/row 3000/);
  return {content:'3000개를 확인했습니다.',calls:[]};
 }};
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(turn,3,JSON.stringify(service.task(task.id).error));
});
