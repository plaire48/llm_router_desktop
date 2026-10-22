// Upper-level layout facts the renderer already knows, published as attributes so CSS needs no :has() (design light-flow §1.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {shellState,applyShellState} from '../ui/shell-state.mjs';
test('shellState maps every fact to a data attribute string',()=>{
 const state=shellState({toolbar:true,startEmpty:true,sidebarOpen:true,dialogOpen:true});
 assert.equal(state['data-toolbar'],'true');assert.equal(state['data-start-empty'],'true');assert.equal(state['data-sidebar-open'],'true');assert.equal(state['data-dialog-open'],'true');
 assert.equal(state['data-mail-progress'],'false');assert.equal(state['data-sidebar-brand-collapsed'],'false');assert.equal(Object.keys(state).length,16);
});
test('applyShellState writes only changed attributes',()=>{
 const writes=[];const node={attrs:{'data-toolbar':'true'},getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){writes.push(k);this.attrs[k]=v;}};
 applyShellState(node,{'data-toolbar':'true','data-intro':'false'});
 assert.deepEqual(writes,['data-intro']);
 applyShellState(node,{'data-toolbar':'true','data-intro':'false'});
 assert.deepEqual(writes,['data-intro'],'no write when nothing changed');
});
// The facts are read from the same DOM the removed :has() selectors looked at, so attribute and selector cannot disagree.
import {readShellFacts,SHELL_FACT_SELECTORS} from '../ui/shell-state.mjs';
const fakeDocument=present=>({querySelector:selector=>present.has(selector)?{}:null});
test('readShellFacts mirrors each removed :has() argument',()=>{
 assert.deepEqual(SHELL_FACT_SELECTORS,{desktopShell:'.desktop-shell',toolbar:'.desktop-shell[data-toolbar="true"]',mailProgress:'.desktop-shell > .desktop-mail-progress',wikiInitializing:'.desktop-mail-progress > .nubi-wiki-initialization',startEmpty:'.nubi-start.is-empty',sidebarOpen:'.nubi-sidebar[data-open="true"]',sidebarBrandCollapsed:'.nubi-sidebar[data-open="false"] .nubi-sidebar-brand',composerFocus:'.composer:focus-within',dialogOpen:'.nubi-workbench [role="dialog"]',hasTask:'.nubi-task',wikiBrowser:'.nubi-wiki-browser',preparing:'.nubi-main > .nubi-preparing',largeText:'.nubi-workbench[data-large-text="true"]',intro:'.nubi-intro',workflowsTitle:'.nubi-workflows[data-shell-title]',panelBackdrop:'.cx-panel-backdrop'});
 const facts=readShellFacts(fakeDocument(new Set(['.desktop-shell','.nubi-task','.composer:focus-within'])));
 assert.equal(facts.desktopShell,true);assert.equal(facts.hasTask,true);assert.equal(facts.composerFocus,true);assert.equal(facts.mailProgress,false);
});
test('shellState publishes the new facts too',()=>{
 const state=shellState({desktopShell:true,wikiInitializing:true,wikiBrowser:true,workflowsTitle:false});
 assert.equal(state['data-desktop-shell'],'true');assert.equal(state['data-wiki-initializing'],'true');assert.equal(state['data-wiki-browser'],'true');assert.equal(state['data-workflows-title'],'false');
});
// Local :has() selectors are mirrored the same way, onto their own subject element (design light-flow §6: zero :has()).
import {LOCAL_HAS,scopeArgument,applyLocalFacts} from '../ui/shell-state.mjs';
test('local :has() arguments are evaluated relative to the subject element',()=>{
 assert.equal(scopeArgument('> .a'),':scope > .a');
 assert.equal(scopeArgument('.a, .b'),':scope .a, :scope .b');
 assert.equal(scopeArgument('>.x > .y'),':scope >.x > .y');
 assert.equal(scopeArgument('[data-provider="claude"]'),':scope [data-provider="claude"]');
});
test('the registry names are unique and every entry has a subject and an argument',()=>{
 const names=LOCAL_HAS.map(e=>e.name);assert.equal(new Set(names).size,names.length);
 for(const e of LOCAL_HAS){assert.match(e.name,/^[a-z][a-z-]+$/);assert.ok(e.subject&&e.argument);}
});
test('applyLocalFacts writes data-has-<name> on each subject from its own subtree, only when it changes',()=>{
 const writes=[];const element=has=>({attrs:{},querySelector:s=>has.includes(s)?{}:null,getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){writes.push(k+'='+v);this.attrs[k]=v;}});
 const withChapters=element([':scope > .nubi-chapter-contents']),without=element([]);
 const doc={querySelectorAll:s=>s==='.nubi-conversation-wrap'?[withChapters,without]:[]};
 applyLocalFacts(doc,[{name:'chapter-contents',subject:'.nubi-conversation-wrap',argument:'> .nubi-chapter-contents'}]);
 assert.deepEqual(writes,['data-has-chapter-contents=true','data-has-chapter-contents=false']);
 applyLocalFacts(doc,[{name:'chapter-contents',subject:'.nubi-conversation-wrap',argument:'> .nubi-chapter-contents'}]);
 assert.equal(writes.length,2,'unchanged facts are not rewritten');
});
// Typing must not rescan the document: no fact depends on an input's value (final review 2026-10-22).
import {installShellState} from '../ui/shell-state.mjs';
test('the observer does not run on every keystroke',()=>{
 const types=[];const saved=globalThis.MutationObserver;globalThis.MutationObserver=class{observe(){}disconnect(){}};
 const node={getAttribute:()=>null,setAttribute(){}};
 const doc={documentElement:node,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:type=>types.push(type),removeEventListener(){}};
 try{const release=installShellState(doc);assert.ok(!types.includes('input'),JSON.stringify(types));assert.ok(types.includes('change'));release();}
 finally{globalThis.MutationObserver=saved;}
});
