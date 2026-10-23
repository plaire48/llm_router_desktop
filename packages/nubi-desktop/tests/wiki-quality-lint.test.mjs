import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lintPages,gradeWikiUse} from '../eval/wiki-quality/run.mjs';

test('usage grading normalizes page paths but requires current target-source evidence beyond a plan link',()=>{
 const row={path:'openwiki/guide.md',freshness:'unverified',sourceReferences:[]},linked=['openwiki/guide.md'];
 assert.deepEqual(gradeWikiUse('src/retry.mjs',[row],linked),{linked:true,grounded:false});
 assert.deepEqual(gradeWikiUse('src/retry.mjs',[{...row,path:'guide.md',freshness:'source_matched',sourceReferences:[{path:'src/retry.mjs',state:'source_matched'}]}],linked),{linked:true,grounded:true});
 assert.equal(gradeWikiUse('src/retry.mjs',[{...row,freshness:'source_matched',sourceReferences:[{path:'src/other.mjs',state:'source_matched'}]}],linked).grounded,false);
 assert.equal(gradeWikiUse('src/retry.mjs',[{...row,freshness:'source_changed',sourceReferences:[{path:'src/retry.mjs',state:'source_matched'}]}],linked).grounded,false);
});

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

test('repository-aware evaluation accepts an existing source README link and still reports missing links',()=>{
 const pages={'guide.md':'# Guide\n\n[Source](../README.md)\n[Missing](../missing.md)\n'};
 const result=lintPages(pages,{repositoryPaths:['README.md']});
 assert.equal(result.brokenLinks,1);assert.equal(result.rows[0].issues[0].target,'missing.md');
});
