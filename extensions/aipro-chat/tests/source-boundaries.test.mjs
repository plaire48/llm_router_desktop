import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceBoundaryIndex} from '../source-boundaries.js';
import {contentPacket} from '../browser-content.js';
const hash='a'.repeat(64),tail='Temporary closure: closed March 2026.\nMembership excludes non-residents.',text='Opening hours are 09:00 to 18:00.\n'+'General visitor information.\n'.repeat(300)+tail;
test('first window indexes unread closure and exclusions; hash-bound continuation returns their actual words',async()=>{
  const source={url:'https://example.test/rules',frame:0,title:'Official rules',method:'fixture',text};const first=await contentPacket(source);
  assert(!first.ranges[0].markdown.includes(tail));assert(first.boundary_index.anchors.some(a=>a.start>5000&&a.kinds.includes('exception')));assert(first.boundary_index.scope.includes('not facts'));
  const anchor=first.boundary_index.anchors.find(a=>a.kinds.includes('exclusion'));
  const next=await contentPacket(source,{offset:anchor.read_offset,content_hash:first.content_hash});assert(next.ranges[0].markdown.includes(tail));assert.equal(next.boundary_index,undefined);
  const changed=await contentPacket({...source,text:text+'updated'},{offset:anchor.read_offset,content_hash:first.content_hash});assert.equal(changed.error,'browser_content_changed');
});
test('dense repeated dates cannot hide tail exceptions; candidates remain bounded with omissions disclosed',()=>{
  const result=sourceBoundaryIndex('2026 general notice\n'.repeat(600)+tail,hash);assert(result.anchors.length<=24);assert(result.omitted_keyword_matches>0);assert(result.anchors.some(a=>a.kinds.includes('exception')&&a.start>10000));assert(result.anchors.some(a=>a.kinds.includes('exclusion')&&a.start>10000));
  assert(result.anchors.every(a=>Number.isInteger(a.start)&&a.end<=12000+tail.length));assert(!result.anchors.some(a=>Object.hasOwn(a,'quote')||Object.hasOwn(a,'value')));
});
test('short sources and text without boundary words do not add a search requirement; indices never escape their source hash',()=>{
  assert.equal(sourceBoundaryIndex('Closed March 2026',hash),undefined);assert.equal(sourceBoundaryIndex('Visitor information. '.repeat(400),hash),undefined);
  const result=sourceBoundaryIndex('일반 안내\n'.repeat(1500)+'단, 외부인은 이용 불가\n2026년 3월 임시 휴관',hash);assert.equal(result.content_hash,hash);assert(result.anchors.some(a=>a.kinds.includes('condition')));assert(result.anchors.some(a=>a.kinds.includes('exception')));
});
test('a large unbroken source keeps fixed-size anchors and exact original positions',()=>{
  const long='2026 eligibility general information '.repeat(12000)+tail,index=sourceBoundaryIndex(long,hash);
  assert(index.anchors.length<=24);assert(index.omitted_keyword_matches>10000);
  assert(index.anchors.some(a=>a.start>long.length-300&&a.kinds.includes('exception')));
  assert(index.anchors.every(a=>a.start>=0&&a.end<=long.length&&a.end-a.start<=400));
});
