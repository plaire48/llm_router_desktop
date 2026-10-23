import test from 'node:test';
import assert from 'node:assert/strict';
import {MAILBOX_TABS,mailboxTabsFor,mailboxSelection,personalMailFolders} from '../ui/mailbox-navigation.mjs';
test('four stable Korean mailboxes migrate old server and imported-folder selections',()=>{
 assert.deepEqual(MAILBOX_TABS.map(item=>item.label),['받은 메일함','보낸 메일함','임시 보관함','스팸 메일함']);
 const folders=[{id:'3',name:'Drafts',mailbox:'draft'},{id:'9',name:'Trash',mailbox:'trash'}];
 assert.equal(mailboxSelection('folder:3',folders),'draft');assert.equal(mailboxSelection('local:sent',folders),'sent');
 for(const invalid of ['folder:9','folder:99','all','mail','local:notice'])assert.equal(mailboxSelection(invalid,folders),'inbox');
 for(const {key} of MAILBOX_TABS)assert.equal(mailboxSelection(key,folders),key);
});
test('observed Desktop mail has a reachable category without guessing its native mailbox',()=>{
 const tabs=mailboxTabsFor({desktop:{mode:'desktop',transport:'uia'}});assert.equal(tabs.at(-1).key,'other');assert.equal(mailboxSelection('other'),'other');
 assert.equal(mailboxTabsFor({localKinds:['other']}).at(-1).key,'other');assert.equal(mailboxTabsFor({desktop:{mode:'portal',transport:'uia'}}),MAILBOX_TABS);
 for(const connectionMethod of ['portal','pop3'])assert.equal(mailboxTabsFor({connectionMethod,desktop:{mode:'desktop',transport:'uia'}}),MAILBOX_TABS);
});
test('personal folders preserve exact IDs across re-entry and only invalid/deleted folders fall back',()=>{
 const folders=[{id:'7',name:'프로젝트 자료',mailbox:'other'},{id:'8',name:'프로젝트 자료',mailbox:'other'},{id:'9',name:'Trash',mailbox:'trash'},{id:'7',name:'중복',mailbox:'other'},{id:'invalid',mailbox:'other'}];
 assert.deepEqual(personalMailFolders(folders).map(folder=>folder.id),['7','8']);
 assert.equal(mailboxSelection('folder:7',folders),'folder:7');
 assert.equal(mailboxSelection('folder:8',folders),'folder:8');
 assert.equal(mailboxSelection('folder:7',[]),'inbox');
 assert.deepEqual(personalMailFolders(),[]);
});
