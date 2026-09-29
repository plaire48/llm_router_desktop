// Found by the live run B2 of 2026-09-29 (cases D2 and D3): reading a long
// Wiki page gave a result above 12,000 characters, which a review cannot use
// as evidence, so the review asked for the same reads until the time ran out.
// Every read also repeated 3,500 characters of project rules that the host
// receipts already carry, and a request for more than 200 lines was refused
// with guidance about the file length.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {resultReviewInput} from '../runtime/result-review.mjs';
import {recoveryInstruction} from '../runtime/tool-feedback.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

const REVIEW_ENTRY_LIMIT=12000;
const line=(index,width)=>`${String(index).padStart(3,'0')} `+'가나다라 "quoted" \\ value '.repeat(20).slice(0,width-4);
async function project(t){
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'docs'));await mkdir(path.join(root,'src'));
  await writeFile(path.join(root,'AGENTS.md'),'# Rules\n\n'+'Keep amounts as integers. '.repeat(120));
  await writeFile(path.join(root,'src','AGENTS.md'),'Scoped rule for src.');
  await writeFile(path.join(root,'src','code.mjs'),Array.from({length:60},(_,i)=>`export const v${i}=${i};`).join('\n'));
  await writeFile(path.join(root,'docs','long.md'),Array.from({length:300},(_,i)=>line(i+1,120)).join('\n'));
  await writeFile(path.join(root,'docs','short.md'),Array.from({length:260},(_,i)=>'row '+(i+1)).join('\n'));
  await git(root,['add','-A']);await git(root,['commit','-qm','documents']);
  return {service,root};
}
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function reads(t,requests){
  const {service}=await project(t);let round=0,receipts;const results=[];
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(message=>message.role==='tool');if(last)results.push({text:last.content,value:JSON.parse(last.content)});
    receipts??=messages.find(message=>String(message.content).startsWith('Current host receipts'))?.content;
    return round<requests.length?call('read_source',requests[round++]):{content:'확인했습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'문서를 확인해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  return {results,receipts,service,task};
}

test('a request for more than 200 lines returns its first 200 and says where to continue',async t=>{
  const {service}=await project(t);
  const read=await service.read({path:'docs/short.md',start:1,end:260});
  assert.equal(read.start,1);assert.equal(read.end,200);assert.equal(read.nextStart,201);assert.equal(read.truncated,true);
  assert.deepEqual(read.limited,{by:'lines',requestedEnd:260});
  assert.equal(read.content.split('\n').length,200);
  const rest=await service.read({path:'docs/short.md',start:201,end:260});
  assert.equal(rest.end,260);assert.equal(rest.nextStart,null);assert.equal('limited' in rest,false);
});

test('a start beyond the file is refused with the file length',async t=>{
  const {service}=await project(t);
  await assert.rejects(service.read({path:'docs/short.md',start:261}),error=>error.message==='range_invalid'&&error.details.lines===260);
  await assert.rejects(service.read({path:'docs/short.md',start:5,end:4}),/range_invalid/);
  assert.match(recoveryInstruction('range_invalid','read_source'),/details\.lines/);
});

test('a read through the agent stays small enough to serve as review evidence',async t=>{
  const {results}=await reads(t,[{path:'docs/long.md'},{path:'docs/long.md',start:1,end:300}]);
  for(const {text,value} of results){
    assert.ok(text.length<REVIEW_ENTRY_LIMIT,'result characters: '+text.length);
    assert.ok(value.end<200,'a size limit ends the read before 200 lines: '+value.end);
    assert.equal(value.nextStart,value.end+1);assert.equal(value.limited.by,'size');
    assert.equal(value.content.split('\n').length,value.end,'whole lines only');
    assert.equal(value.content.split('\n').at(-1),line(value.end,120));
    assert.equal(value.provenance.end,value.end);
  }
  assert.equal(results[1].value.limited.requestedEnd,300);
});

test('a read that fits is returned whole',async t=>{
  const {results}=await reads(t,[{path:'app.txt'},{path:'src/code.mjs'}]);
  assert.equal(results[0].value.content,'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n');
  assert.equal('limited' in results[0].value,false);assert.equal(results[1].value.end,60);
});

test('one line longer than the size limit is still returned whole',async t=>{
  const {service,root}=await project(t);
  await writeFile(path.join(root,'docs','wide.md'),'x'.repeat(20000)+'\nnext');
  const read=await service.read({path:'docs/wide.md',maxChars:9000});
  assert.equal(read.end,1);assert.equal(read.content.length,20000);assert.equal(read.nextStart,2);
});

test('rules that host receipts already carry are named in a read, not repeated',async t=>{
  const {results,receipts,service,task}=await reads(t,[{path:'docs/short.md'},{path:'src/code.mjs'}]);
  assert.match(receipts,/Keep amounts as integers/,'host receipts carry the root rules');
  const [document,code]=results.map(result=>result.value);
  assert.equal(document.projectRules.files.length,1);
  assert.deepEqual(Object.keys(document.projectRules.files[0]).sort(),['hash','path','scope','shown']);
  assert.equal(document.projectRules.files[0].shown,'host receipts projectGuidance');
  assert.ok(!results[0].text.includes('Keep amounts as integers'));
  assert.equal(document.projectRules.fingerprint,(await service.read({path:'docs/short.md',taskId:task.id})).projectRules.fingerprint,'the fingerprint that edits are checked against is unchanged');
  assert.deepEqual(code.projectRules.files.map(file=>file.path),['AGENTS.md','src/AGENTS.md']);
  assert.equal(code.projectRules.files[1].content,'Scoped rule for src.','rules the receipts do not carry stay in the read');
});

test('an edit still needs the rules fingerprint of the read',async t=>{
  const {service}=await project(t);
  const read=await service.read({path:'src/code.mjs'});
  assert.equal(read.projectRules.files[0].content.startsWith('# Rules'),true,'the service result keeps the rules for host checks');
});

const task={id:'t',request:'문서를 정리해 줘',criteria:[],messages:[{role:'user',content:'문서를 정리해 줘'}]};
const source=(pathName,start,end,content)=>({tool:'read_source',result:{path:pathName,content,hash:'h',start,end}});
test('the same result read twice is given to the review once',()=>{
  const evidence=[source('a.md',1,50,'alpha'),source('b.md',1,50,'beta'),source('a.md',1,50,'alpha'),{tool:'read_source',result:{ok:false,error:'range_invalid'}},{tool:'read_source',result:{ok:false,error:'range_invalid'}}];
  const {data}=resultReviewInput({task,evidence,receipts:{},candidate:'답',model:{contextLength:200000}});
  assert.deepEqual(data.evidence.map(entry=>entry.id),['host','tool:4','tool:2','tool:1']);
  assert.equal(data.duplicateEvidence,2);assert.equal(data.omittedEvidence,0);
});
