import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Parse the deliberately small npm alias grammar without evaluating shell code.
export function expandGateCommands(command,scripts,stack=[]){
 return String(command||'').split(/\s*&&\s*/).filter(Boolean).flatMap(part=>{
  const match=part.match(/^npm run ([\w:-]+)$/);
  if(!match)return [part];
  const name=match[1];if(!Object.hasOwn(scripts,name))throw Error('gate_alias_unknown:'+name);
  if(stack.includes(name))throw Error('gate_alias_cycle:'+[...stack,name].join('>'));
  return expandGateCommands(scripts[name],scripts,[...stack,name]);
 });
}
export function checkGateCoverage(scripts,baseline){
 const fast=expandGateCommands(scripts['test:gates:fast'],scripts),electron=expandGateCommands(scripts['test:gates:electron'],scripts),both=[...fast,...electron];
 const expected=[...baseline.commands,...(baseline.additions||[])],counts=new Map();for(const cmd of both)counts.set(cmd,(counts.get(cmd)||0)+1);
 const missing=expected.filter(cmd=>!counts.has(cmd)),extra=[...counts.keys()].filter(cmd=>!expected.includes(cmd)),duplicates=[...counts].filter(([,n])=>n!==1).map(([cmd])=>cmd);
 const pretestPreserved=scripts.pretest===baseline.pretest;
 const umbrella=String(scripts['test:gates']||'').replace(/^node scripts\/check-gate-coverage.mjs\s*&&\s*/,'');
 const umbrellaPreserved=umbrella==='npm run test:gates:fast && npm run test:gates:electron';
 return {ok:!missing.length&&!extra.length&&!duplicates.length&&pretestPreserved&&umbrellaPreserved,fast,electron,missing,extra,duplicates,pretestPreserved,umbrellaPreserved};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const {scripts}=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));const baseline=JSON.parse(await readFile(new URL('./gate-baseline.json',import.meta.url)));const result=checkGateCoverage(scripts,baseline);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
