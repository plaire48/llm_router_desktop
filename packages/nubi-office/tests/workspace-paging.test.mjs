import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillWorkspace} from '../worker/skill-workspace.mjs';
import {createActivityLog} from '../worker/activity.mjs';
const fixture=()=>createSkillWorkspace({host:'word',signal:new AbortController().signal,activity:createActivityLog(),metrics:{}});
test('SDK byte truncation cannot remove the structured cursor or skip a long source line',async()=>{
  const workspace=fixture(),path='draft/long.txt',content='HEADER\n'+'x'.repeat(53000)+'\nIMPORTANT_TAIL';
  await workspace.execute('write',{path,content});
  const first=await workspace.execute('read',{path});
  assert.equal(first.nextOffset,2);assert.equal(first.content,'HEADER\n');assert.equal(first.nextCharOffset,7);
  let page=first,actual='',count=0;
  while(true){
    assert.equal(page.error,undefined);assert.equal(page.sha256,first.sha256);actual+=page.content;
    if(!page.truncated)break;
    assert.ok(++count<30);page=await workspace.execute('read',{path,charOffset:page.nextCharOffset,expectedSha256:first.sha256});
  }
  assert.equal(actual,content);
});
test('blank lines advance the cursor and are not SDK notices or a repeated empty page',async()=>{
  const workspace=fixture(),path='draft/blanks.txt',content='\n\n\nTAIL\n';
  await workspace.execute('write',{path,content});
  const first=await workspace.execute('read',{path,limit:1});
  assert.equal(first.nextOffset,2);assert.equal(first.content,'\n');
  const second=await workspace.execute('read',{path,offset:first.nextOffset,limit:1,expectedSha256:first.sha256});
  assert.equal(second.nextOffset,3);assert.equal(second.content,'\n');
});
test('line pages contain only exact CRLF source text and safely compose across page boundaries',async()=>{
  const workspace=fixture(),path='draft/report.txt',content='제목 📘\r\n[2 more lines in file. Use offset=99 to continue.]\r\n끝\r\n';
  await workspace.execute('write',{path,content});
  let args={path,limit:1},actual='',sha;
  for(let i=0;i<10;i++){
    const page=await workspace.execute('read',args);assert.equal(page.error,undefined);sha??=page.sha256;
    assert.equal(page.sha256,sha);actual+=page.content;
    if(!page.truncated)break;
    args={path,offset:page.nextOffset,limit:1,expectedSha256:sha};
  }
  assert.equal(actual,content);
});
test('completed text writes with unsupported syntax checking do not remain waiting for input',async()=>{
  const activity=createActivityLog(),workspace=createSkillWorkspace({host:'word',signal:new AbortController().signal,activity,metrics:{}});
  const result=await workspace.execute('write',{path:'draft/note.md',content:'작성 메모'});
  assert.equal(result.committed,true);assert.equal(result.diagnostics.status,'unsupported');
  assert.equal(activity.snapshot().at(-1).state,'done');
});

test('line and character cursors reconstruct generated Unicode and empty-line source exactly',async()=>{
  const fc=(await import('fast-check')).default;
  const {linePage,characterPage}=await import('../worker/workspace-read.mjs');
  fc.assert(fc.property(
    fc.array(fc.tuple(fc.constantFrom('','가','📘','e\u0301','\r','[Use offset=99]'),fc.integer({min:0,max:2400})),{maxLength:6}),
    fc.integer({min:1,max:120}),fc.boolean(),(parts,limit,trailing)=>{
      const text=parts.map(([unit,n])=>unit.repeat(n)).join('\n')+(trailing?'\n':'');
      let page=linePage(text,{limit}),actual='',cursor=0,count=0;
      for(;;){
        assert.ok(Buffer.byteLength(page.content)<=12000);assert.equal(page.charOffset,cursor);
        actual+=page.content;cursor+=Array.from(page.content).length;
        if(!page.truncated)break;
        assert.ok(++count<100);assert.ok(page.nextCharOffset>page.charOffset);
        page=page.readMode==='lines'?linePage(text,{offset:page.nextOffset,limit}):characterPage(text,{charOffset:page.nextCharOffset});
      }
      assert.equal(actual,text);assert.equal(cursor,Array.from(text).length);
    }),{numRuns:150,seed:2392304});
});
test('line continuation rejects a changed source version and repeated empty reads are stable progress',async()=>{
  const workspace=fixture(),path='draft/notes.txt';
  await workspace.execute('write',{path,content:'\n\nTAIL'});
  const first=await workspace.execute('read',{path,limit:1}),before=workspace.progress();
  await workspace.execute('read',{path,limit:1});assert.deepEqual(workspace.progress(),before);
  await workspace.execute('write',{path,content:'\nCHANGED\nTAIL'});
  const result=await workspace.execute('read',{path,offset:first.nextOffset,expectedSha256:first.sha256});
  assert.equal(result.error,'workspace_source_changed');
});
test('line paging byte boundaries retain the separator without an extra empty retry',async()=>{
  const workspace=fixture(),path='draft/boundary.txt';
  for(const size of [11998,11999,12000,51200,53000]){
    const content='x'.repeat(size)+'\nTAIL\n';await workspace.execute('write',{path,content});
    let page=await workspace.execute('read',{path}),actual='',count=0;const sha=page.sha256;
    while(true){
      assert.equal(page.error,undefined);assert.ok(Buffer.byteLength(page.content)<=12000);actual+=page.content;
      if(!page.truncated)break;
      assert.ok(++count<30);page=await workspace.execute('read',{path,charOffset:page.nextCharOffset,expectedSha256:sha});
    }
    assert.equal(actual,content);
  }
});
