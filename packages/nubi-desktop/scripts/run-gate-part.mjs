import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {expandGateCommands} from './check-gate-coverage.mjs';

// Shared CI runners split the fast gate into two parallel jobs (release plan R1,
// 2026-10-20: Actions 14차 took 21분 37초 in one job). package.json stays the single
// source of the chain; this only partitions the already-parsed leaf commands.
// "unit" is `npm test` (with its pretest builds); "ui" is every other fast command
// in chain order, after the same pretest builds that `npm test` would have run.
export function gateParts(scripts){
 const fast=expandGateCommands(scripts['test:gates:fast'],scripts);
 const unit=fast.filter(command=>command==='npm test'),ui=fast.filter(command=>command!=='npm test');
 if(unit.length!==1)throw Error('gate_unit_missing');
 return {unit,ui:['npm run pretest',...ui]};
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
 if(!['unit','ui'].includes(part))throw Error('usage: node scripts/run-gate-part.mjs <unit|ui> [--list]');
 const {scripts}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 const commands=gateParts(scripts)[part];
 console.log(JSON.stringify({gatePart:part,commands:commands.length}));
 if(list){for(const command of commands)console.log(command);}
 else for(const command of commands){console.log('\n> '+command);await run(command);}
}
