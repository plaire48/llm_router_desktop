const {httpBrowserAddress}=require('../runtime/browser-address.cjs');
class BrowserRouter {
 constructor({internal,external,launch,notify=()=>{}}){Object.assign(this,{internal,external,launch,notify});this.externalFocus=true;}
 get mode(){return this.launch.preference.mode;}
 get showInternal(){return this.mode==='internal'||!this.externalFocus&&this.internal.tabs.get(this.internal.active)?.authentication===true;}
 configuration(){const external=this.external.status(),dock=this.dock?.status();return {...this.launch.status(),...external,mode:this.mode,showInternal:this.showInternal,dock,automation:dock?.windowDocked?dock.automationReady:external.automation};}
 async open(url,options={}){
  const target=httpBrowserAddress(url);
  // Existing provider authentication keeps its own protected host and callback.
  if(options.authentication||this.mode==='internal'){
   this.externalFocus=false;const row=this.internal.create(target,options);this.internal.publish('opened');return {opened:true,tabId:row.id,userInteractionRequired:true};
  }
  this.externalFocus=true;await this.internal.request({action:'layout',visible:false});
  const result=this.external.status().connected?await this.external.openPage(target):await this.launch.open(target);
  this.notify({type:'external_browser_opened',state:this.configuration()});return result;
 }
 async playwright(action,args,options={}){
  if(action==='bring'){this.externalFocus=true;await this.internal.request({action:'layout',visible:false});return this.dock?this.dock.bring({signal:options.signal,source:'chat'}):Promise.reject(Error('dock_unavailable'));}
  if(action==='dockDetach')return this.dock?this.dock.detach():Promise.reject(Error('dock_unavailable'));
  if(action==='open'&&this.mode==='external'&&!this.external.status().connected)return this.open(args.url);
  if(this.dock?.status().windowDocked&&!this.dock.status().automationReady)throw Error('browser_automation_unavailable');
  // An explicitly observed internal tab remains usable after a preference
  // switch; new chat opens always follow the selected default.
  if(args?.tabId&&this.internal.tabs.has(args.tabId))return this.internalPlaywright.request(action,args);
  return this.mode==='external'?this.external.request(action,args):this.internalPlaywright.request(action,args);
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
