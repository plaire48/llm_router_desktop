import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
// A workspace switch remounts the Workbench (key={generation}). The renderer must carry "the person chose personal chat"
// across that remount, or "프로젝트 없이 대화" lands on the project start screen again (scripts/check-personal-start-ui.mjs
// covers the Workbench side with a fixture that remounts the same way).
test('the renderer remembers a switch to personal chat across the Workbench remount',async()=>{
 const source=await readFile(new URL('../electron-app/renderer.jsx',import.meta.url),'utf8');
 assert.match(source,/setConversationIntent\(method==='startConversation'\);setGeneration\(n=>n\+1\)/,'set together with the remount');
 assert.match(source,/<Workbench [^>]*startInConversation=\{conversationIntent\}/,'passed to the remounted Workbench');
});
