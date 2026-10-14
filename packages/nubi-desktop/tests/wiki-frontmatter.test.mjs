import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {splitFrontmatter,firstHeading,describeWikiPage,threadEdges}=createRequire(import.meta.url)('../electron-app/wiki-frontmatter.cjs');
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

test('mail pages with the same thread form a chain ordered by date',()=>{
  const page=describeWikiPage('---\ntype: Mail\ntitle: "Re: 일정"\nthread: "abc"\nmessage_id: "<2@x>"\nin_reply_to: "<1@x>"\ndate: "2026-10-02T01:00:00Z"\n---\n# Re: 일정\n','mail/2026-10/re-일정.md');
  assert.equal(page.thread,'abc');assert.equal(page.messageId,'<2@x>');assert.equal(page.inReplyTo,'<1@x>');assert.equal(page.date,'2026-10-02T01:00:00Z');
  const edges=threadEdges([
    {path:'mail/b.md',thread:'abc',date:'2026-10-02T01:00:00Z'},
    {path:'mail/a.md',thread:'abc',date:'2026-10-01T01:00:00Z'},
    {path:'mail/c.md',thread:'other',date:'2026-10-03T01:00:00Z'},
    {path:'mail/d.md',thread:'',date:'2026-10-03T01:00:00Z'}]);
  assert.deepEqual(edges,[{from:'mail/a.md',to:'mail/b.md',kind:'thread'}]);
});
test('legacy mail source metadata and category are recovered without rewriting source',()=>{
 const content='# 과거 메일\n\n## 출처\n\n- Source: portal/old\n- 발신: a@example.test\n- 메일 날짜: 2026-10-10\n- Category: 배포\n';
 const p=describeWikiPage(content,'old.md');assert.equal(p.type,'Mail');assert.equal(p.category,'배포');assert.equal(p.date,'2026-10-10');assert.equal(p.from,'a@example.test');assert.equal(p.body,content);
});
