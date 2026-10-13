import test from 'node:test';
import assert from 'node:assert/strict';
import {holdCommandSkills,takeCommandSkills} from '../runtime/command-skill-context.mjs';
import {recoveryInstruction} from '../runtime/tool-feedback.mjs';
const skill={path:'.nubi/skill/example/SKILL.md',hash:'original',content:'Keep the original data.',nextOffset:null};
const loaded=()=>new Map([[skill.path,{hash:skill.hash,nextOffset:null,instructions:skill}]]);
test('command skills are task/action/binding scoped, one-shot and currently verified',async()=>{
 const store={},options={actionId:'a',binding:'b',resumed:true,read:async()=>skill};
 holdCommandSkills(store,'t','a','b',loaded());assert.deepEqual(await takeCommandSkills(store,'other',options),[]);
 assert.deepEqual(await takeCommandSkills(store,'t',options),[skill]);assert.deepEqual(await takeCommandSkills(store,'t',options),[]);
 for(const delta of [{actionId:'other'},{binding:'other'},{resumed:false},{read:async()=>({...skill,hash:'changed'})},{read:async()=>{throw Error('skill_changed');}}]){
  holdCommandSkills(store,'t','a','b',loaded());assert.deepEqual(await takeCommandSkills(store,'t',{...options,...delta}),[]);
 }
});
test('partial and compacted skill instructions cannot be carried',async()=>{
 const store={},value=loaded();value.get(skill.path).nextOffset=8000;
 holdCommandSkills(store,'t','a','b',value);let reads=0;
 assert.deepEqual(await takeCommandSkills(store,'t',{actionId:'a',binding:'b',resumed:true,read:async()=>{reads++;return skill;}}),[]);assert.equal(reads,0);
 holdCommandSkills(store,'t','a','b',new Map());assert.deepEqual(await takeCommandSkills(store,'t',{actionId:'a',binding:'b',resumed:true,read:async()=>skill}),[]);
});
test('setup missing-read advice does not ask for edited lines or replay success',()=>{
 const text=recoveryInstruction('source_read_required','propose_setup_action');assert.match(text,/details.path/);assert.match(text,/no approval card/);assert.doesNotMatch(text,/lines to change/);assert.match(text,/must not be replayed/);
});
