import test from 'node:test';import assert from 'node:assert/strict';import {browserCollaboration} from '../a2a-connection.js';
const binding={taskId:'task',runId:'run',conversationId:'chat',provider:'aipro'};
function setup(reply,task){const chat={sessionId:'chat',provider:'aipro',messages:[reply],task},session={a2a:{binding}};return browserCollaboration({session:async()=>session,saveSession:async value=>Object.assign(session,value),conversation:async()=>({chat}),saveChat:async()=>{}});}
test('failed or interrupted completed-looking answers cannot be delivered as A2A drafts',async()=>{
 for(const [reply,task] of [[{id:'run',role:'assistant',state:'done',content:'partial',error:'verification_required'},undefined],[{id:'run',role:'assistant',state:'done',content:'partial'},{requestId:'run',status:'paused'}],[{id:'other',role:'assistant',state:'done',content:'unrelated'},undefined]])await assert.rejects(setup(reply,task).dispatch({action:'result',id:'task'}),/a2a_no_result/);
});
test('an unanswered user question keeps A2A mutations paused without a network call',async()=>{
 const receiver=setup({id:'run',role:'assistant',state:'done',content:'',question:{id:'question',text:'어느 팀인가요?'}});
 await assert.rejects(receiver.dispatch({action:'connect',url:'http://127.0.0.1:9876'}),/a2a_busy/);
});
