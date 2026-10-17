import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {auditCxSurface} from './cx-surface-audit.mjs';

// Inspect owned UI text. User-authored document/canvas/rich-text styles have a
// separate preservation contract and are not application typography.
export async function auditSurfaceTokens(page,name){
 const result=await page.evaluate(()=>{
  const excluded='svg,.monaco-editor,.xterm,[aria-hidden=true],.visually-hidden,.nubi-word-paper,.nubi-ppt-canvas,.nubi-excel-grid-scroll,.talk-rich-content';
  const nodes=[...document.body.querySelectorAll('*')].filter(node=>node.checkVisibility()&&!node.closest(excluded)&&[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim()));
  const probe=document.createElement('span');document.body.append(probe);
  const sizes=['--deck-type-caption','--deck-type-body','--nubi-reading-size','--nubi-type-large-body','--deck-type-heading','--nubi-type-section','--deck-type-title'].map(token=>{probe.style.fontSize=`var(${token})`;return parseFloat(getComputedStyle(probe).fontSize);});probe.remove();
  const outliers=[];
  for(const node of nodes){const style=getComputedStyle(node),issues=[];
   if(!/(?:Pretendard|Noto Sans KR|monospace|Color Emoji)/i.test(style.fontFamily))issues.push('family');
   if(![400,500,600,700].includes(Number(style.fontWeight)))issues.push('weight');
   if(!node.closest('.nubi-logo,.nubi-welcome')&&!sizes.some(size=>Math.abs(size-parseFloat(style.fontSize))<.15))issues.push('size');
   if(issues.length)outliers.push({tag:node.tagName,class:node.className,text:node.textContent.trim().slice(0,45),font:style.fontFamily,size:style.fontSize,weight:style.fontWeight,issues});
  }
  return {width:innerWidth,rootSize:getComputedStyle(document.documentElement).fontSize,textNodes:nodes.length,outliers,values:Object.fromEntries(['fontFamily','fontSize','fontWeight','color'].map(property=>[property,[...new Set(nodes.map(node=>getComputedStyle(node)[property]))]]))};
 });
 result.cx=await auditCxSurface(page);
 const directory=path.resolve('verification/design-token-audit-2026-10-17/runtime');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,name.replace(/[^a-z0-9_-]/gi,'-')+'.json'),JSON.stringify(result,null,2));
 assert.deepEqual(result.cx.missingNames,[],name+': visible controls have names');
 assert.deepEqual(result.cx.contrast,[],name+': text over plain measured backgrounds meets contrast');
 assert.deepEqual(result.outliers,[],name+': owned text follows Workspace font, size and weight tokens');return result;
}
