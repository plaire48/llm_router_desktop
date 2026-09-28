// Keeps ONE model login alive for repeated evaluation runs. The credential
// stays in this process's memory: it is never written to disk, logged, or sent
// over the socket. Evaluation runs connect through relay-providers.mjs and can
// only ask for status and completions. Evaluation-only; not a product feature.
import {createServer} from 'node:net';
import {createInterface} from 'node:readline';
import {chmod,mkdir,rm,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir,userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {safeError} from '../../worker/connection-errors.mjs';
import {faultFacts} from '../../worker/fault-policy.mjs';

const posix=process.platform!=='win32';
const publicStatus=status=>({provider:status.provider,model:status.model,connected:status.connected===true,vision:status.vision===true,models:(status.models||[]).map(({id,label})=>({id,label}))});
const publicResult=result=>({content:result.content??'',calls:(result.calls||[]).map(call=>({id:call.id,type:call.type,function:{name:call.function?.name,arguments:call.function?.arguments}})),finishReason:result.finishReason,...(result.usage?{usage:result.usage}:{})});

export async function startRelayServer({providers,socketPath}){
  if(posix){
    const directory=dirname(socketPath);
    await mkdir(directory,{recursive:true,mode:0o700});
    // Any local process that can open the socket can spend the user's model quota.
    if((await stat(directory)).mode&0o077)throw new Error('socket_directory_not_private');
    await rm(socketPath,{force:true});
  }
  const sockets=new Set();
  const server=createServer(socket=>{
    const pending=new Map();sockets.add(socket);
    const send=value=>{if(!socket.destroyed)socket.write(JSON.stringify(value)+'\n');};
    const refuse=(id,code)=>send({id,ok:false,error:{code}});
    socket.on('error',()=>{});
    socket.on('close',()=>{sockets.delete(socket);for(const controller of pending.values())controller.abort();pending.clear();});
    createInterface({input:socket,crlfDelay:Infinity}).on('line',line=>{
      let request;try{request=JSON.parse(line);}catch{refuse(null,'invalid_request');return;}
      const id=typeof request?.id==='string'&&request.id.length<=100?request.id:null;
      if(!id){refuse(null,'invalid_request');return;}
      if(request.method==='status'){send({id,ok:true,result:publicStatus(providers.status())});return;}
      if(request.method==='cancel'){pending.get(request.target)?.abort();send({id,ok:true,result:{cancelled:true}});return;}
      if(request.method!=='complete'){refuse(id,'unknown_method');return;}
      if(!Array.isArray(request.messages)||!Array.isArray(request.tools)||pending.has(id)){refuse(id,'invalid_request');return;}
      const controller=new AbortController();pending.set(id,controller);
      Promise.resolve().then(()=>providers.complete(request.messages,request.tools,controller.signal,()=>{},()=>{}))
        .then(result=>send({id,ok:true,result:publicResult(result)}),error=>send({id,ok:false,error:{code:controller.signal.aborted?'cancelled':safeError(error),...faultFacts(error)}}))
        .finally(()=>pending.delete(id));
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  if(posix)await chmod(socketPath,0o600);
  return{async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));if(posix)await rm(socketPath,{force:true});}};
}

export const defaultSocketPath=()=>posix?join(tmpdir(),`nubi-office-eval-${userInfo().uid}`,'model.sock'):`\\\\.\\pipe\\nubi-office-eval-${userInfo().username}`;

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const option=name=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:undefined;};
  const provider=option('provider')||'chatgpt',model=option('model')||'gpt-5.6-luna',socketPath=option('socket')||defaultSocketPath();
  const {createProviders}=await import('../../worker/providers.mjs');
  const providers=createProviders();
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  if(!['chatgpt','aipro'].includes(provider)){console.error('이 세션은 브라우저 로그인 제공자(chatgpt, aipro)만 지원합니다.');process.exit(2);}
  console.log('브라우저에서 로그인해 주세요. 3분 안에 완료해야 합니다.');
  await providers.login(provider);
  while(providers.status().pending)await pause(200);
  if(!providers.status().connected){console.error('로그인을 완료하지 못했습니다: '+(providers.status().loginError||'no_credential'));providers.dispose();process.exit(1);}
  try{providers.model(model);}catch{console.error('이 계정의 모델 목록에 없는 모델입니다: '+model);providers.dispose();process.exit(1);}
  const server=await startRelayServer({providers,socketPath});
  const stop=async()=>{await server.close();providers.dispose();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  console.log('READY '+JSON.stringify({provider,model,socket:socketPath}));
}
