const {readFile,writeFile,mkdir}=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {httpBrowserAddress}=require('../runtime/browser-address.cjs');

class BrowserLaunch {
 constructor({storage,dialog,shell,parent,platform=process.platform,launch=spawn}){Object.assign(this,{storage,dialog,shell,parent,platform,launch});this.preference={mode:'external',executable:null};}
 async load(){try{const saved=JSON.parse(await readFile(path.join(this.storage,'browser-preference.json'),'utf8'));if(['external','internal'].includes(saved.mode))this.preference={mode:saved.mode,executable:typeof saved.executable==='string'&&path.isAbsolute(saved.executable)?saved.executable:null};}catch{}return this.status();}
 status(){return {mode:this.preference.mode,configured:!!this.preference.executable,windowsRequired:this.platform!=='win32',browser:'External Browser'};}
 async select(){
  if(this.platform!=='win32')throw Error('external_browser_windows_required');
  const result=await this.dialog.showOpenDialog(this.parent,{title:'브라우저 실행 파일 선택',properties:['openFile'],filters:[{name:'Browser',extensions:['exe']}]});
  if(result.canceled)return {cancelled:true,...this.status()};
  const file=result.filePaths[0];if(!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.exe')throw Error('external_browser_executable_invalid');
  // An exact user-selected executable; never guesses a profile, changes launch
  // flags, enables debugging, or uses the shell to interpret a URL.
  this.preference={mode:'external',executable:file};await this.save();return this.status();
 }
 async mode(mode){if(!['external','internal'].includes(mode))throw Error('browser_action_invalid');const next={...this.preference,mode};await this.save(next);this.preference=next;return this.status();}
 async save(preference=this.preference){await mkdir(this.storage,{recursive:true});await writeFile(path.join(this.storage,'browser-preference.json'),JSON.stringify(preference),{mode:0o600});}
 async open(value,{executable=this.preference.executable}={}){
  const url=httpBrowserAddress(value);
  if(!executable){try{await this.shell.openExternal(url);}catch{throw Error('external_browser_launch_failed');}return {opened:true,external:true,automation:false,loginSession:'system-default-browser',userInteractionRequired:true};}
  if(this.platform!=='win32')throw Error('external_browser_windows_required');
  if(!path.win32.isAbsolute(executable)||path.win32.extname(executable).toLowerCase()!=='.exe')throw Error('external_browser_executable_invalid');
  await new Promise((resolve,reject)=>{const child=this.launch(executable,[url],{shell:false,detached:true,stdio:'ignore'});child.once('error',()=>reject(Error('external_browser_launch_failed')));child.once('spawn',()=>{child.unref();resolve();});});
  return {opened:true,external:true,automation:false,loginSession:'original-browser',userInteractionRequired:true};
 }
}
module.exports={BrowserLaunch};
