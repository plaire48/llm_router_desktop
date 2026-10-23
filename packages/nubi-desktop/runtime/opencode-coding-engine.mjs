import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {StringDecoder} from 'node:string_decoder';
import release from './opencode-engine-release.json' with {type:'json'};
import {repairToolArguments} from '../../../extensions/aipro-chat/tool-argument-repair.js';
import {toolException} from '../../../extensions/aipro-chat/tool-errors.js';
import {toolArgumentIssues} from '../../../extensions/aipro-chat/tool-validation.js';

const checked=new Map(),metadata=new Set(['update_plan','select_tools','discover_capabilities']);
const prefix='nubi_',unprefix=name=>name?.startsWith(prefix)?name.slice(prefix.length):name;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const signature=(name,args)=>JSON.stringify([name,canonical(args)]);
const abortError=()=>Error('cancelled');
export const physicalEnginePath=value=>value.replace(/\.asar([\\/])/g,'.asar.unpacked$1');
export function validEngineAuthorization(header,token){
 const expected=Buffer.from('Bearer '+token),received=Buffer.from(typeof header==='string'?header:'');
 return received.length===expected.length&&timingSafeEqual(received,expected);
}
async function dependencies(entries,signal){
 if(!entries.length)return [];
 let timer,cancel;
 try{return await Promise.race([Promise.all(entries.map(entry=>entry.finished)),new Promise((resolve,reject)=>{cancel=()=>reject(abortError());signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>resolve([{error:'tool_dependency_unavailable'}]),30000);timer.unref();if(signal?.aborted)cancel();})]);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}

export async function openCodeBinary(){
 const target=process.platform+'-'+process.arch,asset=release.targets[target];if(!asset)throw Error('coding_engine_platform_unavailable');
 for(const root of [new URL('./opencode-engine/',import.meta.url),new URL('../generated/opencode-engine/',import.meta.url)]){
  const directory=physicalEnginePath(fileURLToPath(new URL(target+'/',root))),binary=path.join(directory,process.platform==='win32'?'opencode.exe':'opencode');
  let manifest,info;try{manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));info=await stat(binary);}catch{continue;}
  if(manifest.version!==release.version||manifest.commit!==release.commit||manifest.target!==target||manifest.archiveSha256!==asset.sha256)throw Error('coding_engine_binary_mismatch');
  const identity=[info.size,info.mtimeMs,info.ctimeMs,manifest.binarySha256].join(':');
  if(checked.get(binary)!==identity){if(createHash('sha256').update(await readFile(binary)).digest('hex')!==manifest.binarySha256)throw Error('coding_engine_binary_mismatch');checked.set(binary,identity);}
  return {binary,manifest};
 }
 throw Error('coding_engine_unavailable');
}

