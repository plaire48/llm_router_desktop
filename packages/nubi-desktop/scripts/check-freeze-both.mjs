import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export async function runFreezeEnvironments(run){
 const results=[];
 for(const mode of ['browser','electron']){let code;try{code=await run(mode);}catch{code=1;}results.push({mode,code});}
 return {results,exitCode:results.some(r=>r.code!==0&&r.code!==2)?1:results.some(r=>r.code===2)?2:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const result=await runFreezeEnvironments(mode=>new Promise(resolve=>{
  const child=spawn(process.execPath,['scripts/check-freeze-scenes.mjs',...(mode==='electron'?['--electron']:[])],{stdio:'inherit',env:process.env});
  child.on('error',()=>resolve(1));child.on('exit',code=>resolve(code??1));
 }));
 const tag=process.env.FREEZE_TAG||'';if(!/^[a-z0-9-]*$/.test(tag))throw Error('invalid tag');
 const dir=path.resolve('verification/freeze-1.3.0',tag);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'both.json'),JSON.stringify(result,null,2));
 console.log('Chrome and isolated Electron:',JSON.stringify(result));process.exitCode=result.exitCode;
}
