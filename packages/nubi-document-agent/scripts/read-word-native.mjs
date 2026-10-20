import {createHash} from 'node:crypto';
import {createNativeWordReadPort,createOfficeXNativeReadCaller,DocumentAgentError} from '../dist/index.js';

let buffer='',started=false,finished=false,runId='unbound',caller,receive;
const control=new AbortController();
function finish(result){
  if(finished)return;finished=true;caller?.close();process.stdin.pause();
  // The parent receives metadata/digests only. Body and font names stay in process memory.
  process.stdout.write(JSON.stringify({type:'word_read_result',runId,result})+'\n',()=>process.exit(result.status==='read'?0:1));
}
function fail(error){finish({status:'failed',error:error instanceof DocumentAgentError?error.code:'native_reader_failed',documentWritesDispatched:0});}
async function read(start){
  if(!start||start.type!=='word_read_start'||typeof start.runId!=='string'||!['fixture','windows-office'].includes(start.environment))throw new DocumentAgentError('native_start_invalid');
  runId=start.runId;
  caller=createOfficeXNativeReadCaller({runId,send:message=>process.stdout.write(JSON.stringify(message)+'\n'),subscribe:fn=>{receive=fn;return()=>{receive=undefined;};}});
  let acquired=false,released=false;
  const metadata=start.connection,connection={...metadata,call:caller.call};
  const reader=createNativeWordReadPort({environment:start.environment,
    async acquire(scope,targetRef,signal){
      if(acquired||signal.aborted||scope.projectId!==metadata?.scope?.projectId||scope.taskId!==metadata?.scope?.taskId||targetRef!==metadata?.targetRef)throw new DocumentAgentError('native_connection_invalid');
      acquired=true;return connection;
    },
    async release(resource){if(resource!==connection)throw new DocumentAgentError('native_lease_invalid');released=true;}
  });
  const scope=metadata?.scope;
  const binding=await reader.acquire(scope,metadata?.targetRef,control.signal),context={...binding,scope};
  let summary;
  try{
    const snapshot=await reader.read(context,control.signal);
    const text=snapshot.blocks.map(block=>block.runs.map(run=>run.text).join('')+String(block.style.paragraphTerminator??'')).join('');
    summary={status:'read',environment:start.environment,revision:snapshot.binding.revision,
      textSha256:createHash('sha256').update(text).digest('hex'),characters:text.length,paragraphs:snapshot.blocks.length,
      formatRuns:snapshot.blocks.reduce((sum,block)=>sum+block.runs.length,0),evidence:reader.evidence(context),documentWritesDispatched:0};
  }finally{await reader.release(context);}
  finish({...summary,leaseReleased:released});
}
function accept(line){
  if(finished)return;
  try{
    if(line.length>300_000)throw new DocumentAgentError('native_frame_invalid');
    const message=JSON.parse(line);
    if(!started){started=true;void read(message).catch(fail);}
    else receive?.(message);
  }catch{fail(new DocumentAgentError('native_frame_invalid'));}
}
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  buffer+=chunk;
  while(!finished&&buffer.includes('\n')){const stop=buffer.indexOf('\n'),line=buffer.slice(0,stop);buffer=buffer.slice(stop+1);accept(line);}
  if(buffer.length>300_000)fail(new DocumentAgentError('native_frame_invalid'));
});
process.stdin.on('end',()=>{caller?.close();if(!started)fail(new DocumentAgentError('native_connection_closed'));});
process.stdin.on('error',()=>fail(new DocumentAgentError('native_connection_closed')));
process.stdout.on('error',()=>{caller?.close();process.exit(1);});
process.on('SIGTERM',()=>{control.abort();caller?.close();fail(new DocumentAgentError('operation_cancelled'));});
