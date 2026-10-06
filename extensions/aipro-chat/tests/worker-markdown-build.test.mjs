import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {workerMarkdownBuild} from '../scripts/worker-markdown-build.mjs';

test('Markdown parser imports without a DOM in the worker bundle and preserves original outline offsets', async () => {
  const options = {entryPoints: ['browser-content-outline.js'], bundle: true, platform: 'browser', format: 'esm', write: false};
  const load = async extra => {
    const result = await build({...options, ...extra});
    return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  };
  assert.equal(typeof document, 'undefined');
  await assert.rejects(load({}), /document is not defined/);
  const {contentOutline} = await load(workerMarkdownBuild);
  const text = '# 이용 &copy;\n' + '본문 안내\n'.repeat(1000) + '\n## 예외 &amp; 조건\n회원 전용은 제외';
  const outline = contentOutline(text, 'a'.repeat(64));
  assert.equal(outline.total_sections, 2);
  assert.equal(outline.sections[0].heading, '# 이용 &copy;');
  assert.equal(outline.sections[1].start, text.indexOf('## 예외'));
  assert.equal(outline.content_hash, 'a'.repeat(64));
});
