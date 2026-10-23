import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {PNG} from 'pngjs';
import {POWERSHELL_TEXT_ARGS,POWERSHELL_UTF8_PREFIX} from './powershell-encoding.mjs';

const changed=()=>{throw Error('app_capture_changed');};
const box=b=>b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0&&b.width*b.height<=20000000;
const binding=b=>b&&Number.isSafeInteger(b.hwnd)&&b.hwnd>0&&Number.isSafeInteger(b.processId)&&b.processId>0&&typeof b.started==='string'&&/^\d{1,24}$/.test(b.started)&&typeof b.title==='string'&&b.title.length<=500&&typeof b.processName==='string'&&b.processName.length<=200&&box(b.bounds);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const check=signal=>signal?.throwIfAborted();

// Same STA/UTF-8 child transport as the existing UIA mail reader. Only discovery,
// UIA metadata and PrintWindow are implemented in the bundled script. No input.
export async function readAppScreen(request,{signal,platform=process.platform,timeoutMs=15000}={}){
  if(platform!=='win32')throw Error('app_capture_windows');check(signal);
  const script=POWERSHELL_UTF8_PREFIX+await readFile(new URL('./app-screen-capture.ps1',import.meta.url),'utf8');check(signal);
  const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE'])if(process.env[key])env[key]=process.env[key];
  const executable=path.win32.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,[...POWERSHELL_TEXT_ARGS,'-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env});
    const chunks=[];let size=0,failure;
    const stop=code=>{failure ||=code;child.kill();},abort=()=>stop('cancelled');
    const timer=setTimeout(()=>stop('app_capture_timeout'),timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>12*1024*1024)stop('app_capture_limit');else chunks.push(chunk);});
    child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',()=>{failure ||= 'app_capture_unavailable';});
    child.once('close',code=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(failure)return reject(Error(failure));
      try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));if(code||value.error)throw Error(/^app_capture_[a-z_]+$/.test(value.error||'')?value.error:'app_capture_unavailable');resolve(value);}catch(error){reject(Error(/^app_capture_[a-z_]+$/.test(error.message)?error.message:'app_capture_unavailable'));}
    });
    // The worker's parent owns Nubi's native windows. Its protected browser/auth
    // surfaces must keep using the existing Workspace capture admission policy.
    child.stdin.end(JSON.stringify({...request,excludedProcessIds:[process.pid,process.ppid]}));
  });
}

// IDs live in one agent run. Models never supply HWNDs, coordinates or scripts.
export class AppScreenCapture{
  constructor({platform=process.platform,read=readAppScreen,now=Date.now}={}){Object.assign(this,{platform,read,now});this.windows=new Map();this.elements=new Map();}
  available(){return this.platform==='win32';}
  valid(id){const entry=this.windows.get(id);if(!entry||this.now()-entry.at>120000)changed();return entry;}
  async find({windowQuery,controlQuery},signal){
    if(!this.available())throw Error('app_capture_windows');
    for(const value of [windowQuery,controlQuery])if(value!==undefined&&(typeof value!=='string'||!value.trim()||value.length>200))throw Error('app_capture_invalid');
    if(!windowQuery)throw Error('app_capture_invalid');check(signal);
    const discovery=await this.read({action:'discover',query:windowQuery.trim()},{signal,platform:this.platform});check(signal);
    if(!Array.isArray(discovery.windows)||discovery.windows.length>10||discovery.windows.some(w=>!binding(w)))throw Error('app_capture_contract');
    const windows=[];
    for(const window of discovery.windows){
      if([process.pid,process.ppid].includes(window.processId))continue;
      const id=randomUUID();this.windows.set(id,{window,at:this.now()});
      const result={windowId:id,title:window.title,app:window.processName};
      if(controlQuery){
        const tree=await this.read({action:'inspect',window,query:controlQuery.trim()},{signal,platform:this.platform});check(signal);
        if(!same(tree.window,window)||!Array.isArray(tree.elements)||tree.elements.length>20)throw Error('app_capture_contract');
        result.elements=tree.elements.map(element=>{
          if(!element||typeof element.runtimeId!=='string'||!/^\d+(?:,-?\d+)*$/.test(element.runtimeId)||element.runtimeId.length>200||element.password!==false||!box(element.bounds)||typeof element.name!=='string'||element.name.length>500||typeof element.type!=='string'||element.type.length>100||typeof element.automationId!=='string'||element.automationId.length>500)throw Error('app_capture_contract');
          const elementId=randomUUID();this.elements.set(elementId,{windowId:id,element});return {elementId,name:element.name,type:element.type};
        });
        result.partial=tree.partial===true;
      }
      windows.push(result);
    }
    // Discard expired IDs and bound memory even during long agent runs.
    for(const [id,item] of this.windows)if(this.now()-item.at>120000||this.windows.size>80)this.windows.delete(id);
    for(const [id,item] of this.elements)if(!this.windows.has(item.windowId))this.elements.delete(id);
    return {windows,partial:discovery.partial===true,coverage:{scope:'visible_windows_and_uia_controls',complete:false},readOnly:true,instruction:windows.length>1?'Choose the window matching the user request; ask if ambiguous. Never guess a control or infer unseen contents.':'Capture the returned windowId, or an elementId from this result. Empty matches are not evidence that a control does not exist.'};
  }
  async capture({windowId,elementId,maxWidth=1600},signal){
    if(!this.available())throw Error('app_capture_windows');check(signal);
    if(!Number.isInteger(maxWidth)||maxWidth<128||maxWidth>2400)throw Error('app_capture_invalid');
    const entry=this.valid(windowId),target=elementId?this.elements.get(elementId):null;
    if(elementId&&target?.windowId!==windowId)changed();
    const value=await this.read({action:'capture',window:entry.window,...(target?{element:target.element}:{}),maxWidth},{signal,platform:this.platform});check(signal);this.valid(windowId);
    if(!same(value.window,entry.window)||(target&&!same(value.element,target.element)))changed();
    if(typeof value.image!=='string'||value.image.length>8*1024*1024*4/3||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.image)||!Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<1||value.height<1||value.width>maxWidth||value.width*value.height>8000000)throw Error('app_capture_contract');
    let png;try{const bytes=Buffer.from(value.image,'base64');if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==value.width||bytes.readUInt32BE(20)!==value.height)throw Error();png=PNG.sync.read(bytes);}catch{throw Error('app_capture_contract');}
    if(png.width!==value.width||png.height!==value.height)throw Error('app_capture_contract');
    return {image:value.image,width:value.width,height:value.height,title:entry.window.title,...(target?{clip:{...target.element.bounds}}:{}),source:'windows-uia-printwindow',passwordsMasked:value.passwordsMasked===true};
  }
}