// Credentials stay in the host. OpenCode receives only a one-run loopback key,
// an isolated database/config and the tools admitted by this host invocation.
export function engineEnvironment(directory,config,source=process.env){
 const allowed=new Set(['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TMP','TEMP','TMPDIR','LANG','LC_ALL']);
 return {...Object.fromEntries(Object.entries(source).filter(([key])=>allowed.has(key))),
  XDG_CONFIG_HOME:path.join(directory,'config'),XDG_DATA_HOME:path.join(directory,'data'),XDG_STATE_HOME:path.join(directory,'state'),XDG_CACHE_HOME:path.join(directory,'cache'),
  OPENCODE_CONFIG_CONTENT:JSON.stringify(config),OPENCODE_DISABLE_PROJECT_CONFIG:'true',OPENCODE_DISABLE_CLAUDE_CODE:'true',OPENCODE_DISABLE_EXTERNAL_SKILLS:'true',OPENCODE_DISABLE_AUTOUPDATE:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',OPENCODE_PURE:'true',OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER:'true',NO_PROXY:'127.0.0.1,localhost,::1',no_proxy:'127.0.0.1,localhost,::1'};
}

export function decodeEngineMessages(messages,{seed,seedText,insertions=[],anchors}){
 const decoded=[];let foundSeed=false;
 for(let index=0;index<=messages.length;index++){
  for(const item of insertions.filter(item=>item.at===index))decoded.push(item.message);
  const message=messages[index];if(!message)continue;
  const content=Array.isArray(message.content)?message.content.filter(part=>part.type==='text').map(part=>part.text).join(''):message.content;
  if(message.role==='user'&&content===seedText){foundSeed=true;decoded.push(...structuredClone(seed));continue;}
  decoded.push({...message,...(message.tool_calls?{tool_calls:message.tool_calls.map(call=>({...call,function:{...call.function,name:unprefix(call.function.name)}}))}:{})});
 }
 // Native compaction may replace the old anchor. The latest literal input is
 // retained by the host even when the engine's own summary omits that anchor.
 for(const item of insertions.filter(item=>item.at>messages.length))decoded.push(item.message);
 if(foundSeed)return decoded;
 const users=seed.filter(message=>message.role==='user'),held=anchors||[users[0],users.at(-1)].filter(Boolean);
 const unique=held.filter((message,index)=>held.findIndex(other=>other.role===message.role&&other.content===message.content)===index);
 // The engine may replace its seed with a summary. Summaries cannot erase the
 // actual host policy or the literal original/latest request.
 return [...decoded.filter(message=>message.role==='system'),...seed.filter(message=>['system','developer'].includes(message.role)),...structuredClone(unique),...decoded.filter(message=>message.role!=='system')];
}

async function readJson(request){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>16*1024*1024)throw Error('coding_engine_request_limit');chunks.push(chunk);}return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}
const json=(response,status,value)=>response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(value));
function replyModel(response,request,result){
 const message={role:'assistant',content:result.content||'',...(result.calls?.length?{tool_calls:result.calls}:{})},finish=result.calls?.length?'tool_calls':'stop';
 const usage=result.usage||{prompt_tokens:0,completion_tokens:0,total_tokens:0},base={id:'nubi-'+randomUUID(),created:Math.floor(Date.now()/1000),model:request.model};
 if(!request.stream){json(response,200,{...base,object:'chat.completion',choices:[{index:0,message,finish_reason:finish}],usage});return;}
 response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
 const delta={content:message.content,...(message.tool_calls?{tool_calls:message.tool_calls.map((call,index)=>({index,...call}))}:{})};
 for(const [content,reason] of [[{role:'assistant'},null],[delta,null],[{},finish]])response.write('data: '+JSON.stringify({...base,object:'chat.completion.chunk',choices:[{index:0,delta:content,finish_reason:reason}],...(reason?{usage}:{})})+'\n\n');
 response.end('data: [DONE]\n\n');
}

/** Original OpenCode owns the coding turn/tool loop. Host execution owns every
 * source observation, command, proposal, approval and durable action receipt. */
