import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const inventory=JSON.parse(await readFile('python-tool-lock.json','utf8'));
for(const item of inventory){
  const target=({x64:'x86_64',ia32:'i686'})[item.architecture];
  if(!target||item.version!=='0.12.18'||item.source!==`https://github.com/astral-sh/uv/releases/download/${item.version}/uv-${target}-pc-windows-msvc.zip`)throw new Error('Invalid Python tool lock');
  const response=await fetch(item.source,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error('Python tool download failed');
  const data=new Uint8Array(await response.arrayBuffer());
  if(createHash('sha256').update(data).digest('hex')!==item.sha256)throw new Error('Python tool checksum mismatch');
  const executable=unzipSync(data)['uv.exe'];if(!executable)throw new Error('Missing uv.exe');
  const directory=`dist/runtime/uv/${item.architecture}`;await mkdir(directory,{recursive:true});await writeFile(`${directory}/uv.exe`,executable);
}
await writeFile('dist/runtime/uv/inventory.json',JSON.stringify(inventory,null,2)+'\n');
console.log('Verified pinned Astral uv binaries for x64 and x86 Windows. Python installs only on approved demand.');
