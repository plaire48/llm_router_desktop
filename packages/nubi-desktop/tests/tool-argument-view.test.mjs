import test from 'node:test';import assert from 'node:assert/strict';
import {toolArgumentView} from '../runtime/tool-argument-view.mjs';
import {mcpActivityLabels} from '../ui/mcp-activity.mjs';
test('arguments retain nested types and hide credentials without changing execution input',()=>{
 const args={url:'https://person:password@example.invalid/page?token=private&query=hello',fields:[{name:'title',value:'<script>alert(1)</script>'}],options:{enabled:true,count:2,empty:null},authorization:'private',password:'private'};
 const before=JSON.stringify(args),view=toolArgumentView(args),shown=JSON.parse(view.text);
 assert.equal(JSON.stringify(args),before);assert.equal(view.omitted,false);assert.doesNotMatch(view.text,/private|person:password/);assert.equal(shown.options.count,2);assert.equal(shown.options.empty,null);assert.equal(shown.fields[0].value,args.fields[0].value);assert.match(view.text,/query=hello/);
});
test('large arguments explicitly report truncation and activity labels retain MCP operations',()=>{
 const view=toolArgumentView({text:'x'.repeat(10000)},{limit:1000});assert.equal(view.omitted,true);assert(view.text.length<=1002);
 assert.equal(mcpActivityLabels([{tool:'mcp__playwright__browser_click'}]).mcp__playwright__browser_click,'웹 요소 클릭');
 assert.deepEqual(mcpActivityLabels([{tool:'<script>'}]),{});
});
