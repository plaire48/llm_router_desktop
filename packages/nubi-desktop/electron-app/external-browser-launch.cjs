const {readFile,writeFile,mkdir}=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {httpBrowserAddress}=require('../runtime/browser-address.cjs');
const {samsungInstallation}=require('./samsung-browser-discovery.cjs');

class BrowserLaunch {
 constructor({storage,dialog,shell,parent,platform=process.platform,launch=spawn,resolveSamsung=samsungInstallation}){Object.assign(this,{storage,dialog,shell,parent,platform,launch,resolveSamsung});this.preference={mode:'external',browser:platform==='win32'?'samsung':'system',executable:null};}
 async load(){let migrate=this.platform==='win32';try{const saved=JSON.parse(await readFile(path.join(this.storage,'browser-preference.json'),'utf8'));migrate=this.platform==='win32'&&!saved.browser;if(!migrate&&['external','internal'].includes(saved.mode))this.preference={mode:saved.mode,browser:['samsung','custom','system'].includes(saved.browser)?saved.browser:this.preference.browser,executable:typeof saved.executable==='string'&&(this.platform==='win32'?path.win32:path).isAbsolute(saved.executable)?saved.executable:null};}catch{}if(migrate)await this.save();return this.status();}
 status(){return {mode:this.preference.mode,configured:!!(this.preference.executable||this.samsungDiscovery?.value?.executable),windowsRequired:this.platform!=='win32',targetBrowser:this.preference.browser,browser:this.preference.browser==='samsung'?'Samsung Browser':'External Browser'};}
 async samsung(){
  if(!this.samsungDiscovery||this.samsungDiscovery.expires<=Date.now()){
   const entry={expires:Infinity};this.samsungDiscovery=entry;entry.promise=Promise.resolve().then(()=>this.resolveSamsung()).then(value=>{if(!value?.executable)throw Error('browser_samsung_unavailable');entry.value=value;entry.expires=Date.now()+30000;return value;}).catch(error=>{if(this.samsungDiscovery===entry)this.samsungDiscovery=null;throw error;});
  }
  return this.samsungDiscovery.promise;
 }
 async select(){
  if(this.platform!=='win32')throw Error('external_browser_windows_required');
  const result=await this.dialog.showOpenDialog(this.parent,{title:'브라우저 실행 파일 선택',properties:['openFile'],filters:[{name:'Browser',extensions:['exe']}]});
  if(result.canceled)return {cancelled:true,...this.status()};
  const file=result.filePaths[0];if(!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.exe')throw Error('external_browser_executable_invalid');
  // An exact user-selected executable; never guesses a profile, changes launch
  // flags, enables debugging, or uses the shell to interpret a URL.
  this.preference={mode:'external',browser:'custom',executable:file};await this.save();return this.status();
 }
 async mode(mode){if(!['external','internal'].includes(mode))throw Error('browser_action_invalid');const next={...this.preference,mode};await this.save(next);this.preference=next;return this.status();}
 async save(preference=this.preference){await mkdir(this.storage,{recursive:true});await writeFile(path.join(this.storage,'browser-preference.json'),JSON.stringify(preference),{mode:0o600});}
 async connectionSettings(){
  const url='chrome://inspect/#remote-debugging';
  const executable=this.platform==='darwin'?'/usr/bin/open':this.platform==='win32'?this.preference.executable||(await this.samsung()).executable:'google-chrome';
  if(!executable)throw Error('browser_samsung_unavailable');
  const args=this.platform==='darwin'?['-a','Google Chrome',url]:[url];
  await new Promise((resolve,reject)=>{const child=this.launch(executable,args,{shell:false,detached:true,stdio:'ignore'});child.once('error',()=>reject(Error('browser_chrome_unavailable')));child.once('spawn',()=>{child.unref();resolve();});});return {opened:true};
 }
 async open(value,{executable=this.preference.executable}={}){
  const url=httpBrowserAddress(value);
  if(!executable&&this.platform==='win32'&&this.preference.browser==='samsung')executable=(await this.samsung()).executable;
  if(!executable){try{await this.shell.openExternal(url);}catch{throw Error('external_browser_launch_failed');}return {opened:true,external:true,automation:false,loginSession:'system-default-browser',userInteractionRequired:true};}
  if(this.platform!=='win32')throw Error('external_browser_windows_required');
  if(!path.win32.isAbsolute(executable)||path.win32.extname(executable).toLowerCase()!=='.exe')throw Error('external_browser_executable_invalid');
  await new Promise((resolve,reject)=>{const child=this.launch(executable,[url],{shell:false,detached:true,stdio:'ignore'});child.once('error',()=>reject(Error('external_browser_launch_failed')));child.once('spawn',()=>{child.unref();resolve();});});
  return {opened:true,external:true,automation:false,loginSession:'original-browser',userInteractionRequired:true};
 }
}
module.exports={BrowserLaunch};
