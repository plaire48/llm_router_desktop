import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,chmod,rename,rm,copyFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import tls from 'node:tls';
import {unzipSync} from 'fflate';
const base=fileURLToPath(new URL('../',import.meta.url));
const release=JSON.parse(await readFile(new URL('../runtime/opencode-engine-release.json',import.meta.url),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function prepareOpenCodeEngine({platform=process.platform,arch=process.arch,output=path.join(base,'generated/opencode-engine')}={}){
 const target=platform+'-'+arch,asset=release.targets[target];if(!asset)throw Error('coding_engine_platform_unavailable');
 const directory=path.join(output,target),executable=platform==='win32'?'opencode.exe':'opencode',destination=path.join(directory,executable);
 try{const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));if(manifest.version===release.version&&manifest.archiveSha256===asset.sha256&&manifest.target===target&&digest(await readFile(destination))===manifest.binarySha256)return {directory,...manifest};}catch{}
 const cache=path.join(base,'generated/opencode-downloads'),archive=path.join(cache,asset.archive);await mkdir(cache,{recursive:true});
 let bytes;try{bytes=await readFile(archive);if(bytes.length!==asset.size||digest(bytes)!==asset.sha256)bytes=null;}catch{}
 if(!bytes){
  if(tls.getCACertificates&&tls.setDefaultCACertificates)tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'),...tls.getCACertificates('system')])]);
  const response=await fetch(`${release.repository}/releases/download/v${release.version}/${asset.archive}`,{signal:AbortSignal.timeout(120000)});if(!response.ok||Number(response.headers.get('content-length')||asset.size)!==asset.size)throw Error('coding_engine_download_failed');
  const partial=archive+'.'+process.pid+'.part';try{await pipeline(Readable.fromWeb(response.body),createWriteStream(partial,{flags:'wx'}));bytes=await readFile(partial);if(bytes.length!==asset.size||digest(bytes)!==asset.sha256)throw Error('coding_engine_archive_mismatch');await rename(partial,archive);}finally{await rm(partial,{force:true});}
 }
 const staging=directory+'.'+process.pid+'.tmp';await mkdir(staging,{recursive:true});
 try{
  if(asset.archive.endsWith('.zip')){
   const entries=unzipSync(bytes,{filter:entry=>entry.name===executable&&entry.originalSize<=700*1024*1024});if(!entries[executable])throw Error('coding_engine_binary_missing');await writeFile(path.join(staging,executable),entries[executable]);
  }else await promisify(execFile)('tar',['-xzf',archive,'-C',staging,executable],{shell:false});
  if(platform!=='win32')await chmod(path.join(staging,executable),0o755);
  const manifest={id:'opencode',version:release.version,commit:release.commit,target,archive:asset.archive,archiveSha256:asset.sha256,binarySha256:digest(await readFile(path.join(staging,executable))),executable,license:'MIT',source:release.repository};
  await copyFile(new URL('../vendor/licenses/opencode-LICENSE.txt',import.meta.url),path.join(staging,'LICENSE.txt'));await writeFile(path.join(staging,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await mkdir(output,{recursive:true});await rm(directory,{recursive:true,force:true});await rename(staging,directory);return {directory,...manifest};
 }finally{await rm(staging,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await prepareOpenCodeEngine()));
