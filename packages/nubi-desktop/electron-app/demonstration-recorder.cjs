// Demonstration recording inside the product browsers (browser teach plan T3, product step, 2026-10-21).
// The same page script the browser module uses in evaluation is injected over the tab's debugger: the real
// `webContents.debugger` of an internal view, or the extension-relayed shim of an external tab. Both expose
// attach/detach/sendCommand/'message', so one recorder serves both. Events are collected per tab in memory and
// handed back on stop; nothing is written here and no value leaves the main process except through the worker's
// card builder, which keeps values out of the card.
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const BINDING='__nubiDemonstration';
const DEFAULT_LIMIT=200;
let scriptPromise=null;
const loadScript=()=>scriptPromise??=import(pathToFileURL(path.join(__dirname,'..','generated','browser-agent-core.mjs')).href)
 .then(module=>{if(typeof module.DEMONSTRATION_SCRIPT!=='string')throw Error('browser_recorder_unavailable');return module.DEMONSTRATION_SCRIPT;})
 .catch(()=>{scriptPromise=null;throw Error('browser_recorder_unavailable');});

class DemonstrationRecorder{
 constructor({script=null}={}){this.sessions=new Map();this.scriptOverride=script;}
 script(){return this.scriptOverride?Promise.resolve(this.scriptOverride):loadScript();}
 summary(session){return {recording:!session.ended,events:session.events.length,dropped:session.dropped,startedAt:session.startedAt,stoppedAt:session.stoppedAt??null,reason:session.reason,shared:!session.owned};}
 status(tabId){const session=this.sessions.get(tabId);return session?this.summary(session):{recording:false,events:0,dropped:0,startedAt:null,stoppedAt:null,reason:null,shared:false};}
 async start(row,{allowUrl=()=>true,limit=DEFAULT_LIMIT}={}){
  const wc=row.view.webContents;if(!wc||wc.isDestroyed())throw Error('browser_tab_missing');
  const existing=this.sessions.get(row.id);if(existing&&!existing.ended)return this.summary(existing);
  if(existing)this.sessions.delete(row.id);
  const script=await this.script();if(wc.isDestroyed())throw Error('browser_tab_missing');
  const dbg=wc.debugger;
  // A tab the Playwright port already holds is shared: the recorder adds its binding and script to that session
  // and removes only those on stop. Otherwise the recorder owns the attachment and detaches when it ends.
  const owned=!dbg.isAttached();if(owned)dbg.attach('1.3');
  const session={tabId:row.id,wc,dbg,owned,startedAt:new Date().toISOString(),stoppedAt:null,reason:null,events:[],dropped:0,mainFrameId:null,mainContexts:new Set(),contextsSeen:0,scriptId:null,ended:false,allowUrl,limit};
  session.onMessage=(_event,method,params,childSession)=>{
   if(childSession)return;// Child targets (out-of-process frames) are not recorded; the main frame only.
   if(method==='Runtime.executionContextCreated'){session.contextsSeen++;const aux=params?.context?.auxData;if(aux?.isDefault===true&&(!session.mainFrameId||aux.frameId===session.mainFrameId))session.mainContexts.add(params.context.id);return;}
   if(method==='Runtime.executionContextDestroyed'){session.mainContexts.delete(params?.executionContextId);return;}
   if(method==='Runtime.executionContextsCleared'){session.mainContexts.clear();return;}
   if(method!=='Runtime.bindingCalled'||params?.name!==BINDING)return;
   // Same-process child frames share this session; their contexts are not the main frame's default context.
   if(session.contextsSeen>0&&!session.mainContexts.has(params.executionContextId)){session.dropped++;return;}
   let event;try{event=JSON.parse(params.payload);}catch{session.dropped++;return;}
   if(!event||typeof event!=='object'||typeof event.url!=='string'||!Array.isArray(event.items)||!session.allowUrl(event.url)){session.dropped++;return;}
   if(session.events.length>=session.limit){this.end(session,'limit');return;}
   session.events.push(event);
  };
  session.onDestroyed=()=>this.end(session,'tab_closed');
  session.onDetach=()=>this.end(session,'detached');
  try{
   await dbg.sendCommand('Page.enable');
   const tree=await dbg.sendCommand('Page.getFrameTree');session.mainFrameId=tree?.frameTree?.frame?.id??null;
   // The listener is in place before Runtime.enable so the existing contexts it reports are classified.
   dbg.on('message',session.onMessage);wc.once('destroyed',session.onDestroyed);dbg.once('detach',session.onDetach);
   await dbg.sendCommand('Runtime.enable');
   session.scriptId=(await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:script}))?.identifier??null;
   await dbg.sendCommand('Runtime.addBinding',{name:BINDING});
   await dbg.sendCommand('Runtime.evaluate',{expression:script}).catch(()=>{});
  }catch{
   dbg.removeListener('message',session.onMessage);wc.removeListener('destroyed',session.onDestroyed);dbg.removeListener('detach',session.onDetach);
   if(owned&&!wc.isDestroyed()&&dbg.isAttached())dbg.detach();
   throw Error('browser_recorder_unavailable');
  }
  this.sessions.set(row.id,session);return this.summary(session);
 }
 end(session,reason){
  if(session.ended)return;session.ended=true;session.reason=reason;session.stoppedAt=new Date().toISOString();
  const {wc,dbg}=session;
  dbg.removeListener('message',session.onMessage);wc.removeListener('destroyed',session.onDestroyed);dbg.removeListener('detach',session.onDetach);
  if(wc.isDestroyed()||!dbg.isAttached())return;
  if(session.owned){dbg.detach();return;}
  void Promise.resolve(dbg.sendCommand('Runtime.removeBinding',{name:BINDING})).catch(()=>{});
  if(session.scriptId)void Promise.resolve(dbg.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:session.scriptId})).catch(()=>{});
 }
 stop(tabId){
  const session=this.sessions.get(tabId);if(!session)throw Error('browser_recording_missing');
  this.end(session,'stopped');this.sessions.delete(tabId);
  return {...this.summary(session),events:session.events.slice()};
 }
 dispose(){for(const session of this.sessions.values())this.end(session,'disposed');this.sessions.clear();}
}
module.exports={DemonstrationRecorder,DEMONSTRATION_BINDING:BINDING};
