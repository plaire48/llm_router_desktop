import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {contextTokens} from '../../../extensions/aipro-chat/context-manager.js';
installAgent(ProjectService);
// Tool schemas are the largest fixed part of every request (lean-tools.mjs). Claude Code keeps tool descriptions to a
// sentence and puts the rules in the system prompt; the budget below holds that line (spec 2026-10-15, bundle 2.2).
// Measured 2026-10-15: 7,967 tokens before, 5,800 after; what remains is parameter schemas (enums, nested objects),
// which are contracts and stay. The budget leaves room for one more tool.
export const TOOL_TOKEN_BUDGET=6000;
test('the advertised tool schemas of a full-window run stay under the budget',async t=>{
  const {service}=await fixture(t);let seen=null;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async(messages,tools)=>{seen??={messages,tools};return {content:'답',calls:[]};}};
  const task=await service.createTask({request:'app.txt 확인'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const tokens=contextTokens([],seen.tools);
  assert.ok(tokens<=TOOL_TOKEN_BUDGET,`tool schemas ${tokens} tokens exceed ${TOOL_TOKEN_BUDGET}`);
  const names=seen.tools.map(tool=>tool.function.name);
  for(const name of ['read_source','source_search','wiki_query','propose_patch','propose_setup_action','update_plan','ask_user','delegate_analysis'])assert.ok(names.includes(name),name);
  assert.ok(seen.messages.some(message=>message.role==='system'&&String(message.content).includes('Tool rules')),'the rules moved out of the descriptions are in the system prompt');
});
