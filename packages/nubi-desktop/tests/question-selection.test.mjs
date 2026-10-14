import test from 'node:test';
import assert from 'node:assert/strict';
import {textQuestionArgs,makeQuestion} from '../../../extensions/aipro-chat/user-question.js';

// A question form is single choice, multiple choice or free text (user request 2026-10-14). Choices default to single.
const choices=[{label:'A'},{label:'B'}];
const ask=args=>{const parsed=textQuestionArgs(args);return makeQuestion(parsed.question,[],[],{choices:parsed.choices||[],selection:parsed.choices?.length?parsed.selection||'single':undefined});};
test('choices are single by default, multiple when asked, and free text without choices',()=>{
  assert.equal(ask({question:'하나만?',choices}).selection,'single');
  assert.equal(ask({question:'여러 개?',choices,selection:'multiple'}).selection,'multiple');
  const text=ask({question:'직접 입력?'});assert.equal(text.kind,'text');assert.equal(text.selection,undefined);
  assert.throws(()=>textQuestionArgs({question:'?',choices,selection:'some'}),/tool_arguments_invalid/);
});
