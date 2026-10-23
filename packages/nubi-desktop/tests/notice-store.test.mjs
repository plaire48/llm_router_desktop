import test from 'node:test';import assert from 'node:assert/strict';
import {recordNotice,dismissNotice,clearNotices,noticesSnapshot} from '../ui/notice-store.js';
// A decision notice ("답변 요청: …") leaves the bell when the decision is answered; its 열기 action has nothing left to open.
test('a keyed notice is dismissed alone and the unread count follows',()=>{
 clearNotices();
 recordNotice({text:'일반 알림'});recordNotice({text:'답변 요청: 경로?',kind:'decision',key:'decision:q1',action:{label:'열기',onClick(){}}});
 assert.equal(noticesSnapshot().unread,2);
 assert.equal(dismissNotice('decision:q1'),true);
 assert.deepEqual(noticesSnapshot().notices.map(n=>n.text),['일반 알림']);assert.equal(noticesSnapshot().unread,1);
 assert.equal(dismissNotice('decision:q1'),false,'already gone');
 clearNotices();
});
