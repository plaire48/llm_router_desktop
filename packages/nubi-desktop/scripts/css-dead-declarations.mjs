// Plan 2a task 4: declarations that a later rule with the identical selector, in the same conditions, always overrides.
// Order is the global cascade order of the first-paint stylesheet (esbuild metafile input order for renderer.css).
// Conservative: declarations inside one rule are never touched (they may be deliberate fallbacks), a later vendor-prefixed
// value never kills anything, shorthands and longhands are different properties, and an earlier !important survives a
// later normal declaration. The CX vendor stylesheet is read for order only and never edited.
import postcss from 'postcss';
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {rendererBundleOptions} from './renderer-bundle.mjs';

function normalizeSelector(selector){
 let out='',depth=0;
 for(const c of selector.replace(/\s+/g,' ')){if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;out+=depth===0&&'>+~'.includes(c)?' '+c+' ':c;}
 return out.replace(/\s+/g,' ').trim();
}
const conditions=node=>{const path=[];for(let p=node.parent;p&&p.type!=='root';p=p.parent)if(p.type==='atrule')path.unshift('@'+p.name+' '+p.params.replace(/\s+/g,' '));return path.join(' / ');};
function analyze(files){
 const seen=new Map(),dead=[];
 for(const file of files){
  file.root=postcss.parse(file.css,{from:file.path});
  file.root.walkRules(rule=>{
   if(rule.parent?.type==='atrule'&&/keyframes$/i.test(rule.parent.name))return;
   const key=conditions(rule)+' | '+rule.selectors.map(normalizeSelector).join(', ');
   const declarations=rule.nodes.filter(node=>node.type==='decl');
   const earlier=seen.get(key)||[];
   for(const later of declarations){
    if(/-(webkit|moz|ms)-/.test(later.value))continue;
    for(const entry of earlier){
     if(entry.rule===rule)continue;
     for(const decl of entry.declarations){if(decl.prop!==later.prop||decl.deadMark)continue;if(decl.important&&!later.important)continue;
      decl.deadMark=true;dead.push({path:entry.file.path,line:decl.source?.start?.line,selector:rule.selectors.map(normalizeSelector).join(', '),property:decl.prop,killedBy:file.path+':'+(later.source?.start?.line??'?'),decl,file:entry.file});}
    }
   }
   earlier.push({file,rule,declarations});seen.set(key,earlier);
  });
 }
 return dead;
}
export function deadDeclarations(files){
 return analyze(files.map(f=>({...f}))).map(({decl,file,...row})=>row);
}
export function removeDeadDeclarations(files,{readOnly=()=>false}={}){
 const copies=files.map(f=>({...f})),dead=analyze(copies),changed={};
 for(const row of dead){if(readOnly(row.file.path))continue;const rule=row.decl.parent;row.decl.remove();if(rule.nodes.length===0)rule.remove();changed[row.file.path]=row.file;}
 return Object.fromEntries(Object.values(changed).map(file=>{file.root.walkAtRules(at=>{if(at.nodes&&at.nodes.length===0)at.remove();});return [file.path,file.root.toString()];}));
}
// CLI: --fix rewrites app stylesheets (never node_modules) in the order of the production renderer.css.
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const outdir=await mkdtemp(path.join(os.tmpdir(),'nubi-css-order-'));
 try{
  const result=await build({...rendererBundleOptions(),outdir,minify:true,metafile:true,logLevel:'silent'});
  const main=Object.keys(result.metafile.outputs).find(name=>/renderer\.css$/.test(name));
  const order=Object.keys(result.metafile.outputs[main].inputs).filter(input=>input.endsWith('.css'));
  const files=await Promise.all(order.map(async input=>({path:input,css:await readFile(input,'utf8')})));
  const readOnly=file=>file.includes('node_modules/')||file.startsWith('../');
  const dead=deadDeclarations(files).filter(row=>!readOnly(row.path));
  const byFile={};for(const row of dead)byFile[row.path]=(byFile[row.path]||0)+1;
  console.log(JSON.stringify({files:order.length,dead:dead.length,byFile},null,1));
  if(process.argv.includes('--fix')){const out=removeDeadDeclarations(files,{readOnly});for(const [file,css] of Object.entries(out))await writeFile(file,css);console.log('rewrote',Object.keys(out).length,'files');}
 }finally{await rm(outdir,{recursive:true,force:true});}
}
