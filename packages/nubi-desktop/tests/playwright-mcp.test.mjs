import test from 'node:test';
import assert from 'node:assert/strict';
import {createInAppPlaywright} from '../runtime/playwright-mcp.mjs';
test('official catalog is lazy, bounded and preserves approval and tab binding',async t=>{
 const calls=[];const client=await createInAppPlaywright(async(action,args)=>{calls.push({action,args});return {tabs:[]};});t.after(()=>client.close());
 const {tools}=await client.listTools();assert.equal(calls.length,0,'catalog must not attach or launch a browser');
 assert.equal(tools.length,23);/* 18 + console errors, resize, handle_dialog, verify_text_visible, verify_element_visible (2026-10-18 benchmark) */assert.equal(tools.some(tool=>/evaluate|run_code|file_upload|cookie|network/.test(tool.name)),false);
 for(const name of ['browser_run_workflow','browser_find','browser_fill_form','browser_mouse_wheel'])assert.ok(tools.some(tool=>tool.name===name),name+' is offered (2026-10-15)');
 const click=tools.find(tool=>tool.name==='browser_click');assert.equal(click.annotations.readOnlyHint,false);assert.ok(click.inputSchema.required.includes('documentId'));assert.ok(click.inputSchema.required.includes('tabId'));
 assert.equal(tools.find(tool=>tool.name==='browser_snapshot').inputSchema.properties.filename,undefined);
 await client.callTool({name:'browser_tabs'});assert.equal(calls.length,1);
 await assert.rejects(client.callTool({name:'browser_click',arguments:{tabId:'a',target:'e1'}}),/browser_document_required/);
 await assert.rejects(client.callTool({name:'browser_snapshot',arguments:{tabId:'a',filename:'/tmp/leak'}}),/browser_file_access_denied/);
 const controller=new AbortController();controller.abort();await assert.rejects(client.callTool({name:'browser_open',arguments:{url:'https://example.com'}},undefined,{signal:controller.signal}),{name:'AbortError'});
 assert.equal(calls.length,1);
});

test('native window tools use the existing host bridge without tab attachment and preserve cancellation',async t=>{const calls=[];const client=await createInAppPlaywright(async(action,args,options)=>{calls.push({action,args,signal:options.signal});return {docked:action==='bring',nativeConfirmed:true,automationReady:false};});t.after(()=>client.close());const {tools}=await client.listTools();for(const name of ['browser_bring','browser_detach']){const tool=tools.find(t=>t.name===name);assert.equal(tool.annotations.readOnlyHint,false);assert.deepEqual(tool.inputSchema.properties,{});assert.equal(tool.inputSchema.additionalProperties,false);}const controller=new AbortController();const result=await client.callTool({name:'browser_bring'},undefined,{signal:controller.signal});assert.equal(result.structuredContent.automationReady,false);assert.deepEqual(calls.map(x=>x.action),['bring']);assert.equal(calls[0].signal,controller.signal);await client.callTool({name:'browser_detach'});assert.deepEqual(calls.map(x=>x.action),['bring','dockDetach']);});
