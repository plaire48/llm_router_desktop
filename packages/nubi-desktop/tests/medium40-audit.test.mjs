import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditedFact} from '../eval/medium-40/audit-facts.mjs';
test('audit retains boundaries between times, room numbers and table cells',()=>{
 assert.equal(auditedFact('10월 22일 14:30, 301호',['14:30']),true);
 assert.equal(auditedFact('시각 14:31, 301호',['14:30']),false);
 assert.equal(auditedFact('성공: **2**건, 실패 1건',['성공 2']),true);
 assert.equal(auditedFact('| 성공 | 2건 |',['성공 2']),true);
 assert.equal(auditedFact('1,700원',['1700원']),true);
 assert.equal(auditedFact('11,700원',['1700원']),false);
 assert.equal(auditedFact('400',['40']),false);
 assert.equal(auditedFact('140/500',['40']),false);
 assert.equal(auditedFact('출처 [40](#source-1700원)',['1700원']),false);
 assert.equal(auditedFact('오류율 8.0%',['8%']),true);
 assert.equal(auditedFact('오류율 8.1%',['8%']),false);
 assert.equal(auditedFact('최종 성공은 2건, 실패는 1건입니다.',['성공 2']),true);
 assert.equal(auditedFact('최종 성공은 1건, 실패는 2건입니다.',['성공 2']),false);
});

test('an ISO date may end a sentence but must match the entire date',()=>{
 assert.equal(auditedFact('지원 종료일은 **2026-11-01**.',['2026-11-01']),true);
 assert.equal(auditedFact('지원 종료일은 2026-11-02.',['2026-11-01']),false);
 assert.equal(auditedFact('잘못된 날짜 2026-11-010.',['2026-11-01']),false);
 assert.equal(auditedFact('수량 40.5',['40']),false);
});

test('audit recognizes the same Korean calendar date without accepting another date',()=>{
 assert.equal(auditedFact('지원 종료일 **2026년 11월 1일**.',['2026-11-01']),true);
 assert.equal(auditedFact('지원 종료일 2026년 11월 11일.',['2026-11-01']),false);
 assert.equal(auditedFact('지원 종료일 2026년 12월 1일.',['2026-11-01']),false);
 assert.equal(auditedFact('지원 종료일 2027년 11월 1일.',['2026-11-01']),false);
});
