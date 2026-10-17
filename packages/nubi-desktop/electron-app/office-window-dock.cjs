// Reuses native overlay geometry/restoration. The bound COM host owns the identity.
class OfficeWindowDock {
 constructor({native,identity,notify=()=>{}}){
  Object.assign(this,{native,identity,notify});this.phase='idle';this.epoch=0;this.visible=false;
  native.onEvent=e=>{if(['released','disconnected','viewportBlocked'].includes(e.type)){
   this.epoch++;this.visible=false;this.target=null;this.phase='idle';this.publish();
   if(e.type==='disconnected')void native.recover().catch(()=>{this.phase='error';this.publish();});
  }};
 }
 publish(){const status={phase:this.phase,epoch:this.epoch,taskId:this.target?.taskId};this.notify({type:'office_dock_changed',status});return status;}
 async show(target){
  await this.detach();const epoch=++this.epoch;const identity=await this.identity(target);
  if(epoch!==this.epoch)throw Error('dock_cancelled');await this.native.start('');
  if(epoch!==this.epoch)throw Error('dock_cancelled');
  const candidate=await this.native.request('chooseOffice',identity);
  if(epoch!==this.epoch)throw Error('dock_cancelled');
  this.target=target;this.boundIdentity=identity;this.candidate=candidate;this.phase='preparing';this.publish();return {opened:true};
 }
 async layout(args){
  if(!this.target)return {visible:false};const epoch=this.epoch;this.visible=!!args.visible;
  await this.native.request('layout',{...args.bounds,armed:this.visible,visible:this.visible});
  if(epoch!==this.epoch)return {visible:false};
  if(this.phase==='preparing'&&this.visible){
   this.phase='attaching';this.publish();
   try{
    await new Promise(r=>setTimeout(r,args.reduced?0:440));
    if(epoch!==this.epoch)return {visible:false};
    if(!this.visible){this.phase='preparing';this.publish();return {visible:false};}
    const identity=await this.identity(this.target);
    if(epoch!==this.epoch)return {visible:false};
    if(JSON.stringify(identity)!==JSON.stringify(this.boundIdentity))throw Error('native_office_source_changed');
    if(!this.visible){this.phase='preparing';this.publish();return {visible:false};}
    const receipt=await this.native.request('attach',this.candidate);
    if(epoch!==this.epoch)return {visible:false};
    if(!receipt.docked)throw Error('dock_attach_failed');this.phase='docked';this.publish();
   }catch(error){if(epoch===this.epoch){await this.native.request('detach').catch(()=>{});this.phase='error';this.publish();}throw error;}
  }
  return {phase:this.phase};
 }
 async detach(){this.epoch++;this.visible=false;this.target=null;this.phase='idle';try{if(this.native.child)await this.native.request('detach');}finally{this.publish();}return {detached:true};}
 async dispose(){try{await this.detach();}finally{await this.native.close();}}
}
module.exports={OfficeWindowDock};
