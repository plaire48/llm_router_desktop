import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export async function openTextEditorProcess({onExit=()=>{}}={}){
 if(process.platform!=='win32')throw Error('editor_windows_required');
 const root=fileURLToPath(new URL('./text-editor-bridge/',import.meta.url)).replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2'),manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8').catch(()=>{throw Error('editor_host_missing');}));
 if(manifest.protocol!==1||manifest.file!=='Nubi.TextEditorBridge.exe')throw Error('editor_host_invalid');const exe=path.join(root,manifest.file);if(createHash('sha256').update(await readFile(exe)).digest('hex')!==manifest.sha256)throw Error('editor_host_invalid');
 const child=spawn(exe,[],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']});let ended=false,sequence=0,buffer='',pending,readyResolve,readyReject;const ready=new Promise((res,rej)=>{readyResolve=res;readyReject=rej;});
 const close=()=>{if(ended)return;ended=true;clearTimeout(startTimer);readyReject?.(Error('editor_disconnected'));pending?.reject(Error('editor_response_unconfirmed'));clearTimeout(pending?.timer);child.kill();onExit();};
 const startTimer=setTimeout(close,10000);child.on('error',close);child.on('exit',close);child.stdin.on('error',close);child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>2200000){close();return;}let end;while((end=buffer.indexOf('\n'))>=0){let frame;try{frame=JSON.parse(buffer.slice(0,end));}catch{close();return;}buffer=buffer.slice(end+1);if(frame.type==='ready'&&frame.protocol===1&&readyResolve){clearTimeout(startTimer);readyResolve();readyResolve=null;readyReject=null;}else if(pending&&frame.id===pending.id){const p=pending;pending=null;clearTimeout(p.timer);frame.error?p.reject(Error(/^editor_[a-z_]+$/.test(frame.error)?frame.error:'editor_native_failed')):p.resolve(frame.result);}else{close();return;}}});await ready;
 return {close,isAlive:()=>!ended,call(method,args={}){if(ended||pending)return Promise.reject(Error('editor_disconnected'));if(!['list','bind','inspect','replace'].includes(method))return Promise.reject(Error('editor_method_invalid'));const id=randomUUID(),message=JSON.stringify({id,sequence:sequence+1,method,args});if(message.length>2200000)return Promise.reject(Error('editor_text_limit'));sequence++;return new Promise((resolve,reject)=>{pending={id,resolve,reject,timer:setTimeout(close,15000)};child.stdin.write(message+'\n',error=>{if(error)close();});});}};
}
