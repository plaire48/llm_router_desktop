import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseAmbientRegistry} from '../ui/motion-policy.mjs';
test('performance and shared fixtures include the actual renderer pastel motion layer',async()=>{
 const renderer=await readFile(new URL('../electron-app/renderer.jsx',import.meta.url),'utf8');assert.match(renderer,/import '\.\.\/design\/workspace-pastel\.css'/);
 for(const name of ['shared-ui-fixture.jsx','motion-performance-fixture.jsx'])assert.match(await readFile(new URL(name,import.meta.url),'utf8'),/import '\.\.\/design\/workspace-pastel\.css'/,name+' must exercise ambient surfaces, not an empty animation path');
});
test('the installed CX spinner is replaced by the shared four-second hourglass',async()=>{
 const cx=await readFile(new URL('../node_modules/@e2e/cx-design-system/dist/styles.css',import.meta.url),'utf8');assert.match(cx,/master-spin/);
 const motion=await readFile(new URL('../design/workspace-motion.css',import.meta.url),'utf8'),registry=parseAmbientRegistry(motion.match(/--nubi-ambient-registry:"([^"]+)"/)[1]);assert.deepEqual(registry.get('nubi-hourglass-flip')?.durations,[4000]);assert.equal(registry.has('master-spin'),false);assert.match(motion,/\.status-spinner[^}]+animation:nubi-hourglass-flip/);assert.match(motion,/--nubi-ambient-spin-watch:4s/);
});

test('owned transition declarations keep balanced CSS functions after token migration',async()=>{
 for(const file of ['workspace-identity.css','workspace-density.css','workspace-motion.css','workspace-pastel.css','workspace-icons.css','workspace-typography.css']){
  const css=(await readFile(new URL('../design/'+file,import.meta.url),'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
  for(const match of css.matchAll(/\btransition(?:-duration|-timing-function)?:([^;}]+)/g)){let depth=0;for(const c of match[1]){if(c==='(')depth++;if(c===')')depth--;assert.ok(depth>=0,file+': '+match[0]);}assert.equal(depth,0,file+': '+match[0]);}
 }
});
