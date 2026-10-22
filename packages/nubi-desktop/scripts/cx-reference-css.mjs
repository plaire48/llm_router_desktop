import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
// The full vendor stylesheet contains reference-only Flow editor rules even
// though its distributed component entry contains no such component. Blink's
// universal :has() sibling rule invalidates unrelated conversation subtrees.
const referenceRules=/\.flow-assessment-panel[^{}]*:has\([^{}]*\)[^{}]*\{[^{}]*\}/g;
export const pruneUnusedFlowPreviewRules=css=>css.replace(referenceRules,'');
// Plan 2a task 3: the CX stylesheet also styles another product's screens (admin tables, work lists). Rule volume is
// 40-47% of a full style rebuild (docs/CSS-DIET-2026-10-23.md), so rules naming classes the Desktop never renders are
// dropped at build time. Conservative: a class counts as used when its exact name appears anywhere in the sources, or
// when a name-building prefix in the sources ('is-'+state, `message-${role}`) starts it.
export function usedClassTokens(sources){
 const exact=new Set(),prefixes=new Set();
 for(const source of sources){
  for(const match of source.matchAll(/[A-Za-z_][\w-]*/g))exact.add(match[0]);
  for(const match of source.matchAll(/([A-Za-z][\w-]*-)(?:\$\{|["'`]\s*\+)/g))prefixes.add(match[1]);
 }
 return {exact,prefixes};
}
const classUsed=(name,used)=>used.exact.has(name)||[...used.prefixes].some(prefix=>name.startsWith(prefix));
// :is()/:where()/:matches() list alternatives (one used alternative is enough); :not() negates, so its classes need
// not exist. Remaining classes are required together.
function splitList(text){const parts=[];let depth=0,start=0;for(let i=0;i<text.length;i++){const c=text[i];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(c===','&&depth===0){parts.push(text.slice(start,i));start=i+1;}}parts.push(text.slice(start));return parts.map(p=>p.trim()).filter(Boolean);}
function selectorUsed(selector,used){
 let rest='',i=0;
 while(i<selector.length){
  const m=/^:(is|where|matches|not|-webkit-any)\(/.exec(selector.slice(i));
  if(!m){rest+=selector[i++];continue;}
  let depth=1,j=i+m[0].length;for(;j<selector.length&&depth;j++){if(selector[j]==='(')depth++;else if(selector[j]===')')depth--;}
  const inner=selector.slice(i+m[0].length,j-1);
  if(m[1]!=='not'&&!splitList(inner).some(alternative=>selectorUsed(alternative,used)))return false;
  rest+=' ';i=j;
 }
 return [...rest.matchAll(/\.((?:\\.|[\w-])+)/g)].every(match=>classUsed(match[1].replace(/\\/g,''),used));
}
export function pruneUnusedCxRules(css,used){
 const root=postcss.parse(css);let removed=0,kept=0;
 root.walkRules(rule=>{
  if(rule.parent?.type==='atrule'&&/keyframes$/i.test(rule.parent.name))return;
  if(rule.selectors.some(selector=>selectorUsed(selector,used))){kept++;return;}
  rule.remove();removed++;
 });
 root.walkAtRules(atRule=>{if(!/keyframes$/i.test(atRule.name)&&atRule.nodes&&atRule.nodes.length===0)atRule.remove();});
 return {css:root.toString(),removed,kept};
}
async function filesUnder(dir,skip){
 let entries;try{entries=await readdir(dir,{recursive:true,withFileTypes:true});}catch{return [];}
 return entries.filter(e=>e.isFile()&&/\.(jsx?|mjs|cjs|html)$/.test(e.name)).map(e=>path.join(e.parentPath??e.path,e.name)).filter(file=>!skip.some(part=>file.includes(part)));
}
export async function desktopSources(packageRoot){
 const skip=[path.sep+'node_modules'+path.sep,path.join('electron-app','lib')+path.sep];
 const dirs=['ui','electron-app','runtime','generated','../../extensions/aipro-chat/src'].map(dir=>path.join(packageRoot,dir));
 const files=[...(await Promise.all(dirs.map(dir=>filesUnder(dir,skip)))).flat(),path.join(packageRoot,'node_modules/@e2e/cx-design-system/dist/index.js')];
 return Promise.all(files.map(file=>readFile(file,'utf8').catch(()=>'')));
}
export const cxReferenceCssPlugin=()=>({name:'cx-unused-reference-css',setup(builder){builder.onLoad({filter:/[\\/]@e2e[\\/]cx-design-system[\\/]dist[\\/]styles\.css$/},async({path:file})=>{
 const component=await readFile(path.join(path.dirname(file),'index.js'),'utf8');
 if(component.includes('flow-assessment-panel'))throw Error('CX Flow component now distributed: review reference CSS pruning');
 const packageRoot=path.resolve(path.dirname(file),'../../../..');
 const pruned=pruneUnusedCxRules(pruneUnusedFlowPreviewRules(await readFile(file,'utf8')),usedClassTokens(await desktopSources(packageRoot)));
 try{await mkdir(path.join(packageRoot,'verification/css-diet'),{recursive:true});await writeFile(path.join(packageRoot,'verification/css-diet/cx-pruned.json'),JSON.stringify({removed:pruned.removed,kept:pruned.kept,at:new Date().toISOString()}));}catch{/* the record is informational */}
 return {contents:pruned.css,loader:'css',resolveDir:path.dirname(file)};
});}});
