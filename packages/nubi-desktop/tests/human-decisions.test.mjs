import test from 'node:test';
import assert from 'node:assert/strict';
import {humanDecisions} from '../ui/human-decisions.mjs';
const task={id:'t',state:'review'};
const project={projectId:'p',tasks:[task]};
test('question, file, setup and repair gates use one actionable notification per conversation',()=>{
 const state={...project,proposals:[{id:'file',taskId:'t',state:'proposed'}],setupActions:[{id:'setup',taskId:'t',state:'proposed',afterProposals:['file']}],commandRepairs:[{id:'repair',taskId:'t',state:'proposed'}]};
 assert.equal(humanDecisions(state)[0].kind,'proposal');
 state.tasks=[{...task,state:'waiting_input',question:{id:'q'}}];assert.equal(humanDecisions(state)[0].id,'p:question:q');
 state.tasks=[task];state.proposals[0].state='applied';assert.equal(humanDecisions(state)[0].localId,'setup');
 state.setupActions[0].state='started';assert.equal(humanDecisions(state)[0].localId,'repair');
 state.commandRepairs[0].state='started';assert.deepEqual(humanDecisions(state),[]);
});
test('background conversations notify, cancelled/running tasks never invite actions',()=>{
 const tasks=['review','cancelled','running'].map((state,i)=>({id:'t'+i,state}));
 const proposals=tasks.map(t=>({id:'p'+t.id,taskId:t.id,state:'proposed'}));
 assert.deepEqual(humanDecisions({...project,tasks,proposals}).map(row=>row.taskId),['t0']);
});
test('computer connection, continuation, approval and uncertain results have distinct gates',()=>{
 const state={...project,tasks:[{...task,computerConnectionRequest:{id:'connect',state:'pending'}}],computer:{actions:[{id:'action',taskId:'t',state:'proposed'}]}};
 assert.deepEqual(humanDecisions(state),[],'disabled computer feature stays hidden');
 const options={computerUse:true};assert.equal(humanDecisions(state,options)[0].localId,'connect:pending');
 state.tasks[0].computerConnectionRequest.state='connected';assert.equal(humanDecisions(state,options)[0].localId,'connect:connected');
 state.tasks[0].computerConnectionRequest.state='resolved';assert.equal(humanDecisions(state,options)[0].localId,'action:proposed');
 state.computer.actions[0].state='attention';assert.equal(humanDecisions(state,options)[0].localId,'action:attention');
 state.computer.actions[0].state='observed';assert.equal(humanDecisions(state,options)[0].localId,'action:observed');
 state.computer.actions[0].review={state:'finished'};assert.deepEqual(humanDecisions(state,options),[]);
});
