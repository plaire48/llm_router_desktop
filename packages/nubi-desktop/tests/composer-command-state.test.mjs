import test from 'node:test';
import assert from 'node:assert/strict';
import {splitComposerDraft,replaceComposerCommand,updateComposerInput,composerCommandQuery,removeComposerQuery} from '../ui/composer-command-state.mjs';
import {resolveAgentCommand} from '../runtime/agent-commands.mjs';
const skills=[{name:'report',path:'.nubi/skill/report/SKILL.md',title:'보고서 작성'}];
test('one projected command retains the serialized backend scope and draft body',()=>{
 const raw=updateComposerInput('/code 기존 본문','새 본문',skills),draft=splitComposerDraft(raw,skills);
 assert.equal(raw,'/code 새 본문');assert.equal(draft.selection.command,'code');assert.equal(draft.input,'새 본문');assert.equal(resolveAgentCommand(raw).input,'새 본문');
 assert.equal(splitComposerDraft('/code /mail 남은 본문').selection.command,'mail');
 assert.equal(updateComposerInput('/code 기존','/mail 교체',skills),'/mail 교체');
});
test('skill selection replaces a builtin or another registered skill without losing body',()=>{
 assert.equal(replaceComposerCommand('/code 기존\n본문','report',skills),'/report 기존\n본문');
 assert.equal(replaceComposerCommand('/report 남겨 주세요','mail',skills),'/mail 남겨 주세요');
 assert.equal(splitComposerDraft('/report 본문',skills).selection.title,'보고서 작성');
 assert.equal(splitComposerDraft('/unknown 본문',skills).input,'/unknown 본문');assert.equal(splitComposerDraft('/usr/local/bin 본문',skills).selection,null);
});
test('a slash token at the caret replaces the chip while retaining text before and after it',()=>{
 const body='이 문장을 /mail 뒤에도 남겨요',query=composerCommandQuery(body,11);
 assert.equal(query.query,'/mail');assert.equal(removeComposerQuery(body,query),'이 문장을  뒤에도 남겨요');
 assert.equal(composerCommandQuery('https://example.com'),null);assert.equal(composerCommandQuery('/mail 완료'),null);
 assert.equal(composerCommandQuery('/').query,'/');
});
