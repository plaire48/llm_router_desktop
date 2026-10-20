import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lintPages} from '../eval/wiki-quality/run.mjs';

test('wiki quality lint counts empty sections, broken relative links and thin pages without a model',()=>{
 const pages={
  'index.md':'# 개요\n\n이 저장소는 합성 예제입니다. '.repeat(20)+'\n\n## 구성\n\n- [라우터](lib/router.md)\n- [없는 페이지](lib/missing.md)\n\n## 빈 절\n\n## 다음 절\n본문\n',
  'lib/router.md':'# 라우터\n\n짧음\n',
 };
 const result=lintPages(pages);
 assert.equal(result.pages,2);
 assert.equal(result.brokenLinks,1);
 assert.equal(result.emptySections,1);
 assert.equal(result.thinPages,1);
 const index=result.rows.find(r=>r.page==='index.md');
 assert.equal(index.links,2);assert.equal(index.brokenLinks,1);assert.equal(index.emptySections,1);assert.equal(index.thin,false);
});
