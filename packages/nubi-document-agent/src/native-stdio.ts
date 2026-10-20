import type { NativeReadTool, NativeWordConnection } from './native-word.js';
import { canonical, clone, DocumentAgentError, fail, validId } from './contracts.js';

export interface OfficeXReadWire {
  runId:string;
  send(message:{type:'tool';runId:string;id:string;name:NativeReadTool;input:Record<string,unknown>}):void;
  subscribe(receive:(message:unknown)=>void):()=>void;
}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Existing Office X tool/tool_result envelopes on a host-owned connection. No process or server is started. */
export function createOfficeXNativeReadCaller(wire:OfficeXReadWire):{call:NativeWordConnection['call'];close():void} {
  if(!wire||!validId(wire.runId)||typeof wire.send!=='function'||typeof wire.subscribe!=='function')fail('native_wire_invalid');
  const runId=wire.runId;
  let closed=false;
  const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;cleanup:()=>void}>();
  const unsubscribe=wire.subscribe(message=>{
    if(closed||!record(message)||message.type!=='tool_result'||message.runId!==runId||typeof message.id!=='string')return;
    const item=pending.get(message.id);if(!item)return;
    pending.delete(message.id);item.cleanup();
    try{
      if(!record(message.result)||canonical(message.result).length>240_000)fail('native_response_invalid');
      item.resolve(clone(message.result));
    }catch{item.reject(new DocumentAgentError('native_response_invalid'));}
  });
  return {
    async call(name,input,signal){
      if(closed)fail('native_connection_closed');
      if(signal.aborted)fail('operation_cancelled');
      if(!['inspect_office','inspect_office_members'].includes(name))fail('native_read_tool_required');
      if(!record(input)||canonical(input).length>200_000)fail('native_request_invalid');
      const id=crypto.randomUUID();
      return new Promise((resolve,reject)=>{
        const cancel=()=>{const item=pending.get(id);if(!item)return;pending.delete(id);item.cleanup();reject(new DocumentAgentError('operation_cancelled'));};
        const cleanup=()=>signal.removeEventListener('abort',cancel);
        pending.set(id,{resolve,reject,cleanup});signal.addEventListener('abort',cancel,{once:true});
        try{wire.send({type:'tool',runId,id,name,input:clone(input)});}
        catch{pending.delete(id);cleanup();reject(new DocumentAgentError('native_connection_closed'));}
      });
    },
    close(){
      if(closed)return;closed=true;unsubscribe();
      for(const item of pending.values()){item.cleanup();item.reject(new DocumentAgentError('native_connection_closed'));}
      pending.clear();
    }
  };
}
