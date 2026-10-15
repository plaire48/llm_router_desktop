import test from 'node:test';
import assert from 'node:assert/strict';
import {MAILBOX_TABS,mailboxSelection} from '../ui/mailbox-navigation.mjs';
test('four stable Korean mailboxes migrate old server and imported-folder selections',()=>{
 assert.deepEqual(MAILBOX_TABS.map(item=>item.label),['받은 메일함','보낸 메일함','임시 보관함','스팸 메일함']);
 const folders=[{id:'3',name:'Drafts',mailbox:'draft'},{id:'9',name:'Trash',mailbox:'trash'}];
 assert.equal(mailboxSelection('folder:3',folders),'draft');assert.equal(mailboxSelection('local:sent',folders),'sent');
 for(const invalid of ['folder:9','folder:99','all','mail','local:notice'])assert.equal(mailboxSelection(invalid,folders),'inbox');
 for(const {key} of MAILBOX_TABS)assert.equal(mailboxSelection(key,folders),key);
});
