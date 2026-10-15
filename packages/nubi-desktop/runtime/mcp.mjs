// MCP servers (user request 2026-10-14): stdio (a local command) and Streamable HTTP (a company server). Servers are
// registered in the app-level file mcp-servers.json; secrets (environment values, HTTP headers) live in the
// connection vault, never in that file. Connected servers' tools are offered to the agent as mcp__<server>__<tool>.
// Read-only tools (readOnlyHint) run freely; any other tool asks the user first, as a command does, and an "always
// allow" answer is remembered per server and tool in the approval policy.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {fail} from './files.mjs';
export const MCP_SECRET_PREFIX='mcp:';
export const MCP_LIMITS=Object.freeze({servers:16,toolsPerServer:64,resultChars:24000,callTimeoutMs:60000,connectTimeoutMs:20000,argsChars:20000});
const ID=/^[a-z][a-z0-9-]{1,39}$/,TOOL=/^[A-Za-z0-9_.-]{1,64}$/;
export const mcpToolName=(serverId,tool)=>`mcp__${serverId}__${tool}`.replace(/[^A-Za-z0-9_-]/g,'_');
export function parseMcpToolName(name){const match=/^mcp__([a-z][a-z0-9-]{1,39})__(.+)$/.exec(String(name||''));return match?{serverId:match[1],tool:match[2]}:null;}
function normalizeServer(input={},existing=null){
  const id=typeof input.id==='string'&&ID.test(input.id)?input.id:existing?.id;
  if(!id)fail('mcp_server_invalid');
  const transport=input.transport==='builtin'&&id==='playwright'?'builtin':input.transport==='http'?'http':input.transport==='stdio'?'stdio':existing?.transport;
  const name=String(input.name??existing?.name??id).trim().slice(0,60)||id;
  const row={id,name,transport,enabled:input.enabled===undefined?existing?.enabled!==false:input.enabled!==false,addedAt:existing?.addedAt||new Date().toISOString()};
  if(transport==='builtin'){return {...row,name:'Playwright',version:'0.0.83'};}
  if(transport==='stdio'){
    const command=String(input.command??existing?.command??'').trim();
    if(!command||command.length>500||/[\r\n]/.test(command))fail('mcp_server_invalid');
    const args=Array.isArray(input.args)?input.args:Array.isArray(existing?.args)?existing.args:[];
    if(args.length>32||args.some(item=>typeof item!=='string'||item.length>500))fail('mcp_server_invalid');
    const cwd=input.cwd===undefined?existing?.cwd||null:(typeof input.cwd==='string'&&input.cwd.trim()?input.cwd.trim().slice(0,500):null);
    const envKeys=Array.isArray(input.envKeys)?input.envKeys:Array.isArray(existing?.envKeys)?existing.envKeys:[];
    if(envKeys.length>16||envKeys.some(key=>!/^[A-Z][A-Z0-9_]{0,63}$/.test(key)))fail('mcp_server_invalid');
    Object.assign(row,{command,args,cwd,envKeys});
  }else if(transport==='http'){
    let url;try{url=new URL(String(input.url??existing?.url??''));}catch{fail('mcp_server_invalid');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('mcp_server_invalid');
    const headerKeys=Array.isArray(input.headerKeys)?input.headerKeys:Array.isArray(existing?.headerKeys)?existing.headerKeys:[];
    if(headerKeys.length>16||headerKeys.some(key=>!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(key)))fail('mcp_server_invalid');
    Object.assign(row,{url:url.toString(),headerKeys});
  }else fail('mcp_server_invalid');
  return row;
}
const toolInfo=tool=>{const schema=tool.inputSchema&&typeof tool.inputSchema==='object'?tool.inputSchema:{};const required=new Set(Array.isArray(schema.required)?schema.required:[]);return {name:tool.name,title:typeof tool.title==='string'?tool.title.slice(0,120):undefined,description:String(tool.description||'').slice(0,600),readOnly:tool.annotations?.readOnlyHint===true,params:Object.entries(schema.properties||{}).slice(0,16).map(([key,value])=>({name:key,type:typeof value?.type==='string'?value.type:Array.isArray(value?.type)?value.type.join('|'):'',required:required.has(key),description:String(value?.description||'').slice(0,200)}))};};
const clip=(text,limit)=>{const value=String(text??'');return value.length>limit?value.slice(0,limit)+`\n…[${value.length-limit}자 생략]`:value;};
// Structured content past the bound is dropped rather than parsed from a cut-off string.
const structuredPart=value=>{if(!value||typeof value!=='object')return undefined;const text=JSON.stringify(value);if(text.length>MCP_LIMITS.resultChars)return undefined;try{return JSON.parse(text);}catch{return undefined;}};
// Tool results are text for the model: text parts joined, other parts described, the whole bounded.
export function describeToolResult(result){
  const parts=Array.isArray(result?.content)?result.content:[];
  const text=parts.map(part=>part?.type==='text'?String(part.text??''):part?.type==='image'?`[이미지 ${part.mimeType||''}]`:part?.type==='resource'?`[리소스 ${part.resource?.uri||''}]\n${String(part.resource?.text??'')}`:`[${part?.type||'content'}]`).join('\n').trim();
  return {ok:result?.isError!==true,text:clip(text,MCP_LIMITS.resultChars),structured:structuredPart(result?.structuredContent)};
}
export class McpRegistry{
  // file: the app-level server list. secrets: the connection vault client ({get,set,delete}) or null. loadSdk: injectable
  // for tests. log: host logger.
  constructor({file,secrets=null,loadSdk=defaultSdk,log=()=>{},playwright=null}){
    this.playwright=playwright;this.file=file;this.secrets=secrets;this.loadSdk=loadSdk;this.log=log;this.servers=null;this.connections=new Map();this.saving=Promise.resolve();
  }
  async load(){
    if(this.servers)return this.servers;
    return this.loading ||= this.loadOnce();
  }
  async loadOnce(){
    try{const value=JSON.parse(await readFile(this.file,'utf8'));this.servers=Array.isArray(value?.servers)?value.servers.map(row=>{try{return normalizeServer(row);}catch{return null;}}).filter(Boolean):[];}
    catch(error){if(error.code!=='ENOENT')this.log('mcp_registry_unreadable',error.message);this.servers=[];}
    if(this.playwright&&!this.servers.some(row=>row.id==='playwright')){this.servers.unshift(normalizeServer({id:'playwright',transport:'builtin',enabled:true}));await this.persist();}
    return this.servers;
  }
  async persist(){
    const servers=this.servers||[];
    this.saving=this.saving.then(async()=>{await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});const temporary=this.file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify({version:1,servers},null,2),{mode:0o600,flag:'wx'});await rename(temporary,this.file);}).catch(error=>{this.log('mcp_registry_write_failed',error.message);throw error;});
    return this.saving;
  }
  async list(){
    const servers=await this.load();
    return servers.map(row=>{const connection=this.connections.get(row.id);return {...row,state:connection?.state||'disconnected',error:connection?.error||null,tools:(connection?.tools||[]).map(toolInfo)};});
  }
  // Secrets (env values, headers) come in with the save call and go to the vault; the file keeps only their names.
  async save(input){
    const servers=await this.load();
    const existing=servers.find(row=>row.id===input?.id)||null;
    const row=normalizeServer(input,existing);
    if(existing?.transport==='builtin'&&input.transport&&input.transport!=='builtin')fail('mcp_server_invalid');
    if(!existing&&servers.length>=MCP_LIMITS.servers)fail('mcp_server_limit');
    const secretValues=input?.secrets&&typeof input.secrets==='object'&&!Array.isArray(input.secrets)?input.secrets:null;
    if(secretValues){
      if(!this.secrets)fail('secret_unavailable');
      const allowed=new Set(row.transport==='stdio'?row.envKeys:row.headerKeys);
      const entries=Object.entries(secretValues).filter(([key,value])=>allowed.has(key)&&typeof value==='string');
      const current=await this.readSecrets(row.id);
      for(const [key,value] of entries){if(value)current[key]=value.slice(0,4000);else delete current[key];}
      await this.secrets.set(MCP_SECRET_PREFIX+row.id,JSON.stringify(current));
    }
    if(existing)Object.assign(existing,row);else servers.push(row);
    await this.persist();
    if(this.connections.has(row.id))await this.disconnect(row.id);
    return (await this.list()).find(item=>item.id===row.id);
  }
  async remove({id}){
    const servers=await this.load();const index=servers.findIndex(row=>row.id===id);
    if(index<0)fail('mcp_server_missing');
    await this.disconnect(id);if(servers[index].transport==='builtin')servers[index].enabled=false;else servers.splice(index,1);await this.persist();
    if(this.secrets)await this.secrets.delete(MCP_SECRET_PREFIX+id).catch(()=>{});
    return {removed:id};
  }
  async readSecrets(id){
    if(!this.secrets)return {};
    try{const raw=await this.secrets.get(MCP_SECRET_PREFIX+id);const value=raw?JSON.parse(raw):{};return value&&typeof value==='object'?value:{};}catch{return {};}
  }
  async connect(id){
    const servers=await this.load();const row=servers.find(item=>item.id===id);
    if(!row)fail('mcp_server_missing');
    const current=this.connections.get(id);
    if(current?.state==='connected')return this.describe(row);
    if(current?.state==='connecting')return current.promise;
    const entry={state:'connecting',error:null,tools:[],client:null,transport:null,promise:null};this.connections.set(id,entry);
    entry.promise=(async()=>{
      try{
        if(row.transport==='builtin'){
          if(!this.playwright)fail('mcp_desktop_only');
          const client=await this.playwright();entry.client=client;const listed=await client.listTools();
          if(this.connections.get(id)!==entry){await client.close();fail('mcp_disconnected');}
          Object.assign(entry,{state:'connected',tools:listed.tools,error:null});return this.describe(row);
        }
        const sdk=await this.loadSdk();
        const secrets=await this.readSecrets(id);
        let transport;
        if(row.transport==='stdio'){
          const env={...process.env};for(const key of row.envKeys)if(secrets[key])env[key]=secrets[key];
          transport=new sdk.StdioClientTransport({command:row.command,args:row.args,env,...(row.cwd?{cwd:row.cwd}:{}),stderr:'pipe'});
          transport.stderr?.on?.('data',chunk=>this.log('mcp_server_stderr',id,String(chunk).slice(0,500)));
        }else{
          const headers={};for(const key of row.headerKeys)if(secrets[key])headers[key]=secrets[key];
          transport=new sdk.StreamableHTTPClientTransport(new URL(row.url),{requestInit:{headers}});
        }
        const client=new sdk.Client({name:'nubi-workspace',version:'1.2.1'},{capabilities:{}});
        entry.client=client;entry.transport=transport;
        client.onclose=()=>{if(this.connections.get(id)===entry){entry.state='disconnected';entry.client=null;}};
        await withTimeout(client.connect(transport),MCP_LIMITS.connectTimeoutMs,'mcp_connect_timeout');
        const listed=await withTimeout(client.listTools(),MCP_LIMITS.connectTimeoutMs,'mcp_connect_timeout');
        if(this.connections.get(id)!==entry){await client.close();fail('mcp_disconnected');}
        const tools=(listed?.tools||[]).filter(tool=>TOOL.test(tool.name)).slice(0,MCP_LIMITS.toolsPerServer);
        Object.assign(entry,{state:'connected',client,transport,tools,error:null});
        return this.describe(row);
      }catch(error){
        const message=/^[a-z_]+$/.test(error?.message||'')?error.message:'mcp_connect_failed';
        try{await entry.client?.close?.();await entry.transport?.close?.();}catch{}
        Object.assign(entry,{state:'failed',error:message,client:null,tools:[]});this.log('mcp_connect_failed',id,String(error?.message||error).slice(0,300));
        try{await entry.transport?.close?.();}catch{}
        fail(message);
      }finally{entry.promise=null;}
    })();
    return entry.promise;
  }
  describe(row){const connection=this.connections.get(row.id);return {id:row.id,name:row.name,transport:row.transport,state:connection?.state||'disconnected',error:connection?.error||null,tools:(connection?.tools||[]).map(toolInfo)};}
  async disconnect(id){
    const entry=this.connections.get(id);if(!entry)return {id,state:'disconnected'};
    this.connections.delete(id);
    try{await entry.client?.close?.();}catch{}try{await entry.transport?.close?.();}catch{}
    return {id,state:'disconnected'};
  }
  async connectEnabled(){
    const servers=await this.load();
    await Promise.allSettled(servers.filter(row=>row.enabled).map(row=>this.connect(row.id).catch(()=>null)));
    return this.list();
  }
  // Tool definitions for the agent, in the OpenAI function shape the runtime uses.
  definitions(){
    const out=[];
    for(const [id,entry] of this.connections){
      if(entry.state!=='connected')continue;
      const row=(this.servers||[]).find(item=>item.id===id);
      for(const tool of entry.tools){
        const schema=tool.inputSchema&&typeof tool.inputSchema==='object'?tool.inputSchema:{type:'object',properties:{}};
        out.push({type:'function',function:{name:mcpToolName(id,tool.name),description:`[MCP ${row?.name||id}] ${String(tool.description||tool.name).slice(0,600)}${tool.annotations?.readOnlyHint===true?' (읽기 전용)':' (실행 전 사용자 승인 필요)'}`,parameters:{type:'object',...schema,properties:schema.properties||{}}}});
      }
    }
    return out;
  }
  tool(name){
    const parsed=parseMcpToolName(name);if(!parsed)return null;
    const entry=this.connections.get(parsed.serverId);if(entry?.state!=='connected')return null;
    const tool=entry.tools.find(item=>mcpToolName(parsed.serverId,item.name)===name);
    return tool?{serverId:parsed.serverId,tool,readOnly:tool.annotations?.readOnlyHint===true}:null;
  }
  fingerprint(name,args){const canonical=JSON.stringify(args??{},(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);return createHash('sha256').update(name+'\n'+canonical).digest('hex').slice(0,24);}
  async call(name,args={},{signal}={}){
    const found=this.tool(name);if(!found)fail('mcp_tool_unavailable');
    const text=JSON.stringify(args??{});if(text.length>MCP_LIMITS.argsChars)fail('mcp_arguments_too_large');
    const entry=this.connections.get(found.serverId);
    const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const result=await withTimeout(entry.client.callTool({name:found.tool.name,arguments:args??{}},undefined,{signal:combined}),MCP_LIMITS.callTimeoutMs,'mcp_call_timeout',()=>controller.abort());
    const described=describeToolResult(result);
    if(found.serverId==='playwright'&&found.tool.name==='browser_capture'){const image=result.content?.find(part=>part.type==='image'&&part.mimeType==='image/png');if(image&&typeof image.data==='string'&&image.data.length<=8*1024*1024)described.capture={...result.structuredContent,image:image.data};}
    return described;
  }
  async dispose(){for(const id of [...this.connections.keys()])await this.disconnect(id);}
}
function withTimeout(promise,ms,code,onTimeout=()=>{}){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Object.assign(Error(code),{code}));onTimeout();},ms);})]).finally(()=>clearTimeout(timer));}
async function defaultSdk(){
  const [{Client},{StdioClientTransport},{StreamableHTTPClientTransport}]=await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/client/stdio.js'),import('@modelcontextprotocol/sdk/client/streamableHttp.js')]);
  return {Client,StdioClientTransport,StreamableHTTPClientTransport};
}
// Service methods: one RPC ('mcp') with actions, plus the agent-facing helpers.
const shared=new Map();
export function installMcp(ProjectService){
  ProjectService.prototype.mcpRegistry=function(){
    const file=path.join(this.storageRoot,'mcp-servers.json');
    if(!shared.has(file))shared.set(file,new McpRegistry({file,secrets:this.connectionVault||null,playwright:this.playwrightRequest?async()=>{const {createInAppPlaywright}=await import('./playwright-mcp.mjs');return createInAppPlaywright(this.playwrightRequest);}:null,log:(...args)=>this.log?.(...args)}));
    const registry=shared.get(file);if(!registry.secrets&&this.connectionVault)registry.secrets=this.connectionVault;
    this.mcpInstance=registry;return registry;
  };
  ProjectService.prototype.mcpDefinitions=async function(){
    const registry=this.mcpRegistry();
    registry.warming ||= registry.connectEnabled().catch(()=>{});
    let timer;await Promise.race([registry.warming,new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);clearTimeout(timer);
    return registry.definitions();
  };
  ProjectService.prototype.mcp=async function(args={}){
    const registry=this.mcpRegistry();const {action='list'}=args;
    if(action==='list')return {servers:await registry.list()};
    if(action==='save')return registry.save(args.server||{});
    if(action==='remove')return registry.remove({id:String(args.id||'')});
    if(action==='connect'){const id=String(args.id||'');const row=(await registry.load()).find(item=>item.id===id);if(row?.transport==='builtin'&&!row.enabled)await registry.save({id,enabled:true});return registry.connect(id);}
    if(action==='disconnect')return registry.disconnect(String(args.id||''));
    if(action==='connectEnabled')return {servers:await registry.connectEnabled()};
    fail('mcp_action_invalid');
  };
}
