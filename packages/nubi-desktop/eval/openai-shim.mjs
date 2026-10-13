// A loopback OpenAI-compatible HTTP server over the evaluation relay (user decision 2026-10-14): external tools
// such as OpenWiki LEDGER, DeepEval or Mem0 OSS call POST /v1/chat/completions with a bearer token, and the request
// becomes providers.complete through whatever provider the logged-in model session uses. Loopback only, one random
// token per start, no streaming beyond a single final chunk, no embeddings.
//
// Usage: node eval/openai-shim.mjs --socket <relay socket> [--port 4397]
//   Prints OPENAI_BASE_URL and OPENAI_API_KEY for the tool's environment.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {connectRelayProviders} from './relay.mjs';

const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
export function openAIChatToMessages(body){
  if(!body||!Array.isArray(body.messages)||!body.messages.length)throw Object.assign(new Error('messages required'),{status:400});
  const messages=body.messages.map(message=>{
    if(!['system','user','assistant','tool','developer'].includes(message?.role))throw Object.assign(new Error('unsupported role'),{status:400});
    const content=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(part=>part?.type==='text'?part.text:'').join('\n'):'';
    return {role:message.role==='developer'?'system':message.role,content,...(message.tool_call_id?{tool_call_id:message.tool_call_id}:{}),...(message.name?{name:message.name}:{}),...(Array.isArray(message.tool_calls)?{tool_calls:message.tool_calls}:{})};
  });
  const tools=Array.isArray(body.tools)?body.tools.filter(tool=>tool?.type==='function'&&tool.function?.name):[];
  const options={...(body.tool_choice==='required'?{toolChoice:'required'}:{}),...(body.response_format?.type==='json_object'||body.response_format?.type==='json_schema'?{responseFormat:{type:'json_object'}}:{}),...(Number.isInteger(body.max_tokens)?{maxTokens:body.max_tokens}:{})};
  return {messages,tools,options};
}
export function completionToOpenAI(result,model,id=randomBytes(8).toString('hex')){
  const calls=(result.calls||[]).map(call=>({id:call.id,type:'function',function:{name:call.function.name,arguments:call.function.arguments}}));
  const message={role:'assistant',content:result.content||(calls.length?null:''),...(calls.length?{tool_calls:calls}:{})};
  const usage=result.usage||{};
  return {id:'chatcmpl-'+id,object:'chat.completion',created:Math.floor(Date.now()/1000),model,choices:[{index:0,message,finish_reason:calls.length?'tool_calls':result.finishReason==='length'?'length':'stop'}],usage:{prompt_tokens:usage.prompt_tokens||0,completion_tokens:usage.completion_tokens||0,total_tokens:usage.total_tokens||0}};
}
export async function startOpenAIShim({providers,port=4397,token=randomBytes(24).toString('base64url')}){
  const status=providers.status(),model=status.model||'nubi';
  const server=createServer(async(request,response)=>{
    const send=(code,value)=>{response.writeHead(code,{'content-type':'application/json'});response.end(JSON.stringify(value));};
    try{
      if(request.headers.authorization!=='Bearer '+token){send(401,{error:{message:'invalid token',type:'invalid_request_error'}});return;}
      const url=new URL(request.url,'http://127.0.0.1');
      if(request.method==='GET'&&/^\/v1\/models\/?$/.test(url.pathname)){send(200,{object:'list',data:[{id:model,object:'model',owned_by:status.provider||'nubi'}]});return;}
      if(request.method!=='POST'||!/^\/v1\/chat\/completions\/?$/.test(url.pathname)){send(404,{error:{message:'only /v1/chat/completions and /v1/models exist',type:'invalid_request_error'}});return;}
      let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>8*1024*1024){send(413,{error:{message:'request too large',type:'invalid_request_error'}});return;}}
      let body;try{body=JSON.parse(raw);}catch{send(400,{error:{message:'invalid JSON',type:'invalid_request_error'}});return;}
      const {messages,tools,options}=openAIChatToMessages(body);
      const controller=new AbortController();request.on('close',()=>controller.abort());
      const result=await providers.complete(messages,tools,controller.signal,()=>{},()=>{},()=>{},options);
      const reply=completionToOpenAI(result,body.model||model);
      if(body.stream===true){
        response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
        const choice=reply.choices[0];
        response.write('data: '+JSON.stringify({...reply,object:'chat.completion.chunk',choices:[{index:0,delta:choice.message,finish_reason:choice.finish_reason}]})+'\n\n');
        response.write('data: [DONE]\n\n');response.end();return;
      }
      send(200,reply);
    }catch(error){
      const status=error?.status||(error?.message==='cancelled'?499:502);
      if(!response.headersSent)send(status,{error:{message:String(error?.message||'request_failed'),type:status===400?'invalid_request_error':'server_error'}});
      else response.end();
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const address=server.address();
  return {baseUrl:`http://127.0.0.1:${address.port}/v1`,token,model,close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())){
  const socketPath=option('socket');
  if(!socketPath){console.error('사용법: node eval/openai-shim.mjs --socket <릴레이 소켓> [--port 4397]');process.exit(2);}
  const providers=await connectRelayProviders({socketPath});
  const shim=await startOpenAIShim({providers,port:Number(option('port')||4397)});
  console.log(`OPENAI_BASE_URL=${shim.baseUrl}`);console.log(`OPENAI_API_KEY=${shim.token}`);console.log(`모델 ${shim.model}. 이 창을 닫으면 멈춥니다.`);
  process.on('SIGINT',()=>{shim.close().then(()=>process.exit(0));});
}
