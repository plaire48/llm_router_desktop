const {spawn}=require('node:child_process');
const {readFile}=require('node:fs/promises');
const {createHash,randomUUID}=require('node:crypto');
const path=require('node:path');
// Executable is a packaged, hash-checked private child. No shell, port or arbitrary commands.
class BrowserWindowNative {
 constructor({directory,parent,onEvent=()=>{},platform=process.platform,spawnProcess=spawn}){Object.assign(this,{directory,parent,onEvent,platform,spawnProcess});this.pending=new Map();this.child=null;this.starting=null;}
 async start(executable){if(this.platform!=='win32')throw Error('external_browser_windows_required');if(this.child)return;if(this.starting)return this.starting;
  this.executable=executable;this.starting=this.launch(executable);try{await this.starting;}finally{this.starting=null;}
 }
 async launch(executable){
  const manifest=JSON.parse(await readFile(path.join(this.directory,'manifest.json'),'utf8'));
  if(manifest.protocol!==1||manifest.file!=='Nubi.BrowserWindowBridge.exe')throw Error('dock_helper_invalid');
  const file=path.join(this.directory,manifest.file),bytes=await readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('dock_helper_invalid');
  const child=this.spawnProcess(file,[],{windowsHide:true,stdio:['pipe','pipe','ignore'],shell:false});this.child=child;let buffer='';
  const ready=new Promise((resolve,reject)=>{this.ready={resolve,reject};});
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>65536){child.stdin.end();this.fail(Error('dock_helper_protocol'));return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const packet=JSON.parse(line);if(packet.type==='ready'&&packet.protocol===1){this.ready?.resolve();this.ready=null;}else if(packet.id){const pending=this.pending.get(packet.id);if(pending){this.pending.delete(packet.id);clearTimeout(pending.timer);packet.error?pending.reject(Error(packet.error)):pending.resolve(packet.result);}}else if(packet.type==='restoreRecord')this.recovery=packet;else if(packet.type==='restored')this.recovery=null;else if(packet.type){if(packet.type==='released')this.recovery=null;this.onEvent(packet);}}catch{this.fail(Error('dock_helper_protocol'));}}});
  child.stdin.on('error',()=>this.fail(Error('dock_helper_disconnected')));child.once('error',()=>this.fail(Error('dock_helper_unavailable')));child.once('exit',()=>{if(this.child===child){this.child=null;this.fail(Error('dock_helper_disconnected'));if(!this.closing)this.onEvent({type:'disconnected'});}});
  let timer;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('dock_helper_timeout')),5000);})]);const handle=this.parent.getNativeWindowHandle();await this.request('init',{parent:(handle.length>=8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString(),parentPid:process.pid,executable});}catch(error){child.stdin.end();throw error;}finally{clearTimeout(timer);}
 }
 fail(error){this.ready?.reject(error);this.ready=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
 request(action,args={}){if(!this.child?.stdin.writable)return Promise.reject(Error('dock_helper_unavailable'));const id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('dock_result_unconfirmed'));},3000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,action,args})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('dock_helper_disconnected'));}});});}
 async recover(){if(!this.recovery)return;const record=this.recovery;await this.start(this.executable);await this.request('recover',record);this.recovery=null;}
 async close(){const child=this.child;if(!child)return;this.closing=true;try{await this.request('shutdown');}finally{child.stdin.end();if(child.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(resolve,1500);child.once('exit',()=>{clearTimeout(timer);resolve();});});if(this.child===child)this.child=null;this.closing=false;}}
}
module.exports={BrowserWindowNative};
