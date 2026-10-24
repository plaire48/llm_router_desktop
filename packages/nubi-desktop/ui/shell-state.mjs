// Layout facts that CSS used to ask with :has(), published as attributes instead (design light-flow §1.1:
// :has() on high nodes recalculated the whole document's style on every DOM change, up to 99ms a time).
// The facts are read from the same DOM the removed selectors looked at, and attributes change only when a fact does.
export const SHELL_FACT_SELECTORS=Object.freeze({
 desktopShell:'.desktop-shell',
 toolbar:'.desktop-shell[data-toolbar="true"]',
 mailProgress:'.desktop-shell > .desktop-mail-progress',
 wikiInitializing:'.desktop-mail-progress > .nubi-wiki-initialization',
 startEmpty:'.nubi-start.is-empty',
 sidebarOpen:'.nubi-sidebar[data-open="true"]',
 sidebarBrandCollapsed:'.nubi-sidebar[data-open="false"] .nubi-sidebar-brand',
 composerFocus:'.composer:focus-within',
 dialogOpen:'.nubi-workbench [role="dialog"]',
 hasTask:'.nubi-task',
 wikiBrowser:'.nubi-wiki-browser',
 preparing:'.nubi-main > .nubi-preparing',
 largeText:'.nubi-workbench[data-large-text="true"]',
 intro:'.nubi-intro',
 workflowsTitle:'.nubi-workflows[data-shell-title]',
 panelBackdrop:'.cx-panel-backdrop'
});
const attributeName=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
export function readShellFacts(doc){
 const facts={};for(const [key,selector] of Object.entries(SHELL_FACT_SELECTORS))facts[key]=!!doc.querySelector(selector);return facts;
}
export function shellState(facts={}){
 const state={};for(const key of Object.keys(SHELL_FACT_SELECTORS))state[attributeName(key)]=String(facts[key]===true);return state;
}
// Rewriting an unchanged attribute still invalidates style; write only what changed.
export function applyShellState(node,state){
 if(!node)return;
 for(const [name,value] of Object.entries(state))if(node.getAttribute(name)!==value)node.setAttribute(name,value);
}
// Local :has() selectors, mirrored onto their own subject element as data-has-<name>. The argument is the exact
// :has() argument; it is evaluated against the subject's own subtree, so the attribute and the old selector agree.
export const LOCAL_HAS=Object.freeze([
 {name:'anchored-dialog',subject:'.cx-panel-backdrop',argument:'> .nubi-anchored-dialog'},
 {name:'claude-provider',subject:'.model-dialog',argument:'[data-provider="claude"]'},
 {name:'question-form',subject:'.nubi-decision-dialog',argument:'.nubi-question-form'},
 {name:'panel-navigation',subject:'.nubi-panel',argument:'.nubi-panel-navigation'},
 {name:'panel-title-icon',subject:'.deck-dialog',argument:'> .cx-panel-header .nubi-panel-title > .nubi-panel-title-icon, > .cx-panel-header .nubi-panel-title > svg, > .cx-panel-header .nubi-panel-title > img, > .cx-panel-header .nubi-panel-title > .desktop-file-icon, > .cx-panel-header .nubi-account-profile > .nubi-account-avatar'},
 {name:'plan-current',subject:'.task-plan',argument:'.task-plan-current'},
 {name:'account-actions',subject:'.nubi-mail-section-heading',argument:'.provider-account-actions'},
 {name:'tab-selected',subject:'.desktop-workspace-tab',argument:'[aria-selected="true"]'},
 {name:'message-time',subject:'.message-actions',argument:'.nubi-message-timestamp, .nubi-response-time'},
 {name:'wiki-initialization',subject:'.desktop-mail-progress',argument:'> .nubi-wiki-initialization'},
 {name:'filters-open',subject:'.nubi-mail-search',argument:'> .nubi-mail-filters[open]'},
 {name:'span-child',subject:'.nubi-workspace-rail .cx-kit-button',argument:'> span'},
 {name:'input-focus-visible',subject:'.nubi-mail-select',argument:'input:focus-visible'},
 {name:'idle-mark',subject:'.welcome-emblem',argument:'> .agent-mark:is([data-mood="idle"],[data-mood="working"],[data-mood="celebrate"])'},
 {name:'icon-pair',subject:'.nubi-document-progress summary',argument:'> svg ~ svg'},
 {name:'response-time',subject:'.agent-step-status',argument:'> .nubi-response-time'},
 {name:'inquiry-sidebar',subject:'.nubi-inquiry-page',argument:'.has-inquiry-sidebar:not(.is-composing)'},
 {name:'message-state',subject:'.message',argument:'[role="alert"], [data-copy-state="copied"], [data-copy-state="error"]'},
 {name:'approval-form',subject:'.nubi-setup-summary',argument:'> .nubi-approval-form'},
 {name:'wiki-loading',subject:'.nubi-wiki-results',argument:'> .nubi-wiki-loading'},
 {name:'mail-table',subject:'.nubi-mail-results',argument:'.nubi-mail-table'},
 {name:'chapter-contents',subject:'.nubi-conversation-wrap',argument:'> .nubi-chapter-contents'},
 {name:'input-checked',subject:'.inquiry-assignment-list label',argument:'input:checked'},
 {name:'link-hover',subject:'.workspace-card',argument:'.workspace-card-link:hover',hover:true},
 {name:'input-disabled',subject:'.workspace-image-upload, .talk-team-options > label, .cx-input-shell.cx-search-field',argument:'input:disabled'},
 {name:'discussion-answer',subject:'.comment-entry',argument:'> .talk-comment-head > .discussion-answer'},
 {name:'my-posts',subject:'.talk-filter-tools, .talk-toolbar',argument:'[data-action="myPosts"]'},
 {name:'category-filter',subject:'.talk-toolbar, .talk-filter-tools',argument:'.talk-category-filter'},
 {name:'clear-search',subject:'.cx-input-shell.cx-search-field',argument:'> [data-action="clearSearch"]'},
 {name:'file-tabs',subject:'.desktop-pane',argument:'.desktop-file-tabs'},
 {name:'agent-intro',subject:'.aipro-login-card',argument:'.agent-intro'},
 {name:'library',subject:'.cx-panel-body',argument:'> .nubi-library'}
]);
export function scopeArgument(argument){
 const parts=[];let depth=0,start=0;
 for(let i=0;i<=argument.length;i++){const c=argument[i];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if((c===','&&depth===0)||i===argument.length){parts.push(argument.slice(start,i).trim());start=i+1;}}
 return parts.map(part=>/^[>+~]/.test(part)?':scope '+part:':scope '+part).join(', ');
}
export function applyLocalFacts(doc,entries=LOCAL_HAS,subjects){
 for(const entry of entries){const scoped=entry.scoped||=scopeArgument(entry.argument),name='data-has-'+entry.name;
  for(const node of subjects?[...subjects].filter(node=>node.matches(entry.subject)):doc.querySelectorAll(entry.subject)){const value=String(!!node.querySelector(scoped));if(node.getAttribute(name)!==value)node.setAttribute(name,value);}}
}
// A message/field change can affect its own subject and its ancestors. Only new
// elements or a changed selector attribute can introduce subjects below it.
// Keep this in the mutation delivery, before paint, without rescanning siblings.
function changedSubjects(changes,selector){
 const subjects=new Set();
 const collect=(node,descendants=false)=>{
  if(node?.nodeType!==1)return;
  for(let parent=node;parent;parent=parent.parentElement)if(parent.matches(selector))subjects.add(parent);
  if(descendants)for(const child of node.querySelectorAll(selector))subjects.add(child);
 };
 if(Array.isArray(changes))for(const change of changes){
  collect(change.target,change.type==='attributes');
  for(const added of change.addedNodes||[])collect(added,true);
 }else if(changes?.target)collect(changes.target);
 return subjects;
}
const SHELL_TARGETS=['.desktop-shell','.nubi-workbench','.nubi-workbench-layout','.nubi-main'];
const installed=new WeakMap();
// One observer per document; the renderer and Workbench both call this, so fixtures without the renderer get it too.
export function installShellState(doc=globalThis.document){
 if(!doc?.documentElement)return ()=>{};
 const existing=installed.get(doc);if(existing){existing.users++;return existing.release;}
 const local=LOCAL_HAS.map(entry=>({...entry})),hoverEntries=local.filter(entry=>entry.hover),selector=local.map(entry=>entry.subject).join(','),hoverSelector=hoverEntries.map(entry=>entry.subject).join(',');
 const update=changes=>{const state=shellState(readShellFacts(doc));applyShellState(doc.documentElement,state);for(const selector of SHELL_TARGETS)for(const node of doc.querySelectorAll(selector))applyShellState(node,state);applyLocalFacts(doc,local,changes?changedSubjects(changes,selector):undefined);};
 const hover=event=>{if(event.target?.closest?.(hoverSelector))applyLocalFacts(doc,hoverEntries,changedSubjects(event,hoverSelector));};
 // Mutation callbacks run before the next paint, so a changed fact never shows one frame of the old style.
 const observer=new MutationObserver(update);
 observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','role','data-open','data-toolbar','data-large-text','data-shell-title','open','disabled','aria-selected','data-mood','data-copy-state','data-provider']});
 // No 'input': typing changes no fact, and a document rescan per keystroke delays the composer.
 const events=[['focusin',update],['focusout',update],['change',update],['pointerover',hover],['pointerout',hover]];
 for(const [type,listener] of events)doc.addEventListener(type,listener,true);
 update();
 const entry={users:1,release:()=>{if(--entry.users>0)return;observer.disconnect();for(const [type,listener] of events)doc.removeEventListener(type,listener,true);installed.delete(doc);}};
 installed.set(doc,entry);return entry.release;
}
