import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPortalMetadata,portalAddress} from '../runtime/portal-mail-metadata.mjs';
import {recipientRole} from '../runtime/mail-presentation.mjs';
const original={subject:'MIME title',date:'2026-10-12T01:00:00Z',to:'other@example.test',cc:'',bcc:'',text:'Original body'};
test('the observed portal field names map to title, local date and each recipient list',()=>{
 const mail=applyPortalMetadata(original,{subject:'Portal title',localdate:'2026-10-13T12:34:00+09:00',receivedAddress:'Alias <alias@example.test>',toRecipients:[{name:'수신자',email:'other@example.test'}],ccRecipients:[{displayName:'본인 별칭',emailAddress:{address:'alias@example.test'}}],bccRecipients:[{address:'hidden@example.test'}]});
 assert.equal(mail.subject,'Portal title');assert.equal(mail.date,'2026-10-13T03:34:00.000Z');assert.match(mail.to,/수신자/);assert.match(mail.cc,/alias@example.test/);assert.match(mail.bcc,/hidden@example.test/);assert.equal(mail.receivedAddress,'alias@example.test');assert.equal(recipientRole(mail,mail.receivedAddress),'cc');assert.equal(mail.text,original.text);
});
test('receivedAddress matches explicit To/Cc/Bcc, without guessing Bcc when lists omit the account',()=>{
 for(const [key,role] of [['toRecipients','to'],['ccRecipients','cc'],['bccRecipients','bcc']]){const mail=applyPortalMetadata({...original,to:''},{receivedAddress:'owner@example.test',[key]:[{email:'owner@example.test'}]});assert.equal(recipientRole(mail,mail.receivedAddress),role);}
 const mail=applyPortalMetadata(original,{receivedAddress:'owner@example.test',toRecipients:['other@example.test']});assert.equal(recipientRole(mail,mail.receivedAddress),'unknown');assert.equal(mail.bcc,'');
});
test('missing or malformed portal fields retain MIME facts and do not claim an address or date',()=>{
 const mail=applyPortalMetadata(original,{subject:'',localdate:'not-a-date',toRecipients:null,receivedAddress:'unknown-id'});assert.deepEqual(mail,original);assert.equal(portalAddress('one@example.test, two@example.test'),'');assert.deepEqual(applyPortalMetadata(original,null),original);
});
