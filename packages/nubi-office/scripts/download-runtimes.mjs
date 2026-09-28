import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const lock=JSON.parse(await readFile('runtime-lock.json','utf8')),inventory=[];
for(const entry of lock) {
  const {architecture:arch,archive:name,sha256:expected,source}=entry;
  if(!source.startsWith('https://nodejs.org/dist/v22.')||!['x64','x86'].includes(arch))throw new Error('Invalid runtime lock');
  const response=await fetch(source);if(!response.ok)throw new Error('Runtime download failed');
  const bytes=new Uint8Array(await response.arrayBuffer()),actual=createHash('sha256').update(bytes).digest('hex');if(actual!==expected)throw new Error('Runtime checksum mismatch');
  const files=unzipSync(bytes),prefix=name.slice(0,-4);await mkdir(`dist/runtime/${arch}`,{recursive:true});
  for(const file of ['node.exe','LICENSE']) {if(!files[`${prefix}/${file}`])throw new Error('Incomplete runtime');await writeFile(`dist/runtime/${arch}/${file}`,files[`${prefix}/${file}`]);}
  inventory.push(entry);
}
await writeFile('dist/runtime/inventory.json',JSON.stringify(inventory,null,2)+'\n');console.log('Verified official Node runtimes:',inventory.map(i=>i.archive).join(', '));
