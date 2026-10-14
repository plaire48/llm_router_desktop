import {CAPTURE_OPTIONS} from './capture-analysis.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export const PLAYWRIGHT_MCP_VERSION='0.0.83';
const allowed=new Set(['browser_snapshot','browser_click','browser_type','browser_press_key','browser_select_option','browser_hover','browser_navigate','browser_navigate_back','browser_wait_for']);
// Official MCP tools, with an explicit Nubi tab id on every operation. No JS,
// cookies, network logs, file upload or authentication tabs. Captures are bounded PNGs, never disk files.
export async function createInAppPlaywright(request){
 const {createConnection}=await import('@playwright/mcp');
 const [{Client},{InMemoryTransport}]=await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/inMemory.js')]);
 const core=require(require.resolve('playwright-core',{paths:[require.resolve('@playwright/mcp')]}));
 const outputDir=await mkdtemp(path.join(os.tmpdir(),'nubi-playwright-'));
 const clients=new Map(),busy=new Set();let disposed=false;
 async function connection(tabId){
  let browser;
  const server=await createConnection({timeouts:{action:5000,navigation:15000},saveSession:false,webmcp:false,console:{level:'error'},outputDir},async()=>{
   if(!tabId)throw Error('browser_tab_required');
   const {endpoint}=await request('attach',{tabId});
   browser=await core.chromium.connectOverCDP(endpoint,{timeout:10000});
   return browser.contexts()[0];
  });
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client=new Client({name:'nubi-in-app',version:PLAYWRIGHT_MCP_VERSION},{capabilities:{}});
  await client.connect(clientTransport);
  return {client,close:async()=>{await client.close().catch(()=>{});await server.close().catch(()=>{});await browser?.close().catch(()=>{});}};
 }
 const catalog=await connection(null),listed=await catalog.client.listTools();
 const tools=listed.tools.filter(tool=>allowed.has(tool.name)).map(tool=>{
  const properties={...tool.inputSchema.properties};delete properties.filename;
  return {...tool,inputSchema:{...tool.inputSchema,properties:{tabId:{type:'string',description:'Exact Nubi tab id from browser_tabs or browser_open.'},...(tool.annotations?.readOnlyHint?{}:{documentId:{type:'string',description:'Document id from the latest snapshot or tab listing. Refresh the snapshot after navigation.'}}),...properties},required:['tabId',...(tool.annotations?.readOnlyHint?[]:['documentId']),...(tool.inputSchema.required||[])]}};
 });
 tools.unshift({name:'browser_capture',description:'Capture all or a selected region of a Nubi web tab. The host reads the image with an image-capable model from the same provider, then returns its findings to the original model. Prefer DOM snapshots for ordinary text.',inputSchema:{type:'object',additionalProperties:false,properties:{...CAPTURE_OPTIONS,documentId:{type:'string'},question:{type:'string',maxLength:400}},required:['tabId','documentId']},annotations:{readOnlyHint:true}});
 tools.unshift({name:'browser_tabs',description:'List ordinary Nubi in-app web tabs. Authentication tabs are excluded.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}});
 tools.unshift({name:'browser_open',description:'Open an HTTP/HTTPS page in a new Nubi in-app tab and return its tabId.',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']},annotations:{readOnlyHint:false}});
 return {
  listTools:async()=>({tools}),
  async callTool({name,arguments:args={} },_schema,{signal}={}){
   if(disposed)throw Error('mcp_tool_unavailable');signal?.throwIfAborted();
   if(name==='browser_capture'){if(typeof args.tabId!=='string'||typeof args.documentId!=='string')throw Error('browser_document_required');const shot=await request('capture',args,{signal});const {image,...metadata}=shot;return {content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',mimeType:'image/png',data:image}],structuredContent:metadata};}
   if(name==='browser_tabs'||name==='browser_open'){
    const result=await request(name==='browser_tabs'?'tabs':'open',args,{signal});
    if(name==='browser_tabs'){const present=new Set(result.tabs.map(row=>row.tabId));for(const [id,entry] of clients)if(!present.has(id)){clients.delete(id);void entry.then(value=>value.close()).catch(()=>{});}}
    return {content:[{type:'text',text:JSON.stringify(result)}]};
   }
   if(!allowed.has(name)||typeof args.tabId!=='string')throw Error('browser_tab_required');
   const mutating=tools.find(tool=>tool.name===name)?.annotations?.readOnlyHint!==true;
   if(mutating&&typeof args.documentId!=='string')throw Error('browser_document_required');
   if(args.filename!==undefined)throw Error('browser_file_access_denied');
   if(name==='browser_wait_for'&&Number(args.time)>15)throw Error('browser_wait_too_long');
   await request('check',{tabId:args.tabId,...(mutating?{documentId:args.documentId}:{})},{signal});
   if(!clients.has(args.tabId))clients.set(args.tabId,connection(args.tabId).catch(error=>{clients.delete(args.tabId);throw error;}));
   const entry=await clients.get(args.tabId),{tabId,documentId,...input}=args;
   if(busy.has(tabId))throw Error('browser_action_in_progress');busy.add(tabId);
   try{
   await request('check',{tabId,...(mutating?{documentId}:{})},{signal});
   signal?.throwIfAborted();
   const result=await entry.client.callTool({name,arguments:input},undefined,{signal});
   const binding=await request('check',{tabId},{signal});
   return {...result,content:[{type:'text',text:JSON.stringify(binding)},...(result.content||[])]};
   }finally{busy.delete(tabId);}
  },
  async close(){disposed=true;await Promise.allSettled([catalog.close(),...[...clients.values()].map(async value=>(await value).close())]);clients.clear();await rm(outputDir,{recursive:true,force:true});}
 };
}
