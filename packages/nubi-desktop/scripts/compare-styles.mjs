// Computed-style comparison for CSS refactors (plan 2a). Snapshots are written by check-shared-ui when
// NUBI_STYLE_SNAPSHOT_DIR is set: every element's computed style at each capture. Animation phase is ignored because a
// running animation is sampled at a slightly different moment each run.
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const ANIMATION_PHASE_PROPERTIES=Object.freeze(new Set(['transform','opacity','translate','rotate','scale','offset-distance','background-position','stroke-dashoffset','filter']));
export async function compareStyleSnapshots(beforeDir,afterDir,{ignore=ANIMATION_PHASE_PROPERTIES}={}){
 const changed=[],missing=[],structure=[];
 for(const capture of (await readdir(beforeDir)).filter(name=>name.endsWith('.json')).sort()){
  let after;try{after=JSON.parse(await readFile(path.join(afterDir,capture),'utf8'));}catch{missing.push(capture);continue;}
  const before=JSON.parse(await readFile(path.join(beforeDir,capture),'utf8'));
  if(before.length!==after.length){structure.push({capture,before:before.length,after:after.length});continue;}
  for(let element=0;element<before.length;element++){
   const keys=new Set([...Object.keys(before[element].style),...Object.keys(after[element].style)]);
   for(const property of keys){if(ignore.has(property))continue;const a=before[element].style[property],b=after[element].style[property];if(a!==b)changed.push({capture,element,tag:before[element].tag,property,before:a,after:b});}
  }
 }
 return {changed,missing,structure};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [before,after]=process.argv.slice(2);const result=await compareStyleSnapshots(before,after);
 const summary={changed:result.changed.length,missing:result.missing,structure:result.structure,examples:result.changed.slice(0,15)};
 console.log(JSON.stringify(summary,null,1));process.exitCode=result.changed.length||result.missing.length||result.structure.length?1:0;
}
