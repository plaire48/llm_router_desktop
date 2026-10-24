import {hash} from './files.mjs';
import {humanDecisions} from '../ui/human-decisions.mjs';
import {wikiChatJob} from './wiki-chat-admission.mjs';
import {stopProjectWork} from './project-navigation.mjs';

const active=service=>!!(service.wikiResetting||service.skillImportBusy||service.marketplaceBusy||service.vocBusy||service.computerBusy||service.newFileBusy||service.setupBusy||service.processes?.active.size||service.processes?.pending.size||service.unsettledOperations?.size||service.reconciling||service.agent?.running||service.recordingKnowledge||service.databaseBusy||service.collaborationBusy||service.wikiUpdateRun||service.wikiRefreshOwner||service.wikiInitController&&!service.wikiInitController.signal.aborted&&service.store?.get('wiki-init')?.state==='running');

// Each service owns an immutable project while work is in flight. Switching
// changes the selected service, never the store/root referenced by an agent.
export class ProjectServices{
 constructor({service,createService,resolveRoot,onOpenStage=()=>{}}){this.primary=service;this.current=service;this.createService=createService;this.resolveRoot=resolveRoot;this.onOpenStage=onOpenStage;this.projects=new Map();this.opening=false;this.updateLocked=false;
  service.isAnyProjectBusy=()=>[...this.projects.values()].some(item=>item.agent?.running||item.wikiUpdating);
 }
 share(service){
  const primary=this.primary;
  for(const name of ['providers','providerRestoring','personalMail','usageLedger','marketplaceToken','marketplaceReader','marketplaceConnected','marketplaceCatalog','marketplaceAuthRequired','marketplaceRevision','marketplaceController'])Object.defineProperty(service,name,{configurable:true,get:()=>primary[name],set:value=>{primary[name]=value;}});
  for(const name of ['connectionVault','openWorkspacePage','closeWorkspaceAuthPage','syncWikiSources','playwrightRequest','captureWorkspacePage','captureWorkspaceWindow','notifyAnswer','notifyWiki','notifyActivity','notifyStream','routines'])service[name]=primary[name];
  service.mail=args=>primary.mail(args);
  return service;
 }
 background(){return [...this.projects.values()].filter(service=>service!==this.current).map(service=>({projectId:service.projectId,root:service.root,running:!!service.agent?.running,wikiChatJob:wikiChatJob(service),decisions:humanDecisions({...service.state(),projectId:service.projectId}).map(decision=>({...decision,projectId:service.projectId}))}));}
 async invoke(method,args={}){
  if(this.updateLocked)throw Error('update_installing');
  if(method==='projectActivity')return this.activity(args.projectId);
  if(args._projectId&&!['open','provider','mail','usage'].includes(method)&&args._projectId!==this.current.projectId)throw Error('project_changed');
  if(method==='projectNavigationTarget')return {root:await this.resolveRoot(args.root)};
  if(method==='stopProjectWork'){
   const source=this.current;if(args.projectId!==source.projectId)throw Error('project_changed');
   await stopProjectWork(source);return {stopped:true,projectId:source.projectId};
  }
  if(method==='open'){
   if(this.opening)throw Error('project_busy');this.opening=true;
   let service,created=false;
   try{const root=await this.resolveRoot(args.root);
    const emit=stage=>{try{this.onOpenStage({requestId:args.progressId,stage});}catch{}};
    if(args.stopCurrent===true&&this.current.root&&this.current.root!==root){emit('stopping');await stopProjectWork(this.current);}
    emit('opening');
    service=this.projects.get(root);if(!service){service=this.primary.root?this.share(this.createService()):this.primary;created=service!==this.primary;}
    const result=await service.invoke(method,args);this.projects.set(service.root,service);if(this.current!==service)this.current.viewingTaskId=null;this.current=service;return {...result,...this.status()};
   }catch(error){if(service?.root)this.projects.set(service.root,service);else if(created&&service){this.detachShared(service);service.dispose();}throw error;}
   finally{this.opening=false;}
  }
  const services=[this.primary,...this.projects.values()];
  if(method==='prepareAppUpdate'&&(this.opening||this.primary.routines?.busy||services.some(active)))throw Error('update_work_active');
  if((method==='provider'&&args.action&&args.action!=='status'||method==='fabrix'&&args.method==='CONNECT_FABRIX')&&services.some(service=>service.agent?.running))throw Error('agent_busy');
  let result;try{result=await this.current.invoke(method,args);}finally{this.primary.routines?.observe?.(this.current);}
  if(method==='prepareAppUpdate')this.updateLocked=true;
  if(method==='state'&&args.streamOnly)return result;
  return ['overview','state'].includes(method)?{...result,...this.status()}:result;
 }
 status(){const background=this.background();return {backgroundProjects:background.map(({decisions,...project})=>({...project,waitingInput:decisions.length>0})),backgroundDecisions:background.flatMap(project=>project.decisions),backgroundActive:background.some(project=>project.running)};}
 async service(project){
  if(this.updateLocked||this.opening)throw Error('project_busy');
  this.opening=true;let created;
  try{
   const root=await this.resolveRoot(project.root);if(hash(root).slice(7,31)!==project.id)throw Error('project_changed');
   const existing=this.projects.get(root);if(existing)return existing;
   created=this.share(this.createService());await created.open(root,{initializeWiki:false,exactRoot:true});this.projects.set(root,created);return created;
  }catch(error){if(created){this.detachShared(created);created.dispose();created.store?.close();}throw error;}
  finally{this.opening=false;}
 }
 activity(projectId){const service=[...this.projects.values()].find(item=>item.projectId===projectId);return {active:!!service&&(active(service)||humanDecisions({...service.state(),projectId}).length>0)};}
 detachShared(service){for(const name of ['providers','personalMail','usageLedger','marketplaceController','marketplaceToken','marketplaceCatalog'])Object.defineProperty(service,name,{configurable:true,value:null,writable:true});}
 dispose(){const services=new Set([this.primary,...this.projects.values()]),providers=this.primary.providers,mail=this.primary.personalMail,usage=this.primary.usageLedger,marketplace=this.primary.marketplaceController;
  for(const service of services){this.detachShared(service);service.dispose();}mail?.dispose();providers?.dispose();usage?.close();marketplace?.abort();
 }
}
