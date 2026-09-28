import test from 'node:test';
import assert from 'node:assert/strict';
import {checkUiParity,validateHtmlIdentity,validateOfficeCss} from '../scripts/check-ui-parity.mjs';
import {readFile,readdir} from 'node:fs/promises';

test('Office consumes the reviewed Nubi UI snapshot without silent component or CSS drift',async()=>{
  const result=await checkUiParity();
  assert.equal(result.matched,true);
  assert.ok(result.files>20);
});

test('refreshing snapshot hashes cannot silently change the approved palette or type scale',async()=>{
  const css=await readFile(new URL('../../../extensions/aipro-chat/design/agent-deck.css',import.meta.url),'utf8');
  const reference=JSON.parse(await readFile(new URL('../design/html-reference.json',import.meta.url),'utf8'));
  assert.throws(()=>validateHtmlIdentity(css.replace('#3182F6','#1826AD'),reference),/HTML identity drift/);
  assert.throws(()=>validateHtmlIdentity(css.replace('--deck-type-body: 14px','--deck-type-body: 12px'),reference),/HTML identity drift/);
});

test('product-authored Office UI and progress copy do not use middle-dot separators',async()=>{
  for(const folder of ['src','worker'])for(const name of await readdir(new URL(`../${folder}/`,import.meta.url))){
    if(!/\.(jsx?|mjs)$/.test(name))continue;
    const source=await readFile(new URL(`../${folder}/${name}`,import.meta.url),'utf8');
    assert.equal(source.includes('\u00b7'),false,`${folder}/${name}: remove middle dots from authored copy`);
  }
});

test('font shorthand cannot bypass the Office typography token guard',()=>{
  assert.throws(()=>validateOfficeCss('.dialog { font: 12px Arial; }'),/shared color and type tokens/);
  assert.throws(()=>validateOfficeCss('.dialog { font-size: 12px; }'),/shared color and type tokens/);
  assert.throws(()=>validateOfficeCss('.dialog { font: var(--deck-font-body); font-size: 12px; }'),/shared color and type tokens/);
  assert.throws(()=>validateOfficeCss('.dialog { font-family: var(--cx-font-family), Arial; }'),/shared color and type tokens/);
  assert.doesNotThrow(()=>validateOfficeCss('.dialog { font-size: var(--deck-type-body); line-height: var(--deck-line-body); }'));
});
