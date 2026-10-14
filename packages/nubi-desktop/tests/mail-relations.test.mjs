import test from 'node:test';
import assert from 'node:assert/strict';
import {mailRelations} from '../runtime/mail-relations.cjs';
const mail=(id,extra={})=>({id,subject:'누비 배포 검증 일정',from:'a@example.test',to:'b@example.test',date:'2026-10-10T09:00:00Z',sourceHash:'hash-'+id,...extra});
test('headers retain reply direction and hashes even if titles change or clocks disagree',()=>{
 const {edges}=mailRelations([mail('a',{messageId:'<a@x>',date:'2026-10-12'}),mail('b',{subject:'완전히 다른 제목',inReplyTo:'<a@x>'})]);
 assert.equal(edges.length,1);assert.equal(edges[0].kind,'reply');assert.equal(edges[0].from,'a');assert.equal(edges[0].to,'b');assert.equal(edges[0].confidence,'header');assert.equal(edges[0].chronology,undefined);assert.equal(edges[0].evidence[0].hash,'hash-a');
});
test('header-free portal mail links same and similar topics with dates as candidates',()=>{
 const rows=[mail('a'),mail('b',{subject:'RE: 누비 배포 검증 일정',date:'2026-10-12'}),mail('c',{subject:'누비 배포 검증 결과',date:'2026-10-13'})];
 const {edges}=mailRelations(rows,{focusId:'a'});assert.equal(edges.length,2);assert(edges.every(e=>e.confidence==='candidate'&&e.chronology));assert(edges.some(e=>e.kind==='same_topic'));assert(edges.some(e=>e.kind==='similar_topic'));assert(!edges.some(e=>e.kind==='causes'));
});
test('generic type, common recipient, date alone, different project brackets and account do not establish links',()=>{
 assert.equal(mailRelations([mail('a',{subject:'공지'}),mail('b',{subject:'공지'})]).edges.length,0);
 assert.equal(mailRelations([mail('a',{subject:'[프로젝트A] 일정'}),mail('b',{subject:'[프로젝트B] 일정'})]).edges.length,0);
 assert.equal(mailRelations([mail('a'),mail('b',{account:'other'})]).edges.length,0);
 assert.equal(mailRelations([mail('a'),mail('b',{date:'2020-01-01'})]).edges.length,0);
 assert.equal(mailRelations([mail('a'),mail('b',{date:''})]).edges.length,0);
});
test('related selection is bounded and reports omitted neighbours',()=>{
 const result=mailRelations(Array.from({length:30},(_,i)=>mail('m'+i)),{focusId:'m0'});assert.equal(result.edges.length,8);assert.equal(result.truncated,true);
});
test('different named project markers do not link solely through shared workflow terms',()=>{
 assert.equal(mailRelations([mail('a',{subject:'[공장A] 배포 검증 일정'}),mail('b',{subject:'[공장B] 배포 검증 일정'})]).edges.length,0);
});
