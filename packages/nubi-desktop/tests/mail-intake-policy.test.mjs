import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMailIntake,mailIntakeDecision} from '../runtime/mail-intake-policy.mjs';
test('scope validates dates and bounded lists rather than silently broadening an invalid selection',()=>{
 assert.throws(()=>normalizeMailIntake({period:'custom',from:'2026-02-30'}),/mail_intake_invalid/);
 assert.throws(()=>normalizeMailIntake({period:'custom',from:'2026-10-20',to:'2026-10-01'}),/mail_intake_invalid/);
 assert.throws(()=>normalizeMailIntake({includeSenders:['bad address']}),/mail_intake_invalid/);
 assert.throws(()=>normalizeMailIntake({mailboxes:[]}),/mail_intake_invalid/);
 assert.deepEqual(normalizeMailIntake({excludeSenders:['@EXAMPLE.TEST','@example.test']}).excludeSenders,['@example.test']);
});
test('the same scope applies to parsed POP3, portal, UIA and exported mail; exclusions win',()=>{
 const policy=normalizeMailIntake({period:'custom',from:'2026-10-01',to:'2026-10-31',includeSenders:['@example.test'],excludeSubjects:['홍보'],excludeSenders:['blocked@example.test']});
 for(const protocol of ['pop3','portal','local']){
  const mail={date:'2026-10-12T00:00:00Z',from:'누비 <owner@example.test>',subject:'검토 요청'};
  assert.equal(mailIntakeDecision(policy,mail,{protocol,mailbox:'inbox'}).include,true);
  assert.equal(mailIntakeDecision(policy,{...mail,subject:'신규 홍보 안내'},{protocol,mailbox:'inbox'}).reason,'excluded_subject');
  assert.equal(mailIntakeDecision(policy,{...mail,from:'blocked@example.test'},{protocol,mailbox:'inbox'}).reason,'excluded_sender');
  assert.equal(mailIntakeDecision(policy,{...mail,from:'owner@notexample.test'},{protocol,mailbox:'inbox'}).include,false);
  assert.equal(mailIntakeDecision(policy,{...mail,date:null},{protocol,mailbox:'inbox'}).reason,'date_unknown');
  assert.equal(mailIntakeDecision(policy,mail,{protocol,mailbox:'trash'}).include,false);
 }
});
test('relative periods use a captured clock and a date range includes the whole selected final day',()=>{
 const policy=normalizeMailIntake({period:'30'}),at=new Date('2026-10-24T12:00:00Z');
 assert.equal(mailIntakeDecision(policy,{date:'2026-01-01'},{mailbox:'inbox'},at).include,false);
 assert.equal(mailIntakeDecision(policy,{date:'2026-10-23'},{mailbox:'inbox'},at).include,true);
 const range=normalizeMailIntake({period:'custom',from:'2026-10-01',to:'2026-10-24'});
 const localEnd=new Date(2026,9,24,23,59,59).toISOString();assert.equal(mailIntakeDecision(range,{date:localEnd},{mailbox:'inbox'}).include,true);
});
