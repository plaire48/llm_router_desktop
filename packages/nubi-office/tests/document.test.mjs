import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import ExcelJS from 'exceljs';
import {normalizeSheet,parseDocumentTask,verifyDocument,validateFormula} from '../worker/document-schema.mjs';import {writeDocument} from '../worker/document-file.mjs';import {startDocumentAgent} from '../worker/document-agent.mjs';import {drive,text,call} from './harness-fixtures.mjs';import {documentTask,rawSheets,specs,request,documentProvider,syntheticSnapshot,documentVerdict} from './document-fixtures.mjs';
test('whole-document requirements must map to planned sheets',()=>{const t=structuredClone(documentTask);t.sheets[0].requirementIds=['plan'];t.sheets[1].requirementIds=['budget'];assert.throws(()=>parseDocumentTask(text(JSON.stringify(t))),/document_schema_invalid/);assert.equal(parseDocumentTask(text(JSON.stringify(documentTask))).sheets.length,2);});
test('complete sheet validation rejects overwritten merge content and external references',()=>{const s=structuredClone(rawSheets[0]);s.cells.push({address:'B1',value:'lost'});assert.throws(()=>normalizeSheet(s,documentTask.sheets[0],['運営']),/document_reference_invalid|document_schema_invalid/);assert.throws(()=>validateFormula('=EVILUDF(A1)',['A']),/unsupported_formula/);assert.throws(()=>validateFormula("='Missing'!A1",['A']),/document_reference_invalid/);assert.throws(()=>validateFormula('=WEBSERVICE("https://example.org")',['A']),/unsupported_formula/);});
test('actual XLSX serialization preserves multiple sheets, typed dates, formulas, merged headings and layout',async()=>{const dir=await mkdtemp(join(tmpdir(),'nubi-document-'));try{const out=await writeDocument(documentTask,specs(),{directory:dir});const b=new ExcelJS.Workbook();await b.xlsx.readFile(out.path);assert.equal(b.worksheets.length,2);assert.equal(b.getWorksheet('운영계획').getCell('B5').value.toISOString().slice(0,10),'2026-10-01');assert.equal(b.getWorksheet('예산').getCell('D9').formula,'SUM(D6:D8)');assert.equal(b.getWorksheet('운영계획').getCell('B12').formula,"'예산'!D9");assert.equal(b.getWorksheet('운영계획').getCell('A1').font.size,18);assert.ok(b.getWorksheet('운영계획').getCell('D1').isMerged);assert.equal(b.getWorksheet('예산').getCell('B6').value,15000);assert.equal(b.getWorksheet('예산').getCell('B6').border.top.style,'thin');assert.equal(b.getWorksheet('예산').pageSetup.fitToWidth,1);assert.equal(out.sha256.length,64);}finally{await rm(dir,{recursive:true,force:true});}});
const file=async()=>({fileName:'control.xlsx',sha256:'control',path:'/synthetic/draft.xlsx'});
test('new-workbook writer recalls earlier conversation without losing accepted sheets or final review',async()=>{
  const ordinary=documentProvider();let recalled=false,reviewSawSource=false;
  const provider={status:ordinary.status,complete:async(messages,tools)=>{
    if(messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')&&!recalled){recalled=true;assert.ok(tools.some(t=>t.function.name==='recall_context'));return{content:'',calls:[{id:'history-read',type:'function',function:{name:'recall_context',arguments:JSON.stringify({query:'별도부록'})}}],finishReason:'tool_calls'};}
    if(messages[0].content.startsWith('NUBI_DOCUMENT_REVIEWER'))reviewSawSource=JSON.stringify(messages).includes('별도부록');
    return ordinary.complete(messages,tools);
  }};
  const run=startDocumentAgent({request,history:[{role:'user',content:'별도부록은 필요하지 않습니다.'}],providers:provider,writeFile:file,resilienceOptions:{wait:async()=>{}}});
  const result=await drive(run,a=>a.name==='document_open'?syntheticSnapshot(a.payload):{saved:true,path:'C:/report.xlsx',sha256:'saved',documentId:'draft-id'});
  assert.equal(result.state,'done',result.error);assert.equal(result.writes,2);assert.equal(result.metrics.historyContext.retrievals,1);assert.equal(reviewSawSource,true);
});
async function runScenario(provider,host){const run=startDocumentAgent({request,providers:provider,writeFile:file,resilienceOptions:{wait:async()=>{}}});const calls=[];const result=await drive(run,async a=>{calls.push(a);return host?host(a):a.name==='document_open'?syntheticSnapshot(a.payload):{saved:true,path:'C:\\Documents\\NubiOffice\\report.xlsx',sha256:'saved-file-hash',documentId:'draft-id'};});return{result,calls};}
test('Pi document workflow completes only after full workbook observation, review and save',async()=>{const{result,calls}=await runScenario(documentProvider());assert.equal(result.state,'done',result.error);assert.equal(result.kind,'document');assert.equal(result.plan.completed,5);assert.deepEqual(calls.map(a=>a.name),['document_open','document_save']);assert.equal(calls[0].payload.specs.length,2);assert.equal(result.validation.verified,true);assert.equal(result.artifact.saved,true);});
test('missing business input asks without writing files or calling Excel',async()=>{const t={...documentTask,intent:'clarify',questions:['교육 인원은 몇 명인가요?'],sheets:[]};let files=0;const run=startDocumentAgent({request,providers:documentProvider({task:t}),writeFile:async()=>{files++;throw new Error('unexpected_file');}});for(let i=0;i<100&&!run.status().action;i++)await new Promise(r=>setImmediate(r));assert.equal(run.status().action.name,'request_input');assert.equal(files,0);run.cancel();await run.promise;});
test('schema failure is returned to Pi and corrected before native document creation',async()=>{const{result}=await runScenario(documentProvider({badFirst:true}));assert.equal(result.state,'done',result.error);assert.ok(result.activity.some(e=>e.title.includes('다시 수정')));});
test('review cannot waive failed actual values or missing layout evidence',()=>{const all=specs(),snapshot=syntheticSnapshot({specs:all});snapshot.sheets[0].cells[0].value='wrong';snapshot.sheets[1].layoutVerified=false;assert.equal(verifyDocument(documentTask,all,snapshot).verified,false);});
test('model review finds missing requirement, revises affected sheet and reinspects before save',async()=>{let n=0;const{result,calls}=await runScenario(documentProvider({review:p=>++n===1?{...documentVerdict(p),status:'revise',revisionSheets:['운영계획'],feedback:'교육 내용의 문장을 더 명확히 작성하세요.'}:documentVerdict(p)}));assert.equal(result.state,'done',result.error);assert.deepEqual(calls.map(a=>a.name),['document_open','document_open','document_save']);assert.equal(calls[1].payload.previousId,'draft-id');});
test('fabricated review evidence is rejected through four retries before a valid review permits saving',async()=>{let attempts=0;const{result,calls}=await runScenario(documentProvider({review:p=>{const r=documentVerdict(p);if(++attempts<=4)r.checks[0].evidence=[{sheet:'없음',address:'A1'}];return r;}}));assert.equal(result.state,'done',result.error);assert.equal(attempts,5);assert.equal(calls.filter(a=>a.name==='document_save').length,1);});
test('lost open or save reply is reconciled read-only without repeating the mutation',async()=>{for(const failure of ['document_open','document_save']){let snapshot;const saved={saved:true,path:'C:/report.xlsx',sha256:'saved',documentId:'draft-id'};const{result,calls}=await runScenario(documentProvider(),a=>{if(a.name==='document_open')snapshot=syntheticSnapshot(a.payload);if(a.name===failure)return{error:'office_timeout'};if(a.name==='document_reconcile')return{outcome:'complete',result:failure==='document_open'?snapshot:saved};return a.name==='document_open'?snapshot:saved;});assert.equal(result.state,'done',result.error);assert.equal(calls.filter(a=>a.name===failure).length,1);assert.equal(calls.filter(a=>a.name==='document_reconcile').length,1);}});
test('fresh calculation evidence is mandatory even when all expected numbers match',()=>{const all=specs(),s=syntheticSnapshot({specs:all});s.calculated=false;assert.equal(verifyDocument(documentTask,all,s).verified,false);});
test('blank input fields, zero and false retain their distinct meanings',()=>{const s={name:'입력',address:'A1:C1',cells:[{address:'A1',value:'',valueType:'text'},{address:'B1',value:0},{address:'C1',value:false}]};const result=normalizeSheet(s,{name:'입력'},['입력']);assert.deepEqual(result.cells.map(c=>c.value),[null,0,false]);s.cells.push({address:'a1',value:'duplicate'});assert.throws(()=>normalizeSheet(s,{name:'입력'},['입력']),/document_schema_invalid/);});
test('plan acknowledgement precedes file generation and cancellation stops native actions',async()=>{let fileCalls=0;const run=startDocumentAgent({request,providers:documentProvider(),writeFile:async()=>{fileCalls++;return file();}});for(let i=0;i<100&&!run.status().action;i++)await new Promise(r=>setImmediate(r));assert.equal(run.status().action.name,'show_plan');assert.equal(fileCalls,0);run.cancel();await run.promise;assert.equal(run.status().state,'cancelled');assert.equal(fileCalls,0);});

for(const injectFailure of [false,true])test(`draft checkpoints preserve accepted chunks and count only actual tool failures (injected=${injectFailure})`,async()=>{
  const base=documentProvider(),counts=new Map();let waits=0,injected=false,retainedError=false;
  const provider={...base,async complete(messages,tools){
    if(!messages[0].content.startsWith('NUBI_DOCUMENT_WRITER'))return base.complete(messages,tools);
    const packet=messages.filter(m=>m.role==='user').map(m=>{try{return JSON.parse(m.content);}catch{return{};}}).find(m=>m.currentSheet);
    if(injectFailure&&!injected){injected=true;return call('write_document_chunk',{chunk:JSON.stringify({cells:[{address:'invalid',value:1}]})});}
    if(packet.partialDraft&&packet.lastError==='document_schema_invalid')retainedError=true;
    const source=rawSheets.find(s=>s.name===packet.currentSheet.name),i=counts.get(source.name)||0;counts.set(source.name,i+1);
    if(i<source.cells.length)return call('write_document_chunk',{chunk:JSON.stringify({...source,cells:[source.cells[i]],...(i===source.cells.length-1?{}:{formats:[],merges:[],borders:[]})})});
    const receipt=messages.findLast(m=>m.role==='tool');assert.equal(receipt?JSON.parse(receipt.content).cellCount:packet.partialDraft.cells.length,source.cells.length);return call('commit_document_sheet');
  }};
  const run=startDocumentAgent({request,providers:provider,writeFile:file,resilienceOptions:{wait:async()=>{waits++;}}});
  const result=await drive(run,a=>a.name==='document_open'?syntheticSnapshot(a.payload):{saved:true,path:'C:/report.xlsx',sha256:'saved',documentId:'draft-id'});
  assert.equal(result.state,'done',result.error);assert.ok(result.metrics.continuity.checkpoints>=4);assert.equal(result.metrics.retries||0,Number(injectFailure));assert.equal(result.metrics.localToolFailures||0,Number(injectFailure));assert.equal(result.metrics.recoveryPauses||0,0);assert.equal(waits,Number(injectFailure));
  assert.equal(result.writes,2);assert.equal(retainedError,injectFailure,'context renewal must retain the actual tool failure, not replace it with a compaction error');for(const s of rawSheets)assert.equal(counts.get(s.name),s.cells.length+1);
});

test('large current sheet remains intact across bounded context, exact reads and rejected whole replacement',async()=>{
  const task={intent:'create',title:'보고',summary:'내용 작성',requirements:[{id:'R1',text:'모든 입력 항목 보존'}],questions:[],sheets:[{name:'보고',purpose:'본문',requirementIds:['R1']}]};
  const cells=Array.from({length:16},(_,i)=>({address:'A'+(i+1),value:('정확한 본문 '+i+' ').repeat(250)}));
  let next=0,sawBounded=false,sawRead=false,sawBlocked=false,generated;
  const provider={status:()=>({provider:'aipro',model:'scripted-qwen'}),async complete(messages){
    const system=messages[0].content;
    if(system.startsWith('NUBI_DOCUMENT_PLANNER'))return text(JSON.stringify(task));
    if(system.startsWith('NUBI_DOCUMENT_REVIEWER'))return text(JSON.stringify({status:'complete',checks:[{requirementId:'R1',requirement:'모든 입력 항목 보존',status:'met',evidence:[{sheet:'보고',address:'A1'}]}],revisionSheets:[],feedback:''}));
    const packet=JSON.parse(messages.findLast(m=>m.role==='user').content),receipt=messages.findLast(m=>m.role==='tool');
    if(packet.partialDraft?.draftView){sawBounded=true;assert.ok(JSON.stringify(packet.partialDraft).length<=24000);}
    if(receipt){const result=JSON.parse(receipt.content);if(result.error==='document_schema_invalid')sawBlocked=true;if(result.cells?.[0]?.address==='A1'){sawRead=true;assert.equal(result.cells[0].value,cells[0].value);}}
    if(next<cells.length)return call('write_document_chunk',{chunk:JSON.stringify({address:'A1:A16',cells:[cells[next++]]})});
    if(next++===16)return call('write_document_sheet',{sheet:JSON.stringify({name:'보고',address:'A1:A16',cells:[cells[0]]})});
    if(next===18)return call('read_document_draft',{sheet:'보고',address:'A1'});
    return call('commit_document_sheet');
  }};
  const run=startDocumentAgent({request:'모든 항목을 보존한 보고서 작성',providers:provider,writeFile:async(_,specs)=>{generated=structuredClone(specs);return file();},resilienceOptions:{wait:async()=>{}}});
  const result=await drive(run,a=>a.name==='document_open'?syntheticSnapshot(a.payload):{saved:true,path:'C:/report.xlsx',sha256:'saved',documentId:'draft-id'});
  assert.equal(result.state,'done',result.error);assert.ok(sawBounded);assert.ok(sawRead);assert.ok(sawBlocked);assert.deepEqual(generated[0].cells.map(c=>({address:c.address,value:c.value})),cells);assert.equal(result.writes,1);
});
