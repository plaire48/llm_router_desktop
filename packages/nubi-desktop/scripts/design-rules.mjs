import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auditCxSurface} from './cx-surface-audit.mjs';
const accessibilityExceptions=JSON.parse(await readFile(new URL('./design-exceptions.json',import.meta.url),'utf8')).exceptions;
export const DESIGN_MOTION_FILES=['design/workspace-identity.css','design/workspace-density.css','design/workspace-typography.css','design/workspace-icons.css','design/workspace-pastel.css','ui/workflow.css','ui/loading-note.css','electron-app/ios-tokens.css','electron-app/modal-motion.css','ui/computer-use.css','ui/tool-arguments.css','ui/project-switch-cover.css','electron-app/external-browser.css','electron-app/workbench.css'];
export function sourceDesignIssues(file,source,{colors=false,layout=false,has=false}={}){
 const clean=source.replace(/\/\*[\s\S]*?\*\//g,''),issues=[],add=(rule,offset)=>issues.push({rule,file,offset});
 if(colors)for(const m of clean.matchAll(/#[0-9a-fA-F]{3,8}\b/g))add('color_literal',m.index);
 if(layout)for(const m of clean.matchAll(/\d+(?:\.\d+)?px\b|\u00b7/g))add('layout_literal',m.index);
 for(const m of clean.matchAll(/(?:^|[;{])\s*(transition(?:-duration)?|animation(?:-duration)?|--[\w-]*(?:duration|motion|cycle|delay)[\w-]*)\s*:\s*([^;}]+)/g)){
  if(file!=='design/workspace-motion.css'&&/\b(?:\d*\.)?\d+(?:ms|s)\b/.test(m[2]))add('motion_literal',m.index);
  if(m[1]==='transition'&&/\ball\b/.test(m[2]))add('transition_all',m.index);
 }
 if(has)issues.push(...hasSelectorIssues(file,source));
 return issues;
}
// :has() made every DOM change recalculate the whole document's style (design light-flow §1.1, 2026-10-22).
function hasSelectorIssues(file,source){
 const clean=source.replace(/\/\*[\s\S]*?\*\//g,c=>c.replace(/[^\n]/g,' ')),issues=[];
 for(const m of clean.matchAll(/([^{};]+)\{/g)){
  if(m[1].trim().startsWith('@'))continue;
  let depth=0,start=0;const prelude=m[1],parts=[];
  for(let i=0;i<=prelude.length;i++){const c=prelude[i];if(c==='(')depth++;else if(c===')')depth--;else if((c===','&&depth===0)||i===prelude.length){parts.push([start,prelude.slice(start,i)]);start=i+1;}}
  for(const [at,text] of parts){
   if(!text.includes(':has('))continue;
   const lead=text.length-text.trimStart().length,offset=m.index+at+lead;
   issues.push({rule:'has_selector',file,offset,line:clean.slice(0,offset).split('\n').length,selector:text.trim().replace(/\s+/g,' ')});
  }
 }
 return issues;
}
export function judgeDesignFacts(facts){
 const issues=[],add=rule=>issues.push({rule});
 if(facts.primaryActions>1)add('primary_actions');if(facts.duplicateTitles>0)add('duplicate_title');
 if(facts.nestedTint>0)add('nested_tint');if(facts.rawErrors>0)add('raw_error');if(facts.sidebarOverlap)add('sidebar_overlap');
 if(Object.values(facts.motion||{}).some(ms=>ms>(facts.reduced?120:300)))add(facts.reduced?'reduced_motion':'interaction_motion');
 return issues;
}
// Executed inside the page. Application chrome is audited; user-authored code,
// terminal output, external documents and explicitly expanded details are data.
export function inspectDesignRules(){
 const visible=n=>n.checkVisibility()&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0;
 const dialogs=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(visible),root=dialogs.at(-1)||document.body;
 const owned=n=>!n.closest('.message,.monaco-editor,.nubi-terminal,.nubi-tool-arguments,pre,code,[data-source-content]');
 const headings=[...root.querySelectorAll('h1,h2,h3')].filter(n=>visible(n)&&owned(n)),headers=headings.filter(n=>n.closest('header,[data-shell-title]'));
 const names=headers.map(n=>n.textContent.trim()).filter(Boolean),duplicateTitles=headings.filter(n=>!headers.includes(n)&&names.includes(n.textContent.trim())).length;
 const probe=document.createElement('i');probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;background:var(--nubi-surface-base,var(--deck-surface))';root.append(probe);const surface=getComputedStyle(probe).backgroundColor;probe.remove();
 const clear=c=>c==='rgba(0, 0, 0, 0)'||c==='transparent'||c===surface;
 const surfaces=[...root.querySelectorAll('[data-design-surface],.cx-panel-body .settings-section,.nubi-workflow-stage,.nubi-workflow-wait,.nubi-workflow-child,.nubi-workflow-properties,.nubi-workflow-lane')].filter(visible);
 const nestedTint=surfaces.filter(n=>!clear(getComputedStyle(n).backgroundColor)&&surfaces.some(parent=>parent!==n&&parent.contains(n)&&!clear(getComputedStyle(parent).backgroundColor))).length;
 const rawErrors=[...root.querySelectorAll('[role=alert],.nubi-workflow-error,[data-error-code]')].filter(n=>visible(n)&&owned(n)&&!n.closest('details')).filter(n=>{const copy=n.cloneNode(true);copy.querySelectorAll('details,pre,code,[data-source-content]').forEach(child=>child.remove());return /\b(?:workflow|wiki|mail_portal|ERR)_[a-zA-Z_]+\b/.test(copy.textContent);}).length;
 const css=getComputedStyle(document.documentElement),ms=value=>value.trim().endsWith('ms')?parseFloat(value):parseFloat(value)*1000,motion=Object.fromEntries(['enter','exit','press','state'].map(name=>[name,ms(css.getPropertyValue('--nubi-motion-'+name))]).filter(([,value])=>Number.isFinite(value)));
 const project=document.querySelector('.nubi-sidebar-folder-picker span'),search=document.querySelector('.nubi-sidebar-search span');let sidebarOverlap=false;
 if(project&&search&&visible(project)&&visible(search)){const a=project.getBoundingClientRect(),b=search.getBoundingClientRect();sidebarOverlap=Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);}
 const groups=new Map();
 for(const button of [...root.querySelectorAll('.cx-button--primary')].filter(n=>visible(n)&&owned(n)&&!n.matches(':disabled,[aria-disabled=true]'))){
  // Only existing semantic forms/cards are scopes. Do not invent a scope for
  // each button; the topmost modal always remains a single decision surface.
  const group=dialogs.length?root:button.closest('form,.composer')||button.closest('.nubi-proposal-card,.nubi-approval-form,[data-decision-id]')||button.closest('[role=region],section[aria-label],section[aria-labelledby],article[aria-label],article[aria-labelledby]')||root;
  groups.set(group,(groups.get(group)||0)+1);
 }
 return {primaryActions:Math.max(0,...groups.values()),primaryGroups:[...groups].map(([node,count])=>({kind:node===root?(dialogs.length?'dialog':'page'):node.tagName.toLowerCase(),count})),duplicateTitles,nestedTint,rawErrors,sidebarOverlap,motion,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches};
}
export async function assertDesignRules(page){
 const facts=await page.evaluate(inspectDesignRules),issues=judgeDesignFacts(facts);assert.deepEqual(issues,[],'Shared design rules: '+JSON.stringify({issues,facts}));return facts;
}
export async function captureDesign(target,options){
 const page=typeof target.context==='function'?target:target.page();await assertDesignRules(page);return target.screenshot(options);
}

// Probe real keyboard traversal, not just a selector list. Restore focus,
// selection and scroll positions so screenshots and later assertions observe
// the same state. No Enter/Space/click is sent by this audit.
export async function assertModalFocus(page){
 const state=await page.evaluateHandle(()=>{
  const root=[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(n=>n.checkVisibility()&&!n.closest('[inert]')).at(-1);
  if(!root)return null;
  const active=document.activeElement;
  return {root,active,inside:root.contains(active),limit:root.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]').length+2,selection:typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd,active.selectionDirection]:null,scroll:[document.scrollingElement,root,...root.querySelectorAll('*')].filter(n=>n.scrollHeight>n.clientHeight||n.scrollWidth>n.clientWidth).map(n=>[n,n.scrollLeft,n.scrollTop])};
 });
 try{
  if(await state.evaluate(s=>s===null))return {modal:false,forward:0,reverse:0};
  assert(await state.evaluate(s=>s.inside),'modal_focus: focus must enter the active modal');
  const limit=await state.evaluate(s=>s.limit),counts={modal:true,forward:0,reverse:0};
  for(const [direction,key]of [['forward','Tab'],['reverse','Shift+Tab']]){
   await state.evaluate(s=>{s.active.focus({preventScroll:true});s.seen=new Set([document.activeElement]);});
   let cycle=false;
   for(let index=0;index<limit;index++){
    await page.keyboard.press(key);counts[direction]++;
    const result=await state.evaluate(s=>{const active=document.activeElement,inside=s.root.isConnected&&s.root.contains(active),repeated=s.seen.has(active);s.seen.add(active);return {inside,repeated};});
    assert(result.inside,'modal_focus: '+key+' escaped the active modal');
    if(result.repeated){cycle=true;break;}
   }
   assert(cycle,'modal_focus: keyboard traversal did not cycle');
  }
  return counts;
 }finally{
  await state.evaluate(s=>{if(!s)return;if(s.active.isConnected){s.active.focus({preventScroll:true});if(s.selection)s.active.setSelectionRange(...s.selection);}for(const[n,x,y]of s.scroll)if(n.isConnected){n.scrollLeft=x;n.scrollTop=y;}});await state.dispose();
 }
}
export async function assertAccessibilityRules(page,{exceptions=accessibilityExceptions}={}){
 assert(Array.isArray(exceptions),'accessibility exceptions must be a declaration list');
 assert.equal(new Set(exceptions.map(entry=>entry.id)).size,exceptions.length,'accessibility exception ids must be unique');
 for(const entry of exceptions)assert(entry.id&&['accessible_name','contrast','contrast_unmeasured'].includes(entry.rule)&&entry.selector&&entry.reason?.trim()&&Number.isInteger(entry.maxMatches)&&entry.maxMatches>0,'accessibility exception requires an exact selector, reason and bounded matches');
 const cx=await auditCxSurface(page,{scope:'active',contrastMode:'g5'}),issues=[...cx.missingNames.map(row=>({...row,rule:'accessible_name'})),...cx.contrast.map(row=>({...row,rule:'contrast'})),...cx.unmeasured.map(row=>({...row,rule:'contrast_unmeasured'}))],accepted=[],remaining=[];
 for(const issue of issues){
  const entry=exceptions.find(item=>item.rule===issue.rule&&item.selector===issue.selector);
  if(entry){accepted.push({...issue,exception:entry.id,reason:entry.reason});assert(accepted.filter(row=>row.exception===entry.id).length<=entry.maxMatches,'accessibility exception exceeded bounded matches');}
  else remaining.push(issue);
 }
 assert.deepEqual(remaining,[],'Shared accessibility rules: '+JSON.stringify(remaining));
 const focus=await assertModalFocus(page);
 return {textCount:cx.textCount,issues:remaining,accepted,unmeasured:cx.unmeasuredBackgrounds,focus};
}
