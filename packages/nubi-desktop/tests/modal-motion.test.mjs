import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Dialog motion contract (user request 2026-10-14: iOS-like open and close instead of popping).
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');

test('the Electron renderer installs dialog motion and its styles',async()=>{
  const renderer=await read('electron-app/renderer.jsx');
  assert.match(renderer,/import \{useModalMotion\} from '\.\.\/ui\/modalMotion\.js';/);
  assert.match(renderer,/import '\.\/modal-motion\.css';/);
  assert.match(renderer,/useModalDismissalPolicy\(\);\n useModalMotion\(\);/);
});

test('dialog motion uses the common timings and opacity-only reduced motion',async()=>{
  const css=await read('electron-app/modal-motion.css');
  assert.match(css,/--nubi-modal-open:var\(--nubi-motion-enter\);/);
  assert.match(css,/--nubi-modal-close:var\(--nubi-motion-exit\);/);
  const tokens=await read('design/workspace-motion.css');assert.match(tokens,/--nubi-motion-enter:280ms/);assert.match(tokens,/--nubi-motion-exit:180ms/);assert.match(tokens,/--nubi-motion-reduced:120ms/);
  assert.match(css,/nubi-modal-fade-in var\(--nubi-motion-reduced\)/);
  assert.match(css,/nubi-modal-fade-out var\(--nubi-motion-reduced\)/);
  for(const [,body] of css.matchAll(/@keyframes nubi-modal-[\w-]+ \{([^}]*\})\s*\}/g)){
    for(const [,property] of body.matchAll(/([a-z-]+):/g))assert.ok(['opacity','transform'].includes(property),`only transform and opacity animate, found ${property}`);
  }
  assert.match(css,/\[data-modal-motion=leaving\] \* \{pointer-events:none!important\}/);
  assert.match(css,/view-transition-name:nubi-modal/);
});

test('automation can opt out while reduced motion retains the inert close lifecycle',async()=>{
  const motion=await read('ui/modalMotion.js');
  assert.match(motion,/navigator\.webdriver/);
  assert.match(motion,/prefers-reduced-motion: reduce/);
  assert.match(motion,/if\(!html\.dataset\.modalMotion\)return;/);
  assert.match(motion,/node\.inert=true;node\.setAttribute\('aria-hidden','true'\);/);
  // Exercise the transition guard rather than matching its selector spelling:
  // parked background dialogs now intentionally exclude [hidden] backdrops.
  const {transitioned}=await import('../ui/viewTransition.js'),previous=globalThis.document;
  let captures=0,updates=0;
  globalThis.document={hidden:false,documentElement:{hasAttribute:()=>false},body:{hasAttribute:()=>false},querySelector:()=>({}),startViewTransition(){captures++;}};
  try{transitioned(()=>updates++);await Promise.resolve();assert.equal(captures,0,'a visible modal must not be captured a second time');assert.equal(updates,1,'the live update must not wait for a modal transition');}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
