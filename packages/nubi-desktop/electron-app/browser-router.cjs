const {httpBrowserAddress}=require('../runtime/browser-address.cjs');
class BrowserRouter {
 constructor({internal,external,launch,notify=()=>{}}){Object.assign(this,{internal,external,launch,notify});this.externalFocus=true;}
 get mode(){return this.launch.preference.mode;}
 get imported(){return ['preparing','attaching','docked','detaching'].includes(this.dock?.status().phase);}
 get showInternal(){return this.mode==='internal'||!this.externalFocus&&this.internal.tabs.get(this.internal.active)?.authentication===true;}
 configuration(){const external=this.external.status(),dock=this.dock?.status();return {...this.launch.status(),...external,mode:this.mode,showInternal:this.showInternal,dock,automation:dock?.windowDocked?dock.automationReady:external.automation};}
 async capture(options={}){
  if(this.showInternal||options.tabId&&this.internal.tabs.has(options.tabId))return this.internal.capture(options.tabId,{clip:options.clip,maxWidth:options.maxWidth});
  const tabId=options.tabId||this.external.active;
  return this.external.request('capture',{...options,tabId,documentId:options.documentId||this.external.tab(tabId).automationDocument});
 }
 async open(url,options={}){
  const target=httpBrowserAddress(url);
  // Existing provider authentication keeps its own protected host and callback.
  if(options.authentication||this.mode==='internal'){
   this.externalFocus=false;const row=this.internal.create(target,options);this.internal.publish('opened');return {opened:true,tabId:row.id,userInteractionRequired:true};
  }
  if(!this.external.status().connected){this.externalFocus=true;return this.connectionWait({opened:false,external:true});}
  this.externalFocus=true;await this.internal.request({action:'layout',visible:false});
  const result=await this.external.openPage(target);
  this.notify({type:'external_browser_opened',state:this.configuration()});return result;
 }
 connectionWait(result){
  const state=this.configuration();
  this.notify({type:'browser_connection_required',state});
  return {...result,connected:false,automation:false,connectionRequired:true,connectionPhase:state.connectionPhase||null,error:state.connectionError||null,instruction:'Reuse the already-running external browser. Show the Nubi connection control and its current connection error, then select an existing work tab when available. Do not assume this browser has Chrome permission settings. Do not repeat browser_open, launch another browser, install Playwright or run shell commands to repair this connection.'};
 }
 async setMode(mode){
  if(!['external','internal'].includes(mode))throw Error('browser_action_invalid');
  if(this.changingMode)throw Error('external_browser_busy');
  if(mode===this.mode)return this.configuration();
  this.changingMode=true;
  try{
   await this.external.cancelPendingConnection?.();
   await this.external.mirror?.stop();
   if(this.dock&&(this.dock.operation||['preparing','attaching','docked','detaching','error'].includes(this.dock.status().phase))){const restored=await this.dock.cancel();if(restored?.cancelled===false)throw Error('dock_restore_unconfirmed');}
   this.internalPlaywright?.dispose();
   if(mode==='internal'){await this.dock?.native?.close?.();await this.external.stop();}
   await this.launch.mode(mode);this.externalFocus=mode==='external';
   this.internal.publish('changed');const state=this.configuration();this.notify({type:'external_browser_changed',state});return state;
  }finally{this.changingMode=false;}
 }
 async playwright(action,args,options={}){
  if(action==='bring'){if(this.mode!=='external')throw Error('external_browser_disabled');this.externalFocus=true;return this.dock?this.dock.bring({signal:options.signal,source:'chat'}):Promise.reject(Error('dock_unavailable'));}
  if(action==='dockDetach')return this.dock?this.dock.detach():Promise.reject(Error('dock_unavailable'));
  if(['tabs','open'].includes(action)&&this.mode==='external'&&!this.external.status().connected){
   return action==='open'?this.open(args.url):this.connectionWait({tabs:[]});
  }
  // An explicitly observed internal tab remains usable after a preference
  // switch; new work pages always follow the selected runtime, even while an
  // internal provider sign-in view is visible.
  if(args?.tabId&&this.internal.tabs.has(args.tabId))return this.internalPlaywright.request(action,args);
  if(this.mode==='external'&&this.dock?.status().windowDocked&&!this.dock.status().automationReady)throw Error('browser_automation_unavailable');
  if(this.mode==='internal')return this.internalPlaywright.request(action,args);
  if(action==='open'){this.externalFocus=true;await this.internal.request({action:'layout',visible:false});const result=await this.external.request(action,args);this.notify({type:'external_browser_opened',state:this.configuration()});return result;}
  return this.external.request(action,args);
 }
 async ui(args={}){
  if(args.action==='new'&&this.mode==='external'){
   this.externalFocus=true;await this.internal.request({action:'layout',visible:false});
   if(args.url)await this.open(args.url);this.notify({type:'external_browser_opened',state:this.configuration()});return this.external.status();
  }
  if(args.id&&this.internal.tabs.has(args.id)){this.externalFocus=false;return this.internal.request(args);}
  if(this.showInternal||args.action==='layout')return this.internal.request(args.action==='layout'&&!this.showInternal?{...args,visible:false}:args);
  if(args.action==='status')return this.external.status();
  if(args.action==='select'){this.external.active=args.id;await this.external.focus(args.id);return this.external.status();}
  if(args.action==='close'){await this.external.command('releaseTab',{tabId:args.id||this.external.active});this.external.updateTabs(await this.external.command('tabs'));return this.external.status();}
  if(args.action==='navigate'){await this.open(args.url);return this.external.status();}
  throw Error('external_browser_action_unavailable');
 }
}
module.exports={BrowserRouter};
