import {execFileSync} from 'node:child_process';
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
if(process.platform!=='win32'||process.arch!=='x64')throw Error('windows_process_host_build_required');
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'generated/process-host');
let compiler;
for(const directory of ['Framework64','Framework']){
 const candidate=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET',directory,'v4.0.30319/csc.exe');
 try{await access(candidate);compiler=candidate;break;}catch{}
}
if(!compiler)throw Error('windows_framework_compiler_missing');
await mkdir(output,{recursive:true});
const file='Nubi.ProcessHost.exe';
execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+path.join(output,file),path.join(root,'native/ProcessHost.cs')],{stdio:'inherit',windowsHide:true});
const sha256=createHash('sha256').update(await readFile(path.join(output,file))).digest('hex');
await writeFile(path.join(output,'manifest.json'),JSON.stringify({version:1,file,sha256})+'\n');
console.log('Built owned Windows command process host');
