// CSS diet measurements (plan 2a, design light-flow §6): first-paint CSS bytes, bytes per source file, and how many
// selectors every element has to check. Chromium indexes a rule by the rightmost compound selector's id, class or tag;
// a rightmost compound with none of those (:is(), *, an attribute, :root) is checked against every element.
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {rendererBundleOptions} from './renderer-bundle.mjs';

function splitTop(text,separators){
 const parts=[];let depth=0,start=0;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(depth===0&&separators.test(c)){parts.push(text.slice(start,i));start=i+1;}}
 parts.push(text.slice(start));return parts.map(p=>p.trim()).filter(Boolean);
}
// Style rule preludes, skipping at-rule preludes and the inside of @keyframes.
export function styleSelectors(css){
 const clean=css.replace(/\/\*[\s\S]*?\*\//g,''),out=[],stack=[];let buffer='';
 for(const c of clean){
  if(c==='{'){const prelude=buffer.trim();buffer='';const inKeyframes=stack.includes('keyframes');
   const kind=prelude.startsWith('@')?(/^@(-webkit-)?keyframes/.test(prelude)?'keyframes':'at'):'style';
   if(kind==='style'&&!inKeyframes)out.push(...splitTop(prelude,/,/));stack.push(kind);}
  else if(c==='}'){stack.pop();buffer='';}
  else if(c===';'&&!stack.length){buffer='';}
  else buffer+=c;
 }
 return out;
}
export function rightmostKey(selector){
 const compounds=splitTop(selector.replace(/\s*([>+~])\s*/g,' '),/\s/);
 const last=(compounds.at(-1)||'').replace(/\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g,'').replace(/\[[^\]]*\]/g,'').replace(/::?[\w-]+/g,'');
 if(/#[\w-]/.test(last))return 'id';if(/\.[\w-]/.test(last))return 'class';if(/^[a-z][\w-]*/i.test(last))return 'tag';return 'universal';
}
export function selectorBuckets(css){
 const selectors=styleSelectors(css),counts={classKeyed:0,tagKeyed:0,idKeyed:0,universal:0},universalSamples=[];
 for(const selector of selectors){const key=rightmostKey(selector);if(key==='universal'){counts.universal++;if(universalSamples.length<40)universalSamples.push(selector);}else counts[key+'Keyed']++;}
 return {selectors:selectors.length,...counts,universalSamples};
}
export function cssReport({metafile,main,css}){
 const outputs=metafile.outputs,mainOutput=outputs[main];
 const chunkBytes=Object.entries(outputs).filter(([name])=>name!==main&&name.endsWith('.css')).reduce((sum,[,o])=>sum+o.bytes,0);
 const bySource=Object.fromEntries(Object.entries(mainOutput.inputs).filter(([,i])=>i.bytesInOutput>0).sort((a,b)=>b[1].bytesInOutput-a[1].bytesInOutput).map(([name,i])=>[name,i.bytesInOutput]));
 return {mainBytes:mainOutput.bytes,chunkBytes,bySource,buckets:selectorBuckets(css)};
}
// CLI: the production renderer build (minified, as build-electron.mjs makes it), measured in a temporary directory.
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const outIndex=process.argv.indexOf('--out'),target=outIndex>0?process.argv[outIndex+1]:null;
 const outdir=await mkdtemp(path.join(os.tmpdir(),'nubi-css-report-'));
 try{
  const result=await build({...rendererBundleOptions(),outdir,minify:true,metafile:true,logLevel:'silent'});
  const main=Object.keys(result.metafile.outputs).find(name=>/renderer\.css$/.test(name));
  const report=cssReport({metafile:result.metafile,main,css:await readFile(main,'utf8')});
  const summary={mainBytes:report.mainBytes,chunkBytes:report.chunkBytes,buckets:{...report.buckets,universalSamples:report.buckets.universalSamples.slice(0,15)},topSources:Object.entries(report.bySource).slice(0,20)};
  if(target){await mkdir(path.dirname(target),{recursive:true});await writeFile(target,JSON.stringify({...report,measuredAt:new Date().toISOString()},null,1));}
  console.log(JSON.stringify(summary,null,1));
 }finally{await rm(outdir,{recursive:true,force:true});}
}
