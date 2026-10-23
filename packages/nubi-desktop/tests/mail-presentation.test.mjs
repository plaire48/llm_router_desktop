import test from 'node:test';
import assert from 'node:assert/strict';
import {mailSender,mailTableDate,recipientRole,mailRoleLabel} from '../runtime/mail-presentation.mjs';
import {mailFilters} from '../runtime/mail-search-options.mjs';
import {PersonalMail} from '../runtime/mail.mjs';
test('sender uses explicit directory fields or name/email without invented company',()=>{assert.equal(mailSender({from:'홍길동 <hong@company.test>'}),'홍길동 / hong@company.test');assert.equal(mailSender({sender:{name:'홍길동',address:'hong@company.test',department:'개발팀',company:'누비'}}),'홍길동 / 개발팀 / 누비');assert.equal(mailSender({from:'hong@company.test'}),'hong@company.test');});
test('raw recipient-header matching keeps missing addresses distinct from the application category',()=>{const mail={to:'A <a@example.test>',cc:'B <b@example.test>',bcc:'C <c@example.test>'};assert.equal(recipientRole(mail,'A@example.test'),'to');assert.equal(recipientRole(mail,'b@example.test'),'cc');assert.equal(recipientRole(mail,'c@example.test'),'bcc');assert.equal(recipientRole(mail,'d@example.test'),'unknown');assert.equal(recipientRole(mail,'username'),'unknown');});
test('unclassified recipient categories display as Bcc and old saved filters join that category',()=>{
 for(const role of ['unknown',undefined,null,''])assert.equal(mailRoleLabel(role),'비밀참조');
 assert.equal(mailRoleLabel('to'),'수신');assert.equal(mailRoleLabel('cc'),'참조');assert.equal(mailRoleLabel('sent'),'발신');
 assert.deepEqual(mailFilters({roles:['unknown','bcc','cc']}).roles,['bcc','cc']);
});
test('the host uses Bcc for unmatched recipients while preserving known roles and original addresses',()=>{
 const owner={store:{get:()=>[]}},row={account:'fixture',mailbox:'inbox',protocol:'portal'},mail={receivedAddress:'owner@example.test',to:'other@example.test',cc:'',bcc:''},before=structuredClone(mail);
 assert.equal(PersonalMail.prototype.recipientRole.call(owner,mail,row),'bcc');assert.deepEqual(mail,before);
 assert.equal(PersonalMail.prototype.recipientRole.call(owner,{...mail,to:'owner@example.test'},row),'to');
 assert.equal(PersonalMail.prototype.recipientRole.call(owner,{...mail,cc:'owner@example.test'},row),'cc');
 assert.equal(PersonalMail.prototype.recipientRole.call(owner,mail,{...row,mailbox:'sent'}),'sent');
 assert.equal(PersonalMail.prototype.recipientRole.call(owner,mail,{...row,protocol:'local',recipientRole:'unknown'}),'bcc');
});
test('mail table shows explicit local year-month-day hour:minute and missing is distinct',()=>{assert.equal(mailTableDate(new Date(2026,9,12,9,5).toISOString()),'2026-10-12 09:05');assert.equal(mailTableDate(null),'날짜 미확인');assert.equal(mailTableDate('invalid'),'날짜 미확인');});
