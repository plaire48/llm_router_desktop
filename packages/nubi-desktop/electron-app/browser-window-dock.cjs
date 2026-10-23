const {randomUUID}=require('node:crypto');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class BrowserWindowDock {
 constructor({native,external,launch,notify=()=>{},platform=process.platform,delay=pause}){Object.assign(this,{native,external,launch,notify,platform,delay});this.phase='idle';this.error=null;this.epoch=0;this.layoutValue=null;this.exact=false;this.layoutAt=0;this.operation=null;this.disposed=false;native.onEvent=event=>this.event(event);}
 status(){return {supported:this.platform==='win32',phase:this.phase,windowDocked:this.phase==='docked',displayMode:this.external.quickConnect?'tab-content':'native-window-overlay',transitionMode:this.transitionMode||'placeholder',error:this.error,requestId:this.requestId,browserName:this.browserName,automationReady:this.automationReady===true};}
 publish(){this.notify({type:'browser_dock_changed',dock:this.status()});}
 async ready(){if(this.disposed)throw Error('dock_disposed');if(this.platform!=='win32')throw Error('external_browser_windows_required');if(this.launch.preference.mode!=='external')throw Error('dock_external_required');await this.native.start(this.launch.preference.executable||'');}
 async layout(value){
  const b=value?.bounds;
  if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.width<0||b.height<0||b.width>20000||b.height>20000)throw Error('dock_bounds_invalid');
  this.layoutValue={...b,armed:!!value.armed,visible:!!value.visible};this.exact=value.exact===true;this.reduced=!!value.reduced;this.layoutAt=Date.now();
  // Pane/dialog hide must win over any in-flight attachment.
  if(this.operation&&this.exact&&!value.visible)void this.cancel();
  if(this.platform==='win32'&&this.launch.preference.mode==='external'){await this.ready();return this.native.request('layout',this.layoutValue);}return {updated:false};
 }
 async event(event){
  if(event.type==='enter'&&this.phase!=='docked'&&!this.operation)this.notify({type:'browser_dock_hover',entered:true});
  if(event.type==='leave')this.notify({type:'browser_dock_hover',entered:false});
  if(event.type==='drop'){try{await this.bring({candidateId:event.candidateId,source:'drag'});}catch{}}
  if(event.type==='previewCancelled'&&this.operation)await this.cancel();
  if(event.type==='viewportBlocked'){await this.cancel();this.phase='error';this.error='dock_bounds_unconfirmed';this.publish();}
  if(event.type==='released'||event.type==='disconnected'){this.epoch++;this.phase='idle';this.publish();if(event.type==='disconnected'){try{await this.native.recover?.();}catch{this.phase='error';this.error='dock_restore_required';this.publish();}}}
 }
 async bring({candidateId,signal,source='chat'}={}){
  if(this.phase==='docked')return {docked:true,alreadyDocked:true};if(this.operation)throw Error('dock_busy');
  const run=this.external.quickConnect?this.connectContent({candidateId,signal,source}):this.perform({candidateId,signal,source});this.operation=run;try{return await run;}finally{if(this.operation===run)this.operation=null;}
 }
 async connectContent({candidateId,signal,source}){
  const epoch=++this.epoch,controller=new AbortController();this.contentAbort=controller;
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const check=()=>{if(controller.signal.aborted||epoch!==this.epoch||this.disposed)throw Error('dock_cancelled');};
  this.requestId=randomUUID();this.phase='connecting';this.error=null;this.publish();this.notify({type:'external_browser_opened',source});
  try{
   check();await this.ready();check();const selected=await this.native.request('choose',{candidateId});check();this.browserName=selected.browserName;
   const resolveProof=async nonces=>{
    check();for(const nonce of nonces){try{const result=await this.native.request('resolveProof',{candidateId:selected.candidateId,nonce});check();if(result.candidateId===selected.candidateId)return nonce;}catch(error){check();if(!['dock_proof_pending','dock_window_mismatch'].includes(error.message))throw error;}}
    throw Error('dock_window_mismatch');
   };
   await this.external.quickConnect({resolveProof,signal:controller.signal,replace:true,...(selected.executable?{open:url=>this.launch.open(url,{executable:selected.executable})}: {})});check();
   this.phase='idle';this.automationReady=true;this.publish();return {connected:true,displayMode:'tab-content',browserPreserved:true};
  }catch(error){if(epoch===this.epoch){this.phase=error.message==='dock_cancelled'?'idle':'error';this.error=error.message;this.publish();}throw error;}
  finally{signal?.removeEventListener('abort',abort);if(this.contentAbort===controller)this.contentAbort=null;}
 }
 async perform({candidateId,signal,source}){
  const epoch=++this.epoch;this.requestId=randomUUID();let nonce=null,generation=null;
  const check=()=>{if(epoch!==this.epoch||signal?.aborted||this.disposed)throw Error('dock_cancelled');if(generation&&this.external.generation!==generation)throw Error('dock_connection_changed');};
  const abort=()=>void this.cancel();signal?.addEventListener('abort',abort,{once:true});
  try{
   check();await this.ready();check();
   this.phase='preparing';this.error=null;this.transitionMode=this.reduced?'reduced':'placeholder';this.publish();this.notify({type:'external_browser_opened',source});
   // Wait for the visible pane's measured viewport, never commit a guessed drop zone.
   for(let i=0;i<40&&(!this.exact||!this.layoutValue?.visible||Date.now()-this.layoutAt>3000);i++){await this.delay(50);check();}
   if(!this.exact||!this.layoutValue?.visible||Date.now()-this.layoutAt>3000)throw Error('dock_viewport_unavailable');
   const selected=await this.native.request('choose',{candidateId});check();if(!selected?.candidateId)throw Error('dock_window_missing');
   this.browserName=selected.browserName||'브라우저';this.automationReady=false;
   // Native display never needs an extension. When a connector already exists,
   // prove it is this exact window before allowing any website automation.
   if(this.external.status().connected){
    generation=this.external.generation;nonce=randomUUID();
    try{await this.external.command('windowProofStart',{nonce});check();let proof;
     for(let i=0;i<20;i++){check();try{proof=await this.native.request('resolveProof',{nonce,candidateId:selected.candidateId});break;}catch(error){if(error.message!=='dock_proof_pending')throw error;await this.delay(60);}}
     this.automationReady=proof?.candidateId===selected.candidateId;
    }catch(error){if(['dock_cancelled','dock_connection_changed'].includes(error.message))throw error;this.automationReady=false;}
    finally{if(nonce&&generation===this.external.generation)await this.external.command('windowProofEnd',{nonce}).catch(()=>{});nonce=null;}
   }
   check();
   this.phase='attaching';this.publish();
   if(!this.reduced){
    const preview=await this.native.request('preview',{candidateId:selected.candidateId});check();
    if(preview?.preview===true){if(preview.candidateId!==selected.candidateId)throw Error('dock_result_unconfirmed');this.transitionMode='live-thumbnail';this.publish();}
   }
   await this.delay(this.reduced?90:440);check();
   await this.native.request('layout',this.layoutValue);check();const receipt=await this.native.request('attach',{candidateId:selected.candidateId});check();
   if(receipt?.docked!==true||receipt.candidateId!==selected.candidateId)throw Error('dock_result_unconfirmed');
   this.phase='docked';this.publish();return {docked:true,displayMode:'native-window-overlay',nativeConfirmed:true,browserName:this.browserName,automationReady:this.automationReady};
  }catch(error){
   // Same private pipe orders restore after a late attach; never replay attach.
   let restoreError=null;await this.native.request('cancel').catch(cause=>{if(cause.message==='dock_restore_unconfirmed')restoreError=cause;});
   if(restoreError){this.phase='error';this.error=restoreError.message;this.publish();throw restoreError;}
   if(epoch===this.epoch){this.phase=error.message==='dock_cancelled'?'idle':'error';this.error=error.message;this.publish();}throw error;
  }finally{signal?.removeEventListener('abort',abort);if(nonce&&generation===this.external.generation)await this.external.command('windowProofEnd',{nonce}).catch(()=>{});}
 }
 async cancel(){const uncertain=['docked','attaching'].includes(this.phase);this.epoch++;this.contentAbort?.abort();try{await this.native.request('cancel');}catch(error){if(error.message==='dock_restore_unconfirmed'||uncertain){this.phase='error';this.error=error.message;this.publish();return {cancelled:false,restoreUnconfirmed:true};}}this.phase='idle';this.error=null;this.publish();return {cancelled:true};}
 async detach(){this.epoch++;this.phase='detaching';this.publish();try{await this.native.request('detach');this.phase='idle';this.publish();return {detached:true,browserPreserved:true};}catch(error){this.phase='error';this.error=error.message;this.publish();throw error;}}
 async dispose(){this.disposed=true;await this.cancel();await this.operation?.catch(()=>{});await this.native.close();}
}
module.exports={BrowserWindowDock};
