import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {runOfficeDocumentProcess} from '../runtime/office-document.mjs';
import {officeReadDiagnostic} from '../runtime/office-read-diagnostic.mjs';
const document={reader:'office_com',officeVersion:'16.0',text:'검증한 본문',segments:[{text:'검증한 본문'}],coverage:'fixture'};
const progress=value=>`process.stderr.write('NUBI_OFFICE_PROGRESS '+JSON.stringify(${JSON.stringify(value)})+'\\n');`;
function read(source,{limits={idleMs:180,maxMs:1500},onProgress,signal}={}){
 return runOfficeDocumentProcess({binary:'powershell.exe',script:'fixture',env:{},request:{app:'excel'},limits,onProgress,signal,
  spawnProcess:(_binary,_args,options)=>spawn(process.execPath,['--input-type=module','-e',source],{...options,env:{}})});
}
test('actual progress permits a longer read while the final Office receipt is still required',async()=>{
 const events=[];
 const source=`let n=0;const timer=setInterval(()=>{process.stderr.write('NUBI_OFFICE_PROGRESS '+JSON.stringify({app:'excel',stage:'read',unit:'cells',completed:++n,total:6})+'\\n');if(n===6){clearInterval(timer);process.stdout.end(${JSON.stringify(JSON.stringify({document}))});}},65);`;
 const result=await read(source,{onProgress:value=>events.push(value)});
 assert.equal(result.text,document.text);assert.equal(events.at(-1).completed,6);assert.equal(events.at(-1).total,6);
});
test('a stalled open preserves its last stage and bounded elapsed time without private output',async()=>{
 await assert.rejects(read(progress({app:'excel',stage:'open',officeVersion:'16.0',path:'PRIVATE',message:'PRIVATE'})+`setInterval(()=>{},1000);`),error=>{
  assert.equal(error.message,'document_office_timeout');assert.equal(error.officeDiagnostic.stage,'open');assert.equal(error.officeDiagnostic.timeoutKind,'idle');assert(error.officeDiagnostic.elapsedMs>=150);assert.doesNotMatch(JSON.stringify(error),/PRIVATE/);return true;
 });
});
test('repeated counters and unrelated stderr do not keep a stuck COM call alive',async()=>{
 const event=progress({app:'excel',stage:'read',unit:'cells',completed:10,total:100});
 await assert.rejects(read(event+`setInterval(()=>{${event}process.stderr.write('PRIVATE\\n');},30);`),error=>error.message==='document_office_timeout'&&error.officeDiagnostic.completed===10&&error.officeDiagnostic.timeoutKind==='idle');
});
test('the absolute deadline still bounds a reader that continues to report progress',async()=>{
 const source=`let n=0;setInterval(()=>process.stderr.write('NUBI_OFFICE_PROGRESS '+JSON.stringify({app:'excel',stage:'read',unit:'cells',completed:++n,total:10000})+'\\n'),30);`;
 await assert.rejects(read(source,{limits:{idleMs:180,maxMs:300}}),error=>error.message==='document_office_timeout'&&error.officeDiagnostic.timeoutKind==='overall');
});
test('split frames are decoded and malformed or oversized progress never becomes native evidence',async()=>{
 const events=[],line='NUBI_OFFICE_PROGRESS '+JSON.stringify({stage:'read',app:'excel',unit:'cells',completed:1,total:1});
 const source=`process.stderr.write('NUBI_OFFICE_PROGRESS '+ 'x'.repeat(5000)+'\\n');process.stderr.write(${JSON.stringify(line.slice(0,25))});setTimeout(()=>{process.stderr.write(${JSON.stringify(line.slice(25)+'\n')});process.stdout.end(${JSON.stringify(JSON.stringify({document}))});},20);`;
 await read(source,{onProgress:value=>events.push(value)});assert.equal(events.length,1);assert.equal(events[0].completed,1);
 assert.deepEqual(officeReadDiagnostic({stage:'PRIVATE',completed:-1,total:2,unit:'password',timeoutKind:'PRIVATE',elapsedMs:Infinity}),null);
});
test('cancellation stops the reader without a completion receipt',async()=>{
 const controller=new AbortController();
 const pending=read(progress({app:'excel',stage:'read'})+`setInterval(()=>{},1000);`,{signal:controller.signal,onProgress:()=>controller.abort()});
 await assert.rejects(pending,/mail_cancelled/);
});
