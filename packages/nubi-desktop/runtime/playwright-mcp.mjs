import {CAPTURE_OPTIONS} from './capture-analysis.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {WORKFLOW_TOOL} from './browser-workflow.mjs';
import {httpBrowserAddress} from './browser-address.cjs';
const require=createRequire(import.meta.url);
export const PLAYWRIGHT_MCP_VERSION='0.0.83';
// 2026-10-15: find (cheap ref search instead of a full snapshot), fill_form (one call per form) and mouse_wheel (lazy
// pages need scrolling) added; evaluate, run_code, uploads, cookies and network stay out.
// Claude Code benchmark (2026-10-18): console errors, viewport presets, dialog handling and the testing verifiers join
// the set. browser_evaluate, network listing (URLs can carry tokens), file upload and raw coordinates stay out.
const allowed=new Set(['browser_snapshot','browser_find','browser_click','browser_type','browser_fill_form','browser_press_key','browser_select_option','browser_hover','browser_mouse_wheel','browser_navigate','browser_navigate_back','browser_wait_for','browser_console_messages','browser_resize','browser_handle_dialog','browser_verify_text_visible','browser_verify_element_visible']);
// Official MCP tools, with an explicit Nubi tab id on every operation. No JS,
// cookies, network logs, file upload or authentication tabs. Captures are bounded PNGs, never disk files.
export async function createInAppPlaywright(request){
 const {createConnection}=await import('@playwright/mcp');
 const [{Client},{InMemoryTransport}]=await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/inMemory.js')]);
 const core=require(require.resolve('playwright-core',{paths:[require.resolve('@playwright/mcp')]}));
 const outputDir=await mkdtemp(path.join(os.tmpdir(),'nubi-playwright-'));
 const clients=new Map(),tails=new Map();let disposed=false;
 // Calls on one tab run one after another instead of failing with browser_action_in_progress (parallel read batches).
 const queued=(tabId,work)=>{const run=(tails.get(tabId)||Promise.resolve()).then(work);tails.set(tabId,run.catch(()=>{}));return run;};
 const warm=tabId=>{
  if(!clients.has(tabId)){
   const pending=(async()=>{
    for(let attempt=0;attempt<2;attempt++){
     try{return await connection(tabId,()=>{if(clients.get(tabId)===pending)clients.delete(tabId);});}
     catch(error){if(disposed||attempt||!/^browser_cdp_(attach|listen|connect)_timeout$/.test(error.message))throw error;}
    }
   })().catch(error=>{if(clients.get(tabId)===pending)clients.delete(tabId);throw error;});
   clients.set(tabId,pending);
  }
  return clients.get(tabId);
 };
 async function connection(tabId,invalidate=()=>{}){
  let browser,endpoint,server,client,closed=false,ready=false;
  const close=async()=>{
   if(closed)return;closed=true;if(ready)invalidate();
   await client?.close().catch(()=>{});await server?.close().catch(()=>{});await browser?.close().catch(()=>{});
   if(endpoint)await request('release',{tabId,endpoint}).catch(()=>{});
  };
  try{
   // Complete the handshake before caching a usable client or dispatching an action.
   // Only this pre-action connection phase may be retried. Never replay a click/type.
   if(tabId){
    ({endpoint}=await request('attach',{tabId}));
    try{browser=await core.chromium.connectOverCDP(endpoint,{timeout:7000});}
    catch(error){throw Error(error.name==='TimeoutError'||/timeout|timed out/i.test(error.message)?'browser_cdp_connect_timeout':'browser_cdp_connect_failed');}
    browser.once('disconnected',()=>{void close();});
    if(disposed)throw Error('mcp_tool_unavailable');
   }
   server=await createConnection({timeouts:{action:5000,navigation:15000,settle:150},saveSession:false,webmcp:false,console:{level:'error'},outputDir,codegen:'none',snapshot:{mode:'none'},capabilities:['vision','testing']},async()=>{
    if(!tabId)throw Error('browser_tab_required');
    if(!browser?.isConnected())throw Error('browser_cdp_disconnected');
    return browser.contexts()[0];
   });
   const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
   await server.connect(serverTransport);
   client=new Client({name:'nubi-in-app',version:PLAYWRIGHT_MCP_VERSION},{capabilities:{}});
   await client.connect(clientTransport);
   if(closed||disposed)throw Error('browser_cdp_disconnected');
   ready=true;return {client,close};
  }catch(error){await close();throw error;}
 }
 const catalog=await connection(null),listed=await catalog.client.listTools();
 const tools=listed.tools.filter(tool=>allowed.has(tool.name)).map(tool=>{
  const properties={...tool.inputSchema.properties};delete properties.filename;
  return {...tool,inputSchema:{...tool.inputSchema,properties:{tabId:{type:'string',description:'Exact Nubi tab id from browser_tabs or browser_open.'},...(tool.annotations?.readOnlyHint?{}:{documentId:{type:'string',description:'Document id from the latest snapshot or tab listing. Refresh the snapshot after navigation.'}}),...properties},required:['tabId',...(tool.annotations?.readOnlyHint?[]:['documentId']),...(tool.inputSchema.required||[])]}};
 });
 tools.unshift({name:'browser_capture',description:'Capture all or a selected region of a Nubi web tab. The host reads the image with an image-capable model from the same provider, then returns its findings to the original model. Prefer DOM snapshots for ordinary text.',inputSchema:{type:'object',additionalProperties:false,properties:{...CAPTURE_OPTIONS,documentId:{type:'string'},question:{type:'string',maxLength:400}},required:['tabId','documentId']},annotations:{readOnlyHint:true}});
 tools.unshift({name:'browser_tabs',description:'List connected work tabs in the selected browser runtime. External mode uses the existing direct browser connection and explicit tab choice; no extension is required. Authentication tabs are excluded. If connectionRequired is true, wait for the user to connect the browser in Nubi; do not retry launches or install automation packages.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}});
 tools.unshift({name:'browser_open',description:'Open HTTP/HTTPS or localhost:port in the selected browser. External mode reuses the connected original window/session. Before connection it opens nothing and returns opened:false, connectionRequired:true with the actual connection state/error. Show Nubi connection UI for an existing work tab; never assume Chrome permission settings exist in Samsung or another Chromium browser. Do not repeat launches, run PowerShell/shell workarounds or install Playwright. Returns exact tabId/documentId and an initial snapshot when ready; use its observed refs directly.',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']},annotations:{readOnlyHint:false}});
 for(const [name,description] of [['browser_bring','Bring the current external browser window into Nubi, including its real address bar and tabs. Automatically finds a recently used supported browser on Windows; no manual executable or extension connection is needed for window display. Preserves its running process, tabs and login. Returns automationReady separately: window display does not grant website read or write capability. Use this when asked to bring or dock a browser. No website action or login is performed.'],['browser_detach','Restore the docked external browser window to its original desktop position, preserving tabs and login.']])tools.unshift({name,description,inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false}});
 return {
  listTools:async()=>({tools:[WORKFLOW_TOOL,...tools]}),
  async callTool({name,arguments:args={} },_schema,{signal}={}){
   if(disposed)throw Error('mcp_tool_unavailable');signal?.throwIfAborted();
   if(name==='browser_bring'||name==='browser_detach'){const result=await request(name==='browser_bring'?'bring':'dockDetach',{}, {signal});return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
   if(name==='browser_capture'){if(typeof args.tabId!=='string'||typeof args.documentId!=='string')throw Error('browser_document_required');const shot=await request('capture',args,{signal});const {image,...metadata}=shot;return {content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',mimeType:'image/png',data:image}],structuredContent:metadata};}
   if(name==='browser_tabs'||name==='browser_open'){
    let result=await request(name==='browser_tabs'?'tabs':'open',name==='browser_open'?{...args,url:httpBrowserAddress(args.url)}:args,{signal});
    if(name==='browser_tabs'){const present=new Set(result.tabs.map(row=>row.tabId));for(const [id,entry] of clients)if(!present.has(id)){clients.delete(id);void entry.then(value=>value.close()).catch(()=>{});}}
    // Return the initial DOM with the open receipt: avoid a whole model round trip.
    // A slow page still opens promptly, and the already-started connection is reused.
    if(name==='browser_open'&&typeof result?.tabId==='string'){
     const tabId=result.tabId;let timer;
     try{
      const initial=queued(tabId,async()=>{
       const connected=await warm(tabId),abort=AbortSignal.timeout(1500);
       const snapshot=await connected.client.callTool({name:'browser_snapshot',arguments:{}},undefined,{signal:signal?AbortSignal.any([signal,abort]):abort});
       if(snapshot.isError)return null;
       const binding=await request('check',{tabId,documentId:result.documentId},{signal});
       return {...binding,snapshot:(snapshot.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n')};
      });
      const ready=await Promise.race([initial,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1500);})]);
      if(ready)result={...result,...ready};
     }catch{/* Navigation/auth changes retain the open receipt; never return stale DOM. */}finally{clearTimeout(timer);}
    }
    return {content:[{type:'text',text:JSON.stringify(result)}]};
   }
   if(!allowed.has(name)||typeof args.tabId!=='string')throw Error('browser_tab_required');
   const mutating=tools.find(tool=>tool.name===name)?.annotations?.readOnlyHint!==true;
   if(mutating&&typeof args.documentId!=='string')throw Error('browser_document_required');
   if(args.filename!==undefined)throw Error('browser_file_access_denied');
   if(name==='browser_wait_for'&&Number(args.time)>15)throw Error('browser_wait_too_long');
   const {tabId,documentId,...input}=args;
   if(name==='browser_navigate')input.url=httpBrowserAddress(input.url);
   return queued(tabId,async()=>{
    // One binding check right before the call (the tab and document still the ones the model saw), one after.
    await request('check',{tabId,...(mutating?{documentId}:{})},{signal});
    signal?.throwIfAborted();
    let entry;
    try{entry=await warm(tabId);}catch(error){
     if(!/^browser_cdp_/.test(error.message))throw error;
     return {isError:true,content:[{type:'text',text:'브라우저 자동화 연결을 준비하지 못했어요. 페이지는 그대로 열려 있습니다. ('+error.message+')'}],structuredContent:{error:error.message,stage:'connection',actionIssued:false}};
    }
    // Navigation or user cancellation can happen during the handshake.
    await request('check',{tabId,...(mutating?{documentId}:{})},{signal});
    signal?.throwIfAborted();
    const result=await entry.client.callTool({name,arguments:input},undefined,{signal});
    const binding=await request('check',{tabId},{signal});
    const content=[{type:'text',text:JSON.stringify(binding)},...(result.content||[])];
    // After an action the new page state comes back inline, so the model needs no second turn to see it.
    if(mutating&&!result.isError){try{const after=await entry.client.callTool({name:'browser_snapshot',arguments:{}},undefined,{signal});for(const part of after.content||[])if(part?.type==='text')content.push({type:'text',text:'### Snapshot after the action\n'+String(part.text||'')});}catch{}}
    return {...result,content};
   });
  },
  async close(){disposed=true;await Promise.allSettled([catalog.close(),...[...clients.values()].map(async value=>(await value).close())]);clients.clear();await rm(outputDir,{recursive:true,force:true});}
 };
}
