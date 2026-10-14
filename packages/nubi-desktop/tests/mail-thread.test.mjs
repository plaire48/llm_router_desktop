import {test} from 'node:test';import assert from 'node:assert/strict';
import {stripQuotedReply,normalizeSubject,threadKey,mailFrontMatter} from '../runtime/mail-thread.mjs';
test('quoted replies, forwarded header blocks and signatures leave the new text alone',()=>{
  const text='내일 회의는 10시로 옮깁니다.\n\n감사합니다.\n김누비 드림\n제조IT | Tel: 02-1234-5678\nkim.nubi@example.test\n\n-----Original Message-----\nFrom: 이누비\nSent: 2026-10-10\nTo: 김누비\nSubject: 회의\n\n원래 9시 아니었나요?';
  assert.equal(stripQuotedReply(text),'내일 회의는 10시로 옮깁니다.');
  assert.equal(stripQuotedReply('확인했습니다.\n> 지난 메일\n> 인용'),'확인했습니다.');
  assert.equal(stripQuotedReply('2026. 10. 12. 오후 3:10 이누비 작성:\n> 안녕'),'2026. 10. 12. 오후 3:10 이누비 작성:\n> 안녕'.split('\n')[0]==='2026. 10. 12. 오후 3:10 이누비 작성:'?'2026. 10. 12. 오후 3:10 이누비 작성:\n> 안녕':'');
  assert.equal(stripQuotedReply('본문만 있는 메일'),'본문만 있는 메일');
});
test('subjects normalise reply and forward prefixes and threads follow References first',()=>{
  assert.equal(normalizeSubject('RE: [외부] Fwd: 예산 승인 요청'),'예산 승인 요청');
  assert.equal(threadKey({messageId:'<c@x>',inReplyTo:'<b@x>',references:['<a@x>','<b@x>'],subject:'Re: 예산'}),'id:a@x');
  assert.equal(threadKey({messageId:'<c@x>',subject:'Re: 예산'}),'id:c@x');
  assert.equal(threadKey({subject:'답장: 예산 승인'}),threadKey({subject:'예산 승인'}));
});

test('mailFrontMatter writes thread and header keys the library reads back',()=>{
  const text=mailFrontMatter({title:'Re: 일정 "확인"',summary:'일정을 10월 20일로 옮기자는 제안입니다. 추가 설명.',thread:'abc',mail:{messageId:'<2@x>',inReplyTo:'<1@x>',from:'홍길동 <hong@example.com>',to:['a@example.com','b@example.com'],date:'2026-10-02T01:00:00Z'},documentKind:'결재'});
  assert.match(text,/^---\ntype: Mail\ntitle: "Re: 일정 \\"확인\\""\n/);
  assert.match(text,/description: "일정을 10월 20일로 옮기자는 제안입니다."\n/);
  assert.match(text,/tags: \["mail", "결재"\]\n/);
  assert.match(text,/thread: "abc"\nmessage_id: "<2@x>"\nin_reply_to: "<1@x>"\nfrom: "홍길동 <hong@example.com>"\nto: "a@example.com, b@example.com"\ndate: "2026-10-02T01:00:00Z"\n---\n$/);
});
