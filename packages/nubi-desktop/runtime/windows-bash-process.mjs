import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function windowsBashProcess(executable,args,{roots=[new URL('./process-host/',import.meta.url),new URL('../generated/process-host/',import.meta.url)]}={}){
 for(const root of roots){
  let manifest;
  try{manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw Error('process_host_invalid');}
  if(manifest.version!==1||manifest.file!=='Nubi.ProcessHost.exe'||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('process_host_invalid');
  const file=fileURLToPath(new URL(manifest.file,root)).replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2'),bytes=await readFile(file);
  if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('process_host_invalid');
  return {executable:file,args:[executable,...args]};
 }
 throw Error('process_host_missing');
}
