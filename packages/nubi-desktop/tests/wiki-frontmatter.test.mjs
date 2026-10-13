import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {splitFrontmatter,firstHeading,describeWikiPage}=createRequire(import.meta.url)('../electron-app/wiki-frontmatter.cjs');
test('front matter is split from the body and known fields are typed',()=>{
  const page='---\ntype: Process\ntitle: "주문 흐름"\ndescription: 장바구니에서 결제까지\ntags: [order, state]\n---\n# 주문 흐름\n\n본문';
  const {meta,body,frontmatter}=splitFrontmatter(page);
  assert.deepEqual(meta,{type:'Process',title:'주문 흐름',description:'장바구니에서 결제까지',tags:['order','state']});
  assert.equal(body,'# 주문 흐름\n\n본문');assert.equal(frontmatter,page.slice(0,page.indexOf('# ')));
  assert.deepEqual(splitFrontmatter('---\ntags:\n  - a\n  - b\nextra: 1\n---\nbody').meta,{tags:['a','b'],extra:'1'});
  assert.deepEqual(splitFrontmatter('---\r\ntype: Reference\r\n---\r\n본문').meta,{type:'Reference',tags:[]});
});
test('pages without front matter, with an unclosed fence or a rule in the body stay intact',()=>{
  for(const text of ['# 제목\n\n본문','---\ntype: x\n본문 끝','본문\n\n---\n\n다음',''])assert.deepEqual(splitFrontmatter(text),{meta:{},body:text,frontmatter:''});
  assert.deepEqual(splitFrontmatter('---\n---\n본문'),{meta:{tags:[]},body:'본문',frontmatter:'---\n---\n'});
});
test('a page is described by front matter, then its first heading, then its file name',()=>{
  assert.equal(firstHeading('intro\n## sub\n# Title #\n'),'Title');
  assert.deepEqual(describeWikiPage('---\ntype: Policy\ndescription: 환불 기간\ntags: [payment]\n---\n# 환불 규칙\n','payments/refund.md'),{title:'환불 규칙',type:'Policy',description:'환불 기간',tags:['payment'],body:'# 환불 규칙\n',frontmatter:'---\ntype: Policy\ndescription: 환불 기간\ntags: [payment]\n---\n'});
  assert.equal(describeWikiPage('본문만','ops/monitoring.md').title,'monitoring');
  assert.equal(describeWikiPage('---\ntitle: '+'가'.repeat(200)+'\n---\n','a.md').title.length,160);
});
