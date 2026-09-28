// Run against an unmodified checkout of the recorded baseline before syncing it.
// No real providers, files, mutations, builds or automatic HITL approval.
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {workbook,scriptedProvider,call} from '../tests/harness-fixtures.mjs';
import {documentProvider,request,rawSheets} from '../tests/document-fixtures.mjs';

if(!process.argv[2])throw new Error('Usage: node scripts/check-tool-progress.mjs /path/to/baseline/packages/nubi-office');
const roots={before:resolve(process.argv[2]),after:fileURLToPath(new URL('../',import.meta.url))};
const baselineCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:roots.before,encoding:'utf8'}).trim();
const results=[];
for(const [version,root] of Object.entries(roots))for(const flow of ['excel_selection','excel_document']){
  const native=workbook();let actorCalls=0,nativeReads=0;
  const base=flow==='excel_selection'?scriptedProvider({actor:()=>{actorCalls++;return call('read_selection');}}):documentProvider();
  const providers=flow==='excel_selection'?base:{...base,complete:async(messages,...args)=>{
    if(messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')){
      actorCalls++;return call('write_document_chunk',{chunk:JSON.stringify({address:rawSheets[0].address,cells:[rawSheets[0].cells[0]]})});
    }
    return base.complete(messages,...args);
  }};
  const mod=await import(pathToFileURL(root+'/worker/'+(flow==='excel_selection'?'agent.mjs':'document-agent.mjs')));
  const options={providers,resilienceOptions:{wait:async()=>{}}};
  const run=flow==='excel_selection'?mod.startAgent({...options,request:'A1을 42로 변경해줘',mode:'edit',scope:native.snapshot()}):mod.startDocumentAgent({...options,request,writeFile:async()=>{throw new Error('Unexpected file creation');}});
  try{
    let observed;
    for(let i=0;i<5000;i++){
      const s=run.status();if(s.state!=='running')throw new Error('Unexpected terminal '+s.error);
      if(s.action){
        if(s.action.name==='request_approval'){observed=s;break;}
        if(s.action.name!=='show_plan')nativeReads++;
        run.respond(s.action.callId,native.action(s.action));
      }
      await new Promise(resolve=>setImmediate(resolve));
    }
    if(!observed||observed.action.payload.kind!=='recovery')throw new Error('No bounded recovery');
    results.push({version,flow,actorCallsBeforeRecoveryHITL:actorCalls,nativeReadsBeforeRecoveryHITL:nativeReads,code:observed.recovery.code,writes:observed.writes,prevented:observed.metrics.toolProgress?.prevented??0,automaticallyApproved:false});
  }finally{run.cancel();await run.promise;}
}
const report={evidence:'Scripted real Pi/Office-worker control flow, no live model or native Office',baselineCommit,results};
await writeFile(new URL('../verification/tool-progress-comparison.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
