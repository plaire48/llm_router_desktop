import {cp, mkdir, rm, readFile, writeFile, readdir, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openSync,writeSync,closeSync} from 'node:fs';
import {Zip,ZipDeflate} from 'fflate';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const {version}=JSON.parse(await readFile('package.json','utf8')), name=`nubi-office-${version}-review`;
const stage=resolve('releases',name);await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
for(const entry of ['dist/web/taskpane.html','dist/worker/main.mjs','dist/worker/script-thread.mjs','dist/worker/skills/excel-2016/references/calculations.md','dist/node_modules/quickjs-emscripten-core/dist/index.mjs','dist/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm','dist/node_modules/@earendil-works/pi-agent-core/package.json','dist/runtime/x64/node.exe','dist/runtime/x86/node.exe','native/Nubi.Office.Host/bin/Release/net472/Nubi.Office.Host.dll']) await stat(entry);
const excluded=new Set(['.git','bin','obj','packages','node_modules']);
for(const entry of ['README.md','AGENTS.md','THIRD-PARTY-NOTICES.md','package.json','package-lock.json','runtime-lock.json','docs','scripts','src','worker','eval','tests','licenses','verification','native','vendor','dist']) {
  const base=resolve(entry);
  await cp(base,resolve(stage,entry),{recursive:true,filter:path=>{
    const parts=relative(base,path).split(sep);
    if(entry!=='dist'&&parts.some(p=>excluded.has(p))) return false;
    return !/\.(?:pfx|p12|key)$/i.test(path)&&!parts.some(p=>p==='.env'||p.startsWith('.env.'));
  }});
}
await cp('native/Nubi.Office.Host/bin/Release/net472',resolve(stage,'compiled-host'),{recursive:true});
await cp('native/Nubi.Office.EvalHost/bin/Release/net472',resolve(stage,'native/Nubi.Office.EvalHost/bin/Release/net472'),{recursive:true});
await writeFile(resolve(stage,'BUILD-STATUS.txt'),'Review/build package only. Not a signed Windows installer. Native host cross-compiled; Windows VSTO, real Excel COM and live provider authentication remain unverified. See README.md.\n');
const files=[];
async function inventory(dir){for(const ent of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,ent.name);if(ent.isDirectory())await inventory(path);else files.push({path:relative(stage,path).split(sep).join('/'),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}}
await inventory(stage);await writeFile(resolve(stage,'CHECKSUMS.json'),JSON.stringify(files,null,2)+'\n');
const zip=resolve('releases',name+'.zip');await rm(zip,{force:true});
// Explicit UTF-8 ZIP headers preserve Korean file names in Windows extractors.
const fd=openSync(zip,'w');
try {
  const archive=new Zip((error,chunk)=>{if(error)throw error;writeSync(fd,chunk);});
  for(const file of [...files,{path:'CHECKSUMS.json'}]){const entry=new ZipDeflate(name+'/'+file.path,{level:6});archive.add(entry);entry.push(await readFile(resolve(stage,file.path)),true);}
  archive.end();
} finally {closeSync(fd);}
const hash=createHash('sha256').update(await readFile(zip)).digest('hex');await writeFile(zip+'.sha256',hash+'  '+name+'.zip\n');
console.log(JSON.stringify({file:zip,sha256:hash,files:files.length,windowsInstaller:false},null,2));
