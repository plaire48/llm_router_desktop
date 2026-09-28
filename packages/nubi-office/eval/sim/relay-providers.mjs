// The providers object an evaluation run uses. It holds no credential: every
// completion is requested from the model session over its private socket.
import {createConnection} from 'node:net';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';

export async function connectRelayProviders({socketPath}){
  const socket=createConnection(socketPath),pending=new Map();let closed=false;
  // A lost session must stop the run; a retryable code would loop on a dead socket.
  const lost=()=>{if(closed)return;closed=true;for(const {reject} of pending.values())reject(new Error('worker_disconnected'));pending.clear();};
  socket.on('error',lost);socket.on('close',lost);
  createInterface({input:socket,crlfDelay:Infinity}).on('line',line=>{
    let reply;try{reply=JSON.parse(line);}catch{return;}
    const waiting=pending.get(reply.id);if(!waiting)return;
    pending.delete(reply.id);
    if(reply.ok)waiting.resolve(reply.result);
    else{const {code,...facts}=reply.error||{};waiting.reject(Object.assign(new Error(code||'request_failed'),facts));}
  });
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',()=>reject(new Error('worker_disconnected')));});
  const request=(id,method,body={})=>new Promise((resolve,reject)=>{
    if(closed){reject(new Error('worker_disconnected'));return;}
    pending.set(id,{resolve,reject});
    socket.write(JSON.stringify({id,method,...body})+'\n');
  });
  const status=await request(randomUUID(),'status');
  return{
    status:()=>structuredClone(status),
    complete(messages,tools=[],signal){
      if(signal?.aborted)return Promise.reject(new Error('cancelled'));
      const id=randomUUID(),result=request(id,'complete',{messages,tools});
      const abort=()=>{
        const waiting=pending.get(id);if(!waiting)return;
        pending.delete(id);waiting.reject(new Error('cancelled'));
        if(!closed)socket.write(JSON.stringify({id:randomUUID(),method:'cancel',target:id})+'\n');
      };
      signal?.addEventListener('abort',abort,{once:true});
      return result.finally(()=>signal?.removeEventListener('abort',abort));
    },
    dispose(){closed=true;pending.clear();socket.destroy();}
  };
}
