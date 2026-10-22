// Plan 2a task 4: a declaration on an identical selector in the same conditions is dead when a later one sets the same
// property in the global cascade order (renderer.jsx imports). Conservative on shorthands, !important and conditions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {deadDeclarations,removeDeadDeclarations} from '../scripts/css-dead-declarations.mjs';
test('an earlier declaration on the identical selector in the same media is dead; !important and other media are not',()=>{
 const dead=deadDeclarations([{path:'a.css',css:'.x{color:red;margin:0}@media (min-width:1px){.x{color:blue}}.y{color:red!important}'},{path:'b.css',css:'.x{color:green}.y{color:blue}'}]);
 assert.deepEqual(dead.map(d=>[d.path,d.selector,d.property]),[['a.css','.x','color']]);
});
test('selector text is compared after whitespace normalization, and selector lists must match exactly',()=>{
 const dead=deadDeclarations([{path:'a.css',css:'.a  > .b{color:red}.a,.c{color:red}'},{path:'b.css',css:'.a>.b{color:blue}.a{color:blue}'}]);
 assert.deepEqual(dead.map(d=>[d.selector,d.property]),[['.a > .b','color']]);
});
test('a shorthand and its longhand are not treated as the same property, and a later !important kills an earlier normal one',()=>{
 const dead=deadDeclarations([{path:'a.css',css:'.x{margin-top:1px;color:red}'},{path:'b.css',css:'.x{margin:0;color:blue!important}'}]);
 assert.deepEqual(dead.map(d=>d.property),['color']);
});
test('removing dead declarations keeps the rest and drops emptied rules',()=>{
 const out=removeDeadDeclarations([{path:'a.css',css:'.x{color:red}\n.y{color:red;margin:0}'},{path:'b.css',css:'.x{color:blue}.y{color:blue}'}]);
 assert.equal(out['a.css'].replace(/\s+/g,''),'.y{margin:0}');assert.equal(out['b.css'],undefined,'files without dead declarations are untouched');
});
