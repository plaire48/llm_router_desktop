import test from 'node:test';
import assert from 'node:assert/strict';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {drive,text,call} from './harness-fixtures.mjs';
import {request,rawSheets,documentProvider,syntheticSnapshot} from './document-fixtures.mjs';

const file=async()=>({fileName:'control.xlsx',sha256:'control',path:'/synthetic/draft.xlsx'});
const tasks=name=>[
  {id:'content',specialty:'내용 작성',goal:'요구사항에 맞는 본문과 계산을 제안',role:'analysis',constraints:'확인된 정보만 사용',doneWhen:'실제 셀 초안 제공',sheetNames:[name],dependsOn:[]},
  {id:'layout',specialty:'표 구성',goal:'표와 인쇄 양식을 제안',role:'review',constraints:'Office 2016 지원 범위',doneWhen:'읽기 쉬운 양식 초안 제공',sheetNames:[name],dependsOn:[]},
  {id:'combine',specialty:'초안 통합',goal:'선행 제안을 비교해 완성된 시트 초안을 제안',role:'review',constraints:'원래 요구사항 보존',doneWhen:'두 제안의 충돌을 확인한 시트 초안 제공',sheetNames:[name],dependsOn:['content','layout']}
];

test('real Pi writer delegates, reads actual proposals and integrates only through parent commits before native verification and HITL save',async()=>{
  const documentSkill={id:'00000000-0000-4000-8000-000000000001',host:'excel',revision:1,name:'검토 규칙',instructions:'금액은 천 원 단위로 검토한다.',questions:[]},ordinary=documentProvider(),phases=new Map(),proposals=new Map(),childCalls=[];let active=0,peak=0,parentReads=0,reviewCalls=0;
  const provider={status:()=>({provider:'aipro',model:'scripted-selected-model'}),complete:async(messages,tools,signal)=>{
    if(messages[0].content.startsWith('NUBI_DRAFT_SPECIALIST')){
      const packet=JSON.parse(messages[1].content);assert.deepEqual(tools,[]);assert.equal(signal.aborted,false);childCalls.push(packet);active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
      assert.ok(messages.some(message=>message.content.includes('parent_task_context')&&message.content.includes('15000')));
      assert.ok(JSON.parse(messages.at(-1).content).activeSkills[0].instructions.includes(documentSkill.instructions));
      if(packet.task.id==='combine')assert.deepEqual(packet.dependencies.map(result=>result.proposals[0].name),[packet.task.sheetNames[0],packet.task.sheetNames[0]]);
      return text(JSON.stringify({summary:'실제 셀과 양식 초안을 제안합니다.',proposals:[structuredClone(rawSheets.find(sheet=>sheet.name===packet.task.sheetNames[0]))],missing:[]}));
    }
    if(messages[0].content.startsWith('NUBI_DOCUMENT_REVIEWER'))reviewCalls++;
    if(!messages[0].content.startsWith('NUBI_DOCUMENT_WRITER'))return ordinary.complete(messages,tools);
    const packet=messages.filter(message=>message.role==='user').map(message=>{try{return JSON.parse(message.content);}catch{return{};}}).find(value=>value.currentSheet);
    const name=packet.currentSheet.name,phase=phases.get(name)??0;phases.set(name,phase+1);
    assert.ok(tools.some(tool=>tool.function.name==='delegate_draft_tasks'));
    if(phase===0)return call('delegate_draft_tasks',{tasks:tasks(name)});
    const receipt=JSON.parse(messages.findLast(message=>message.role==='tool').content);
    if(phase===1){assert.equal(receipt.status,'analyzed');assert.equal(receipt.results[2].proposals[0].name,name);return call('read_delegation_results',{planId:receipt.planId,taskIds:['combine']});}
    if(phase===2){parentReads++;const proposal=receipt.tasks[0].result.proposals[0];assert.equal(proposal.name,name);proposals.set(name,proposal);return call('write_document_chunk',{chunk:JSON.stringify(proposal)});}
    if(phase===3){assert.equal(receipt.chunkAccepted,true);assert.equal(receipt.cellCount,proposals.get(name).cells.length);return call('commit_document_sheet');}
    throw new Error('unexpected_writer_decision');
  }};
  const run=startDocumentAgent({request,documentSkill,providers:provider,writeFile:file,resilienceOptions:{wait:async()=>{}}}),native=[];
  const result=await drive(run,action=>{native.push(action.name);if(action.name==='document_open')return syntheticSnapshot(action.payload);return{saved:true,path:'C:/report.xlsx',sha256:'saved',documentId:'draft-id'};});
  assert.equal(result.state,'done',result.error);assert.equal(result.writes,2);assert.equal(result.validation.verified,true);assert.equal(childCalls.length,6);assert.equal(peak,2);assert.equal(parentReads,2);assert.equal(reviewCalls,1);assert.deepEqual(native,['document_open','document_save']);assert.equal(result.delegationWorkers.nodes.length,3);assert.ok(result.delegationWorkers.nodes.every(node=>node.state==='done'));
});

