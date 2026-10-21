import {readFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {expandGateCommands} from './check-gate-coverage.mjs';

// Keep the fast chain as the authority. Unit files are divided by filename,
// with the same Node flags and pretest in each isolated CI job.
export function gateParts(scripts,testFiles=[]){
 const fast=expandGateCommands(scripts['test:gates:fast'],scripts);
 if(fast.filter(command=>command==='npm test').length!==1)throw Error('gate_unit_missing');
 const match=/^(node --test(?: --[a-z-]+(?:=[\w-]+)?)*) tests\/\*\.test\.mjs$/.exec(scripts.test||'');
 if(!match)throw Error('gate_unit_script');
 const files=[...new Set(testFiles.filter(name=>name.endsWith('.test.mjs')))].sort();
 if(files.some(name=>!/^[a-zA-Z0-9_.-]+\.test\.mjs$/.test(name)))throw Error('gate_unit_filename');
 if(files.length<2)throw Error('gate_unit_files');
 const mid=Math.ceil(files.length/2),unit=names=>['npm run pretest',match[1]+' '+names.map(name=>'tests/'+name).join(' ')];
 return {'unit-a':unit(files.slice(0,mid)),'unit-b':unit(files.slice(mid)),ui:['npm run pretest',...fast.filter(command=>command!=='npm test')]};
}
function run(command){
 return new Promise((resolve,reject)=>{
  const [file,...args]=command.split(/\s+/);
  const child=spawn(file,args,{stdio:'inherit',env:process.env});
  child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(Object.assign(Error('gate_failed'),{command,code,signal})));
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const part=process.argv[2],list=process.argv.includes('--list');
 if(!['unit-a','unit-b','ui'].includes(part))throw Error('usage: node scripts/run-gate-part.mjs <unit-a|unit-b|ui> [--list]');
 const {scripts}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const commands=gateParts(scripts,await readdir(new URL('../tests/',import.meta.url)))[part];
 console.log(JSON.stringify({gatePart:part,commands:commands.length}));
 if(list){for(const command of commands)console.log(command);}
 else for(const command of commands){console.log('\n> '+command);await run(command);}
}
