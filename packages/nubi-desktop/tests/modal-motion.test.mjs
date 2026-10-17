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

test('dialog motion is compositor-only, timed like a sheet and off for reduced motion',async()=>{
  const css=await read('electron-app/modal-motion.css');
  assert.match(css,/--nubi-modal-open:280ms;/);
  assert.match(css,/--nubi-modal-close:180ms;/);
  assert.match(css,/@media \(prefers-reduced-motion: no-preference\) \{\s*@layer nubi-modal-motion \{/);
  for(const [,body] of css.matchAll(/@keyframes nubi-modal-[\w-]+ \{([^}]*\})\s*\}/g)){
    for(const [,property] of body.matchAll(/([a-z-]+):/g))assert.ok(['opacity','transform'].includes(property),`only transform and opacity animate, found ${property}`);
  }
  assert.match(css,/\[data-modal-motion="leaving"\] \* \{ pointer-events:none !important; \}/);
  assert.match(css,/view-transition-name:nubi-modal;/);
});

test('automated checks and reduced motion get no motion or close delay',async()=>{
  const motion=await read('ui/modalMotion.js');
  assert.match(motion,/navigator\.webdriver/);
  assert.match(motion,/prefers-reduced-motion: reduce/);
  assert.match(motion,/if\(!html\.dataset\.modalMotion\)return;/);
  assert.match(motion,/node\.inert=true;node\.setAttribute\('aria-hidden','true'\);/);
  const transitions=await read('ui/viewTransition.js');
  assert.match(transitions,/!document\.querySelector\('[^']*\.cx-panel-backdrop'\)/);
});