export async function runOpenCodeAgent({messages,tools,modelId='host',model={},signal,complete,completeAnalysis,completeCompaction,onContextCompacted,requestAnchors,execute,prepareContext,takeInput,onStep=()=>{},onRound=()=>{},onDiagnostic=()=>{},onEngine=()=>{},onDelegated,createWikiSearch,researchHandoffs,onResearchHandoff,argumentRepairs={},repairArguments=false,readTools=new Set(),settleAnswer}){
 if(signal?.aborted)throw abortError();
 const {binary,manifest}=await openCodeBinary(),directory=await mkdtemp(path.join(os.tmpdir(),'nubi-opencode-run-'));
 const token=randomBytes(32).toString('hex'),seed=structuredClone(messages),seedText='NUBI_HOST_TRANSCRIPT_'+randomUUID()+'\n'+JSON.stringify(seed),insertions=[],pending=[],ledger=new Map();
 const definitions=new Map(tools.map(tool=>[tool.function.name,tool.function]));
 const issues=(name,args)=>toolArgumentIssues(definitions.get(name)?.parameters,args);
 let child,server,failure,answer,waiting=false,uncertain=false,index=0,sessionId,stdout='',settlements=0,requests=0,closed=false,startupTimer;
 const engine={id:'opencode',version:manifest.version,commit:manifest.commit};
 const cancelled=()=>signal?.aborted;
 const fail=error=>{failure ||=error;child?.kill();};
 const acceptInput=async anchor=>{const input=await takeInput?.();if(!input)return false;const content=input.text||input.content;if(typeof content!=='string'||!content.trim())return false;insertions.push({at:anchor,message:{role:'user',content}});return true;};
 const normalize=(name,args)=>{const definition=definitions.get(name);let value=repairArguments?repairToolArguments(definition?.parameters,args):args;return argumentRepairs[name]?.(value)??value;};
 const hostTool=async request=>{
  const name=request.params?.name,args=normalize(name,request.params?.arguments||{}),key=signature(name,args);
  if(!definitions.has(name))return {content:[{type:'text',text:JSON.stringify({ok:false,error:'tools_unavailable',actionIssued:false})}],isError:true};
  const entry=pending.find(item=>item.signature===key&&!item.taken);
  if(!entry)return {content:[{type:'text',text:JSON.stringify({ok:false,error:'tool_dispatch_unbound',actionIssued:false})}],isError:true};
  entry.taken=true;
  if(ledger.has(entry.id))return ledger.get(entry.id);
  const operation=(async()=>{
   const label=typeof args.progress==='string'?args.progress.slice(0,100):undefined,toolIndex=index++;
   onStep({index:toolIndex,tool:name,status:'running',...(label?{label}:{})});
   let result;
   try{
    if(cancelled())throw abortError();
    const prior=entry.prior.some(item=>item.invalid)?[{error:'tool_arguments_invalid'}]:await dependencies(entry.prior,signal);
    if(prior.some(item=>item?.error||item?.ok===false||item?.deferred))result={deferred:true,actionIssued:false,reason:'metadata_not_ready',instruction:'No operation was issued. Correct the preceding plan/tool-selection error before continuing.'};
    else if(await acceptInput(entry.anchor)||waiting||uncertain)result={deferred:true,actionIssued:false,reason:uncertain?'execution_unconfirmed':waiting?'awaiting_user':'user_input_pending',instruction:'No operation was issued. Read the latest user input, wait for its answer, or reconcile the uncertain operation.'};
    else if(issues(name,args)){result={ok:false,error:'tool_arguments_invalid',actionIssued:false,issues:issues(name,args)};}
    else {
     const {progress,...input}=args;
     if(name==='ask_openwiki'||name==='ask_documents'){
      const wiki=await import('../../../extensions/aipro-chat/openwiki-agent.js');
      try{const delegate=name==='ask_openwiki'?wiki.delegateWikiQuestion:(await import('../../../extensions/aipro-chat/document-agent.js')).delegateDocumentQuestion;result=await delegate(input,{complete:completeAnalysis||complete,execute,signal,modelId,onStep,researchHandoffs,onResearchHandoff,createWikiSearch});}
      catch(error){if(wiki.isWikiAuthenticationError(error)){fail(error);throw error;}throw error;}
     }else result=await execute(name,input);
     if(onDelegated&&['ask_openwiki','ask_documents'].includes(name))result=await onDelegated({tool:name,args:input,result})??result;
    }
   }catch(error){if(cancelled())throw abortError();if(failure===error)throw error;result=toolException(error,{mutating:!readTools.has(name)});}
   if(result===undefined||result===null)result={ok:false,error:'tool_result_missing',actionIssued:readTools.has(name)?false:null};
   if(!readTools.has(name)&&(['unknown','unconfirmed'].includes(result?.execution)||['unknown','unconfirmed'].includes(result?.recovery?.execution)||result?.actionIssued===null))uncertain=true;
   if(result?.requiresUserInput||result?.waitingForPeer||result?.cancelled)waiting=true;
   entry.outcome=result;
   onStep({index:toolIndex,tool:name,status:result?.error||result?.ok===false?'error':'done',...(label?{label}:{})});
   onDiagnostic({kind:'agent',phase:'tool_result',tool:name,error:result?.error||null});
   const image=result?.image;
   const textResult=image?Object.fromEntries(Object.entries(result).filter(([key])=>key!=='image')):result;
   const visual=model.vision===true&&image?.mimeType==='image/png'&&typeof image.data==='string'&&image.data.length<=6000000;
   return {content:[{type:'text',text:JSON.stringify(textResult)},...(visual?[{type:'image',mimeType:image.mimeType,data:image.data}]:[])],...(result?.error||result?.ok===false?{isError:true}:{})};
  })();operation.then(()=>entry.resolve(entry.outcome),()=>entry.resolve({error:'cancelled'}));ledger.set(entry.id,operation);return operation;
 };
 const provider=async request=>{
  if(request.model==='__nubi_title'){return {content:'Nubi coding task',calls:[]};}
  clearTimeout(startupTimer);
  if(cancelled())throw abortError();if(++requests>100)throw Error('coding_engine_round_limit');
  if(request.model==='__nubi_compaction'){
   const compactionIndex=index++;onStep({index:compactionIndex,tool:'compact_context',status:'running',label:'대화 문맥 정리'});
   try{
    const result=await (completeCompaction?completeCompaction(request.messages):complete(request.messages,[]));
    if(!result?.content?.trim()||result.calls?.length)throw Error('coding_engine_compaction_failed');
    await onContextCompacted?.();
    engine.nativeCompactions=(engine.nativeCompactions||0)+1;
    onStep({index:compactionIndex,tool:'compact_context',status:'done',label:'대화 문맥 정리'});return {...result,calls:[]};
   }catch(error){onStep({index:compactionIndex,tool:'compact_context',status:'error',label:'대화 문맥 정리'});throw error;}
  }
  if(uncertain){answer={content:'실행 결과가 미확정입니다. 같은 작업을 다시 실행하지 않았습니다. 기존 실행 기록과 현재 상태를 먼저 확인해야 합니다.',calls:[],uncertainAction:true};return answer;}
  if(waiting){answer={content:'',calls:[],awaitingUser:true};return answer;}
  const nativeMessages=request.messages||[];await acceptInput(nativeMessages.length);
  let wire=decodeEngineMessages(nativeMessages,{seed,seedText,insertions,anchors:requestAnchors});
  const offered=(request.tools||[]).map(tool=>({...tool,function:{...tool.function,name:unprefix(tool.function.name)}})).filter(tool=>definitions.has(tool.function.name));
  const admitted=offered.map(tool=>({type:'function',function:definitions.get(tool.function.name)}));
  if(prepareContext)wire=await prepareContext(wire,admitted);
  let result,settled=false;
  for(let revision=0;revision<8;revision++){
   result=await complete(wire,admitted);if(cancelled())throw abortError();
   if(await acceptInput(nativeMessages.length)){wire=[...wire,insertions.at(-1).message];continue;}
   if(result.interruptedByUser){wire=[...wire,{role:'user',content:'The model request was interrupted before tool execution. Continue from current host receipts and the latest user instruction.'}];continue;}
   if(!result.calls?.length&&settleAnswer){const verdict=await settleAnswer();if(verdict?.status==='revise'&&settlements++<2){const message={role:'user',content:verdict.feedback};insertions.push({at:nativeMessages.length,message});wire=[...wire,message];continue;}}
   settled=true;break;
  }
  if(!result||!settled)throw Error('coding_engine_input_unsettled');
  // A question wins its speculative batch. Otherwise only independent reads
  // may run together; plan metadata may precede one other host operation.
  let calls=result.calls||[];const question=calls.find(call=>call.function.name==='ask_user');
  if(question)calls=[question];else if(!calls.every(call=>readTools.has(call.function.name))){let operation=false;calls=calls.filter(call=>{if(metadata.has(call.function.name))return !operation;if(operation)return false;operation=true;return true;});}else calls=calls.slice(0,2);
  const usedIds=new Set();calls=calls.filter(call=>{if(usedIds.has(call.id))return false;usedIds.add(call.id);return true;});
  const prior=[];
  for(const call of calls){
   let args;try{args=normalize(call.function.name,JSON.parse(call.function.arguments||'{}'));}catch{args={};}
   if(!definitions.has(call.function.name))continue;
   // Provider call IDs are scoped to one model response and can repeat later.
   // A fresh admission must never reuse a previous operation's result.
   const entry={id:randomUUID(),signature:signature(call.function.name,args),anchor:nativeMessages.length+1,prior:[...prior],invalid:!!issues(call.function.name,args)};
   entry.finished=new Promise(resolve=>entry.resolve=resolve);pending.push(entry);if(metadata.has(call.function.name))prior.push(entry);
   call.function={...call.function,arguments:JSON.stringify(args)};
  }
  onRound();answer={...result,calls:calls.length?calls:[]};
  return {...answer,calls:calls.map(call=>({...call,function:{...call.function,name:prefix+call.function.name}}))};
 };
 const closeOnAbort=()=>fail(abortError());
 try{
  server=createServer(async(request,response)=>{
   if(request.headers.origin||!validEngineAuthorization(request.headers.authorization,token)){response.writeHead(403).end();return;}
   try{
    if(cancelled())throw abortError();
    const body=await readJson(request);
    if(request.url==='/mcp'){
     if(request.method!=='POST'){response.writeHead(405).end();return;}
     if(body.id===undefined){response.writeHead(202).end();return;}
     let result;
     if(body.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'nubi-host',version:'1'}};
     else if(body.method==='tools/list')result={tools:[...definitions.values()].map(definition=>({name:definition.name,description:definition.description,inputSchema:definition.parameters}))};
     else if(body.method==='tools/call')result=await hostTool(body);
     else {json(response,200,{jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not available'}});return;}
     json(response,200,{jsonrpc:'2.0',id:body.id,result});return;
    }
    if(request.url==='/v1/chat/completions'&&request.method==='POST'){replyModel(response,body,await provider(body));return;}
    response.writeHead(404).end();
   }catch(error){json(response,500,{error:{message:cancelled()?'cancelled':'host_request_failed',type:'host_error'}});fail(error);}
  });server.requestTimeout=0;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port,context=Math.max(16000,model.contextLength||model.contextWindow||128000);
  const config={autoupdate:false,share:'disabled',enabled_providers:['nubi'],provider:{nubi:{npm:'@ai-sdk/openai-compatible',name:'Nubi host model',options:{baseURL:base+'/v1',apiKey:token},models:{host:{id:modelId,name:modelId,attachment:model.vision===true,modalities:{input:model.vision===true?['text','image']:['text'],output:['text']},limit:{context,output:Math.min(16000,Math.floor(context/4))}},__nubi_title:{name:'Local title',limit:{context:32000,output:256}},__nubi_compaction:{name:'Host compaction',limit:{context,output:Math.min(8000,Math.floor(context/4))}}}}},
   mcp:{nubi:{type:'remote',url:base+'/mcp',headers:{Authorization:'Bearer '+token},oauth:false,timeout:120000}},agent:{nubi:{mode:'primary',tools:{'*':false,'nubi_*':true},permission:{'*':'deny','nubi_*':'allow'}},title:{model:'nubi/__nubi_title'},compaction:{model:'nubi/__nubi_compaction'},summary:{disable:true}}};
  onEngine({...engine,state:'starting'});
  child=spawn(binary,['run','--pure','--format','json','--model','nubi/host','--agent','nubi'],{cwd:directory,env:engineEnvironment(directory,config),shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  signal?.addEventListener('abort',closeOnAbort,{once:true});if(cancelled())closeOnAbort();
  const consume=line=>{let event;try{event=JSON.parse(line);}catch{fail(Error('coding_engine_protocol'));return;}if(event.sessionID&&!sessionId){sessionId=event.sessionID;onEngine({...engine,sessionId,state:'running'});}if(event.type==='error')fail(Error('coding_engine_failed'));};
  const decoder=new StringDecoder('utf8');child.stdout.on('data',chunk=>{stdout+=decoder.write(chunk);if(stdout.length>16*1024*1024){fail(Error('coding_engine_protocol'));return;}let newline;while((newline=stdout.indexOf('\n'))>=0){const line=stdout.slice(0,newline);stdout=stdout.slice(newline+1);if(line.trim())consume(line);}});
  child.stderr.on('data',()=>{});
  startupTimer=setTimeout(()=>fail(Error('coding_engine_start_timeout')),30000);startupTimer.unref();
  child.stdin.on('error',()=>{});child.stdin.end(seedText);
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{closed=true;resolve(code);});});
  if(cancelled())throw abortError();if(failure)throw failure;if(exit!==0||!answer||answer.calls?.length||stdout.trim())throw Error('coding_engine_failed');
  onEngine({...engine,sessionId,state:'completed'});return {...answer,calls:null,engine:{...engine,sessionId}};
 }finally{
  signal?.removeEventListener('abort',closeOnAbort);
  clearTimeout(startupTimer);
  if(child&&!closed){child.kill();await Promise.race([new Promise(resolve=>child.once('close',resolve)),new Promise(resolve=>setTimeout(()=>{if(!closed)child.kill('SIGKILL');resolve();},2000).unref())]);}
  server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));
  await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
