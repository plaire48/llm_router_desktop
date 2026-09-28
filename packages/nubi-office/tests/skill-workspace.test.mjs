import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {startAgent} from '../worker/agent.mjs';
import {documentProvider,request,rawSheets,syntheticSnapshot} from './document-fixtures.mjs';
import {call,scriptedProvider,workbook,planCall,valueEdit,text} from './harness-fixtures.mjs';
const setup=(host='excel')=>{const controller=new AbortController(),activity=createActivityLog(),metrics={};return{controller,metrics,activity,workspace:createSkillWorkspace({host,signal:controller.signal,activity,metrics})};};
test('Pi discovers host-specific skills and loads only requested reference text',async()=>{
  for(const host of ['excel','word','powerpoint']){
    const f=setup(host),before=f.workspace.context();
    assert.equal(before.files.length,6);assert.deepEqual(before.activeSkills,[]);
    assert.ok(before.skills.includes(host+'-2016'));assert.equal(before.skills.includes('Python/JavaScript scratch'),false);
    const found=await f.workspace.execute('find',{pattern:'**/*.md'});assert.ok(found.content.includes('SKILL.md'));
    const read=await f.workspace.execute('read',{path:`skills/${host}-2016/SKILL.md`});assert.equal(read.error,undefined);
    assert.deepEqual(f.workspace.context().activeSkills,[host+'-2016']);assert.equal(f.metrics.skillWorkspace.engine,'pi-coding-agent');
    assert.equal(f.workspace.tools.some(t=>['bash','powershell','exec'].includes(t.function.name)),false);
  }
});
test('real Pi edit enforces unique disjoint replacements and preserves rejected code and line endings',async()=>{
  const f=setup(),original='name = "원본"\r\nx = 1\r\nx = 1\r\n';
  await f.workspace.execute('write',{path:'draft/report.py',content:original});
  const rejected=await f.workspace.execute('edit',{path:'draft/report.py',edits:[{oldText:'x = 1',newText:'x = 2'}]});assert.equal(rejected.error,'workspace_edit_rejected');assert.equal(rejected.reason,'ambiguous_match');
  const missing=await f.workspace.execute('edit',{path:'draft/report.py',edits:[{oldText:'nonexistent',newText:'changed'}]});assert.equal(missing.reason,'text_not_found');
  const overlapping=await f.workspace.execute('edit',{path:'draft/report.py',edits:[{oldText:'name = "원본"',newText:'name = "수정"'},{oldText:'"원본"',newText:'"중복"'}]});assert.equal(overlapping.reason,'overlapping_edits');
  assert.equal((await f.workspace.execute('read',{path:'draft/report.py'})).content,original);
  const edited=await f.workspace.execute('edit',{path:'draft/report.py',edits:[{oldText:'name = "원본"',newText:'name = "수정"'}]});
  assert.equal(edited.error,undefined);assert.match(edited.diff,/수정/);assert.equal((await f.workspace.execute('read',{path:'draft/report.py'})).content,original.replace('원본','수정'));
  assert.equal(edited.scope,'run_memory_only');
});
test('SDK search supports scoped directories and basename patterns without treating directories as files',async()=>{
  const f=setup();
  const root=await f.workspace.execute('find',{pattern:'SKILL.md',path:'.'});
  assert.equal(root.error,undefined);assert.equal(root.content,'skills/excel-2016/SKILL.md');
  const scoped=await f.workspace.execute('find',{pattern:'*.md',path:'skills/excel-2016/references'});
  assert.equal(scoped.error,undefined);assert.equal(scoped.content,'authoring.md\ncalculations.md\npython.md');assert.equal(scoped.sha256,undefined);
  assert.equal((await f.workspace.execute('find',{pattern:'*.md',path:'.',limit:1})).truncated,true);
  for(const limit of [0,-1,1.5,'2'])assert.equal((await f.workspace.execute('find',{pattern:'*',limit})).error,'tool_arguments_invalid');
});
test('workspace boundaries prevent native file reads, reference edits and cross-run draft access',async()=>{
  const a=setup(),b=setup();
  for(const path of ['../auth.json','/etc/passwd','C:/Users/me/document.xlsx','draft/../../credentials','~/.pi/agent/auth.json','@secret','draft\\report.py']){
    const result=await a.workspace.execute('read',{path});assert.equal(result.error,'workspace_out_of_scope',path);
  }
  assert.equal((await a.workspace.execute('write',{path:'skills/excel-2016/SKILL.md',content:'changed'})).error,'workspace_read_only');
  await a.workspace.execute('write',{path:'draft/example.js',content:'const value = 42;'});
  assert.equal((await b.workspace.execute('read',{path:'draft/example.js'})).error,'workspace_file_missing');
  a.controller.abort();await assert.rejects(a.workspace.execute('write',{path:'draft/example.js',content:'late'}),/cancelled/);
});
test('SDK line paging preserves exact Unicode and exposes unread continuation without inflating progress on repeat',async()=>{
  const f=setup(),content=Array.from({length:250},(_,i)=>`항목 ${i}: 0000417`).join('\n');
  await f.workspace.execute('write',{path:'draft/notes.md',content});
  const first=await f.workspace.execute('read',{path:'draft/notes.md',limit:20});assert.equal(first.nextOffset,21);assert.match(first.content,/항목 19/);
  const before=structuredClone(f.workspace.progress());await f.workspace.execute('read',{path:'draft/notes.md',limit:20});assert.deepEqual(f.workspace.progress(),before);
  const next=await f.workspace.execute('read',{path:'draft/notes.md',offset:first.nextOffset,limit:20});assert.match(next.content,/항목 20/);
});
test('bound draft validation is atomic and a huge line cannot masquerade as fully read',async()=>{
  const f=setup();let value='{"amount":42}';
  f.workspace.bindDraft('draft/sheet.json',{read:()=>value,write:next=>{const parsed=JSON.parse(next);if(parsed.amount<0)throw new Error('document_schema_invalid');value=next;}});
  assert.equal((await f.workspace.execute('edit',{path:'draft/sheet.json',edits:[{oldText:'42',newText:'-1'}]})).error,'document_schema_invalid');
  assert.equal(value,'{"amount":42}');
  await f.workspace.execute('write',{path:'draft/long.txt',content:'가'.repeat(6000)});
  assert.equal((await f.workspace.execute('read',{path:'draft/long.txt'})).truncated,true);
  await f.workspace.execute('write',{path:'draft/long.txt',content:'가'.repeat(30000)});
  assert.equal((await f.workspace.execute('read',{path:'draft/long.txt'})).truncated,true);
});
test('Pi serializes concurrent edits to the same scratch file without losing either change',async()=>{
  const f=setup();await f.workspace.execute('write',{path:'draft/prepare.py',content:'x = 1\ny = 2\n'});
  const results=await Promise.all([
    f.workspace.execute('edit',{path:'draft/prepare.py',edits:[{oldText:'x = 1',newText:'x = 10'}]}),
    f.workspace.execute('edit',{path:'draft/prepare.py',edits:[{oldText:'y = 2',newText:'y = 20'}]})
  ]);
  assert.ok(results.every(r=>!r.error));assert.equal((await f.workspace.execute('read',{path:'draft/prepare.py'})).content,'x = 10\ny = 20\n');
});
async function until(run,handle,pollMs=0){for(let i=0;i<3000;i++){
  const s=run.status();if(s.state!=='running'){await run.promise;return run.status();}
  if(s.action){if(['request_approval','request_input'].includes(s.action.name))return s;run.respond(s.action.callId,await handle(s.action));}
  await new Promise(resolve=>pollMs?setTimeout(resolve,pollMs):setImmediate(resolve));
}run.cancel();await run.promise;throw new Error('Fixture timed out');}
const fast={wait:async()=>{},random:()=>0};
test('Excel writer reads a skill, writes and edits the real current draft via Pi, then follows native review and save HITL',async()=>{
  const base=documentProvider();let step=0,openedSpecs,receivedTools=false;
  const initial=structuredClone(rawSheets[0]);initial.cells[0].value='제목 초안';
  const providers={...base,complete:async(messages,tools,...rest)=>{
    if(messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')){
      const packet=JSON.parse(messages.find(m=>m.role==='user'&&m.content.includes('"currentSheet"')).content);
      if(packet.currentSheet.name===initial.name){
        receivedTools=['read','find','edit','write'].every(name=>tools.some(t=>t.function.name===name));
        const seq=[call('read',{path:'skills/excel-2016/SKILL.md'}),call('write',{path:'draft/sheet.json',content:JSON.stringify(initial,null,2)}),call('edit',{path:'draft/sheet.json',edits:[{oldText:'이전 제목은 존재하지 않음',newText:'잘못된 수정'}]}),call('read',{path:'draft/sheet.json',limit:20}),call('edit',{path:'draft/sheet.json',edits:[{oldText:'제목 초안',newText:'최종 교육 운영계획'}]}),call('read',{path:'draft/sheet.json',limit:20}),call('commit_document_sheet')];
        if(step===3)assert.match(messages.filter(m=>m.role==='tool').at(-1).content,/text_not_found/);
        return seq[step++]||text('초안 검토 완료');
      }
    }
    return base.complete(messages,tools,...rest);
  }};
  const run=startDocumentAgent({request,providers,resilienceOptions:fast,writeFile:async()=>({fileName:'test.xlsx',sha256:'hash'})});
  const handle=a=>{if(a.name==='show_plan')return{displayed:true};if(a.name==='document_open'){openedSpecs=a.payload.specs;return{...syntheticSnapshot(a.payload),opened:true};}throw new Error('Unexpected native action '+a.name);};
  try{
    const wait=await until(run,handle);assert.equal(wait.action.payload.kind,'save');assert.equal(receivedTools,true);
    assert.equal(openedSpecs[0].cells[0].value,'최종 교육 운영계획');assert.deepEqual(openedSpecs[0].merges,rawSheets[0].merges);
    assert.equal(wait.metrics.skillWorkspace.edits,1);assert.deepEqual(wait.metrics.skillWorkspace.activeSkills,['excel-2016']);
    run.respond(wait.action.callId,{approved:false});await run.promise;assert.equal(run.status().state,'cancelled');
  }finally{run.cancel();await run.promise;}
});
test('Excel skill discovery remains read-only before the existing native edit approval',async()=>{
  const native=workbook(),providers=scriptedProvider({actor:[call('find',{pattern:'**/SKILL.md'}),call('read',{path:'skills/excel-2016/SKILL.md'}),planCall([valueEdit(42)]),text('검토 완료')]});
  const run=startAgent({request:'A1을 42로 변경',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{const wait=await until(run,native.action);assert.equal(wait.action.payload.kind,'edit');assert.equal(native.writes,0);assert.deepEqual(wait.metrics.skillWorkspace.activeSkills,['excel-2016']);}finally{run.cancel();await run.promise;}
});
test('Excel consumes actual script output before requesting an exact native cell edit',async()=>{
  const native=workbook();let step=0;
  const providers=scriptedProvider({actor:messages=>{
    if(step++===0)return call('write',{path:'draft/calculate.js',content:'function transform(input){return input.a+input.b}'});
    if(step===2)return call('run_script',{path:'draft/calculate.js',input:'{"a":12,"b":30}'});
    if(step===3){const result=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);assert.equal(result.output,42);return planCall([valueEdit(result.output)]);}
    return text('반영 결과를 확인했습니다.');
  }});
  const run=startAgent({request:'12와 30을 합산해 A1에 넣어줘',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const wait=await until(run,native.action,1);assert.equal(wait.action?.payload.kind,'edit',wait.error);assert.equal(native.writes,0);assert.equal(wait.metrics.skillWorkspace.scriptRuns,1);
    run.respond(wait.action.callId,{approved:true});const done=await until(run,native.action,1);
    assert.equal(done.state,'done',done.error);assert.equal(native.writes,1);assert.equal(native.state.values[0][0],42);
  }finally{run.cancel();await run.promise;}
});

test('Excel actor consumes write diagnostics, repairs code and executes before native approval',async()=>{
  const native=workbook();let step=0;
  const providers=scriptedProvider({actor:messages=>{
    const last=()=>JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);
    if(step++===0)return call('write',{path:'draft/calculate.js',content:'function transform(input){return input.a + ;}'});
    if(step===2){assert.equal(last().committed,true);assert.equal(last().diagnostics.status,'invalid');return call('edit',{path:'draft/calculate.js',edits:[{oldText:'input.a + ;',newText:'input.a + input.b;'}]});}
    if(step===3){assert.equal(last().diagnostics.status,'valid');assert.equal(last().diagnostics.executed,false);return call('run_script',{path:'draft/calculate.js',input:'{"a":12,"b":30}'});}
    if(step===4){assert.equal(last().output,42);return planCall([valueEdit(last().output)]);}
    return text('반영 결과를 확인했습니다.');
  }});
  const run=startAgent({request:'12와 30을 합산해 A1에 넣어줘',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const wait=await until(run,native.action,1);assert.equal(wait.action?.payload.kind,'edit',wait.error);
    assert.equal(native.writes,0);assert.equal(wait.metrics.skillWorkspace.edits,1);assert.equal(wait.metrics.skillWorkspace.scriptRuns,1);
    run.respond(wait.action.callId,{approved:true});const done=await until(run,native.action,1);
    assert.equal(done.state,'done',done.error);assert.equal(native.writes,1);assert.equal(native.state.values[0][0],42);
  }finally{run.cancel();await run.promise;}
});