test('Pi draft specialist cancellation settles visible workers and produces no file or native mutation',async()=>{
  const ordinary=documentProvider();let entered,files=0,hostCalls=0;const started=new Promise(resolve=>{entered=resolve;});
  const provider={status:()=>({provider:'aipro',model:'scripted-selected-model'}),complete:async(messages,tools,signal)=>{
    if(messages[0].content.startsWith('NUBI_DRAFT_SPECIALIST')){entered();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));}
    if(messages[0].content.startsWith('NUBI_DOCUMENT_WRITER'))return call('delegate_draft_tasks',{tasks:[tasks('운영계획')[0]]});
    return ordinary.complete(messages,tools);
  }};
  const run=startDocumentAgent({request,providers:provider,writeFile:async()=>{files++;return file();}});
  while(!run.status().action)await new Promise(resolve=>setImmediate(resolve));assert.equal(run.status().action.name,'show_plan');run.respond(run.status().action.callId,{displayed:true});await started;run.cancel();await run.promise;
  const status=run.status();if(status.action)hostCalls++;assert.equal(status.state,'cancelled');assert.equal(files,0);assert.equal(hostCalls,0);assert.ok(status.delegationWorkers.nodes.every(node=>!['running','pending'].includes(node.state)));
});

test('permanent specialist authentication failure stops the Pi document run without repeated inference or files',async()=>{
  const ordinary=documentProvider();let childCalls=0,writerCalls=0,files=0;
  const provider={status:()=>({provider:'aipro',model:'scripted-selected-model'}),complete:async(messages,tools)=>{
    if(messages[0].content.startsWith('NUBI_DRAFT_SPECIALIST')){childCalls++;throw Object.assign(new Error('unauthorized'),{status:401});}
    if(messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')){writerCalls++;return call('delegate_draft_tasks',{tasks:[tasks('운영계획')[0]]});}
    return ordinary.complete(messages,tools);
  }};
  const run=startDocumentAgent({request,providers:provider,writeFile:async()=>{files++;return file();},resilienceOptions:{wait:async()=>{throw new Error('unexpected_retry');}}});
  const status=await drive(run,()=>{throw new Error('unexpected_native');});assert.equal(status.state,'failed');assert.equal(status.error,'unauthorized');assert.equal(childCalls,1);assert.equal(writerCalls,1);assert.equal(files,0);assert.equal(status.metrics.retries,0);
});

test('transient specialist failure uses the one parent recovery owner then reads successful child proposals',async()=>{
  const ordinary=documentProvider();let phase=0,childCalls=0,waits=0;
  const provider={status:()=>({provider:'aipro',model:'scripted-selected-model'}),complete:async(messages,tools)=>{
    if(messages[0].content.startsWith('NUBI_DRAFT_SPECIALIST')){if(++childCalls===1)throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:2000});return text(JSON.stringify({summary:'본문 초안',proposals:[rawSheets[0]],missing:[]}));}
    if(messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')){
      const packet=messages.filter(message=>message.role==='user').map(message=>{try{return JSON.parse(message.content);}catch{return{};}}).find(value=>value.currentSheet);
      if(packet.currentSheet.name==='운영계획'){
        if(phase++===0)return call('delegate_draft_tasks',{tasks:[tasks('운영계획')[0]]});
        const receipt=JSON.parse(messages.findLast(message=>message.role==='tool').content);
        if(phase===2){assert.equal(receipt.error,'analysis_incomplete');assert.equal(receipt.recoveryHandled,true);assert.equal(receipt.retryAfterMs,2000);return call('delegate_draft_tasks',{tasks:[tasks('운영계획')[0]]});}
        assert.equal(receipt.status,'analyzed');return call('write_document_sheet',{sheet:JSON.stringify(receipt.results[0].proposals[0])});
      }
    }
    return ordinary.complete(messages,tools);
  }};
  const run=startDocumentAgent({request,providers:provider,writeFile:file,resilienceOptions:{wait:async ms=>{waits++;assert.ok(ms>=2000);}}});
  const result=await drive(run,action=>action.name==='document_open'?syntheticSnapshot(action.payload):{saved:true,path:'C:/report.xlsx',sha256:'saved',documentId:'draft-id'});
  assert.equal(result.state,'done',result.error);assert.equal(childCalls,2);assert.equal(result.metrics.retries,1);assert.equal(result.metrics.localToolFailures,1);assert.equal(waits,1);
});
