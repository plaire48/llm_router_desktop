import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchWorkers} from '../research-workers.js';
import {reviewEvidence,goalReviewMessages} from '../goal-review.js';
import {reviewProgress} from '../agent-runtime.js';

test('new child IDs and delivery counts do not manufacture external recovery progress',()=>{
  const page=reviewEvidence(1,'read_page',{}, {ok:true,text:'The same observed rule.'});
  const receipt=(id,calls)=>reviewEvidence(2,'research_receipt',{}, {ok:true,dataKind:'research_execution',task_id:id,calls,reads:1,delivered:true});
  assert.equal(reviewProgress([page,receipt('first',2)]),reviewProgress([page,receipt('second',3)]));
  assert.notEqual(reviewProgress([page,receipt('first',2)]),reviewProgress([reviewEvidence(1,'read_page',{}, {ok:true,text:'A new closure exception.'}),receipt('first',2)]));
});

test('a completed child records its actual assignment, reads and unresolved cleanup',async()=>{
  const receipts=[];const goal='Compare two institutions and exclude members-only entry.';
  const workers=createResearchWorkers({goal,signal:new AbortController().signal,
    browser:async op=>op.operation==='close'?{error:'research_cleanup_pending'}:{error:'research_login_required'},
    onDelivery:receipt=>receipts.push(receipt)});
  const tasks=['A','B'].map(subject=>({subject,question:'Check hours',fields:['hours'],start_url:`https://official.test/${subject}`,constraints:'Exclude members-only entry.'}));
  try {await workers.execute({tasks});}finally{workers.close();}
  assert.equal(receipts.length,2);
  for(let i=0;i<2;i++){
    assert.deepEqual(receipts[i].assignment,tasks[i]);assert.equal(receipts[i].original_goal,goal);
    assert.equal(receipts[i].calls,0);assert.equal(receipts[i].reads,0);assert.equal(receipts[i].status,'partial');
    assert.equal(receipts[i].cleanup,'pending');assert.equal(receipts[i].delivered,true);
  }
});

test('full research execution receipts survive observation pruning or reject the real budget',()=>{
  const receipt={ok:true,dataKind:'research_execution',original_goal:'Compare institutions',assignment:{constraints:'Exact original restrictions. '.repeat(900)},status:'partial',calls:2,reads:1,delivered:true,cleanup:'confirmed',source_reads:[]};
  const first=reviewEvidence(1,'research_receipt',{},receipt);assert.equal(first.truncated,false);
  const evidence=[first,...Array.from({length:40},(_,i)=>reviewEvidence(i+2,'verify_page',{}, {ok:true,verified:true,note:'Current observation '.repeat(130)}))];
  const payload=goalReviewMessages({goal:'Compare institutions',history:[],evidence,answer:'Partial findings',inputBudget:20000});
  assert.deepEqual(JSON.parse(payload.messages[1].content).evidence.find(item=>item.id===1).result,receipt);
  assert.throws(()=>goalReviewMessages({goal:'Compare institutions',history:[],evidence,answer:'Partial findings',inputBudget:1000}),error=>error.message==='goal_review_failed'&&error.reviewReason==='context_budget');
});
