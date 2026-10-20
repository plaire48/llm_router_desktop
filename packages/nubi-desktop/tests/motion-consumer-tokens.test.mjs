import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('all five follow-up motion consumers obtain durations and delays from central tokens',async()=>{
 for(const file of ['ui/computer-use.css','ui/tool-arguments.css','ui/project-switch-cover.css','electron-app/external-browser.css','electron-app/workbench.css']){
  const css=await readFile(new URL('../'+file,import.meta.url),'utf8');assert.equal(/\b\d*\.?\d+(?:ms|s)\b/.test(css),false,file+' contains a local duration or fallback');assert.doesNotMatch(css,/transition\s*:\s*(?:all|left|top|width)\b/,file+' animates layout');
 }
});
