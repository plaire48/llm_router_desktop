import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {nativeFixture} from './native-word-host.mjs';

const script=new URL('../scripts/read-word-native.mjs',import.meta.url);
async function run(h,{closeOnTool=false,changeStart}={}){
  assert.equal(await access(script).then(()=>true,()=>false),true,'Native read process entrypoint is missing');
  const child=spawn(process.execPath,[fileURLToPath(script)],{stdio:['pipe','pipe','pipe']});let stderr='',result;const tools=[];
  child.stderr.setEncoding('utf8');child.stderr.on('data',x=>{stderr+=x;});
  child.stdin.on('error',()=>{});
  const lines=createInterface({input:child.stdout});
  lines.on('line',async line=>{
    const message=JSON.parse(line);
    if(message.type==='word_read_result'){result=message;return;}
    assert.equal(message.type,'tool');tools.push(message);
    if(closeOnTool){child.stdin.end();return;}
    let response;
    try{response=await h.connection.call(message.name,message.input,new AbortController().signal);}
    catch{response={ok:false,error:'office_member_unavailable'};}
    child.stdin.write(JSON.stringify({type:'tool_result',runId:message.runId,id:message.id,result:response})+'\n');
  });
  const metadata={...h.connection};delete metadata.call;
  const start={type:'word_read_start',runId:'process-read-1',environment:'fixture',connection:metadata};changeStart?.(start);
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
  const timer=setTimeout(()=>child.kill(),5000);
  child.stdin.write(JSON.stringify(start)+'\n');
  try{return {code:await exited,result,stderr,tools};}finally{clearTimeout(timer);lines.close();}
}
test('the real child process completes the read protocol and emits a report without document text',async()=>{
  const result=await run(nativeFixture());
  assert.equal(result.code,0);assert.equal(result.stderr,'');assert.equal(result.result.runId,'process-read-1');
  const report=result.result.result;assert.equal(report.status,'read');assert.equal(report.environment,'fixture');
  assert.equal(report.evidence.consistency,'two_pass_match');assert.equal(report.paragraphs,2);assert.equal(report.formatRuns,4);
  assert.equal(report.textSha256,createHash('sha256').update('제목\r회의는 3월 12일입니다.\r').digest('hex'));
  assert.equal(report.leaseReleased,true);assert.equal(report.documentWritesDispatched,0);
  assert.equal(JSON.stringify(result.result).includes('3월 12일'),false);assert.equal(JSON.stringify(result.result).includes('맑은 고딕'),false);
  assert.ok(result.tools.length>1);
});
test('the process reports a changing source as failure without returning a text digest',async()=>{
  const h=nativeFixture();h.c.afterInspection=n=>{if(n===1)h.c.text='제목\r회의는 3월 19일입니다.\r';};
  const result=await run(h);assert.equal(result.code,1);assert.equal(result.result.result.error,'native_source_changed');
  assert.equal(result.result.result.status,'failed');assert.equal(result.result.result.textSha256,undefined);
});
test('invalid bound ranges cannot reach native through the child process',async()=>{
  const result=await run(nativeFixture(),{changeStart:x=>{x.connection.range.end=9999;}});
  assert.equal(result.code,1);assert.equal(result.result.result.error,'native_scope_unsupported');assert.equal(result.tools.length,0);
});
test('parent pipe closure produces an explicit connection failure',async()=>{
  const result=await run(nativeFixture(),{closeOnTool:true});
  assert.equal(result.code,1);assert.equal(result.result.result.error,'native_connection_closed');
});
