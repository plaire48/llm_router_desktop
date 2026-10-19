import {readFile} from 'node:fs/promises';
import path from 'node:path';
// The full vendor stylesheet contains reference-only Flow editor rules even
// though its distributed component entry contains no such component. Blink's
// universal :has() sibling rule invalidates unrelated conversation subtrees.
const referenceRules=/\.flow-assessment-panel[^{}]*:has\([^{}]*\)[^{}]*\{[^{}]*\}/g;
export const pruneUnusedFlowPreviewRules=css=>css.replace(referenceRules,'');
export const cxReferenceCssPlugin=()=>({name:'cx-unused-reference-css',setup(builder){builder.onLoad({filter:/[\\/]@e2e[\\/]cx-design-system[\\/]dist[\\/]styles\.css$/},async({path:file})=>{
 const component=await readFile(path.join(path.dirname(file),'index.js'),'utf8');
 if(component.includes('flow-assessment-panel'))throw Error('CX Flow component now distributed: review reference CSS pruning');
 return {contents:pruneUnusedFlowPreviewRules(await readFile(file,'utf8')),loader:'css',resolveDir:path.dirname(file)};
});}});
