// One request, one record (user decision 2026-10-14, as Codex shows it): a run that stopped at an approval or a
// failure and went on in the next run is the earlier part of that run's record, not a second plan and record.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationActivity} from '../ui/conversation-activity.mjs';
const user=id=>({id,role:'user',content:'q'}),answer=(id,runId)=>({id,role:'assistant',runId,content:'a'});
const step=(runId,status='done')=>({id:runId+':0:0',runId,tool:'read_source',status});

test('a run that stopped at an approval and went on is the earlier part of the run that continued it',()=>{
  const task={state:'review',responseTiming:{runId:'r3'},messages:[user('U1'),answer('A1','r1'),user('U2'),answer('A3','r3')],
    activityHistory:[{runId:'r1',trace:[step('r1')],afterMessageId:'U1'},{runId:'r2',trace:[step('r2','waiting')],afterMessageId:'U2'}]};
  const layout=conversationActivity(task);
  assert.equal(layout.runId,'r3');assert.deepEqual(layout.predecessors.map(run=>run.runId),['r2']);
  assert.equal(layout.after.size,0,'the continued run is not placed on its own');
  assert.deepEqual(layout.before.get(task.messages[1])?.map(run=>run.runId),['r1'],'an answered run keeps its place before its answer');
});

test('a chain of continuations merges in order, and a run nobody continued keeps its place',()=>{
  const task={state:'running',responseTiming:{runId:'r4'},messages:[user('U1'),answer('A1','r1'),user('U2')],
    activityHistory:[{runId:'r1',trace:[step('r1')],afterMessageId:'U1'},{runId:'r2',trace:[],afterMessageId:'U2'},{runId:'r3',trace:[step('r3')],afterMessageId:'U2'}]};
  assert.deepEqual(conversationActivity(task).predecessors.map(run=>run.runId),['r2','r3']);
  const stalled={state:'paused',messages:[user('U1'),answer('A1','r1'),user('U2')],activityHistory:[{runId:'r2',trace:[step('r2','error')],afterMessageId:'U2'}]};
  const alone=conversationActivity(stalled);
  assert.deepEqual(alone.predecessors,[]);assert.deepEqual(alone.after.get(stalled.messages[2])?.map(run=>run.runId),['r2'],'kept after its message until something continues it');
});

test('a history run with an answer takes the runs that led to it; a run that asked a question stays its own',()=>{
  const task={state:'review',responseTiming:{runId:'r5'},messages:[user('U1'),answer('A2','r2'),user('U3'),answer('A5','r5')],
    activityHistory:[{runId:'r1',trace:[step('r1','waiting')],afterMessageId:'U1'},{runId:'r2',trace:[],afterMessageId:'A2'},{runId:'r4',trace:[step('r4','waiting')],afterMessageId:'U3'}]};
  const layout=conversationActivity(task);
  const beforeAnswer=layout.before.get(task.messages[1]);assert.deepEqual(beforeAnswer.map(run=>run.runId),['r2']);assert.deepEqual(beforeAnswer[0].predecessors.map(run=>run.runId),['r1']);
  assert.deepEqual(layout.predecessors.map(run=>run.runId),['r4']);
  const asked={state:'review',responseTiming:{runId:'r3'},questionHistory:[],messages:[user('U1'),{id:'Q2',role:'assistant',runId:'r2',questionId:'q',content:'어느 쪽?'},answer('A3','r3')],
    activityHistory:[{runId:'r2',trace:[step('r2')],question:{id:'q'},afterMessageId:'Q2'}]};
  const separate=conversationActivity(asked);
  assert.deepEqual(separate.before.get(asked.messages[1])?.map(run=>run.runId),['r2']);assert.deepEqual(separate.predecessors,[]);
});
