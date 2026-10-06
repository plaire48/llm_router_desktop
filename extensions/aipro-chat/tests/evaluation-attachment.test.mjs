import test from 'node:test';
import assert from 'node:assert/strict';
import {validEvaluationAttachment} from '../scripts/evaluation-attachment.mjs';
const task={id:'E-08',environment:'public-live',readOnly:true};
const input=()=>({attachment:{status:'harness_interrupted',candidateSha256:'candidate-A',evaluatorSha256:'a'.repeat(64),publicReadCapture:{allowedPages:['https://search.naver.com/search.naver']},trials:[{id:'E-08',status:'harness_interrupted'},{id:'E-07',status:'answered'}]},reuseProfile:true,candidateSha256:'candidate-A',plannedTaskIds:['E-08'],publicReadPages:['https://search.naver.com/search.naver'],suite30:true,fixtureApprovals:false,selectedTasks:[task],freshAfterInterruption:true});
test('fresh attachment allows only interrupted public read-only tasks on the exact saved candidate',()=>{
  assert(validEvaluationAttachment(input()));
  for(const patch of [{candidateSha256:'candidate-B'},{freshAfterInterruption:false},{plannedTaskIds:['E-07']},{publicReadPages:['https://other.test/']},{fixtureApprovals:true},{selectedTasks:[{...task,readOnly:false}]},{reuseProfile:false}]) assert(!validEvaluationAttachment({...input(),...patch}));
});
test('the original login-only attachment does not accept executed or interrupted trials',()=>{
  const value=input();value.freshAfterInterruption=false;value.attachment={...value.attachment,status:'login_not_completed',trials:[],plannedTaskIds:['E-08']};
  assert(validEvaluationAttachment(value));
  value.attachment.trials=[{id:'E-08',status:'answered'}];assert(!validEvaluationAttachment(value));
});
test('repeat uses a separate trial only for an entirely recorded read-only suite on the same candidate',()=>{
  const v=input();v.freshAfterInterruption=false;v.repeatRecorded=true;
  v.attachment={...v.attachment,status:'trials_recorded',plannedTaskIds:['E-08'],trials:[{id:'E-08',status:'answered'}]};
  assert(validEvaluationAttachment(v));
  for(const patch of [{candidateSha256:'different'},{freshAfterInterruption:true},{plannedTaskIds:['E-07']},
    {selectedTasks:[{...task,readOnly:false}]},{attachment:{...v.attachment,status:'interrupted'}},
    {attachment:{...v.attachment,trials:[{id:'E-08',status:'awaiting_user'}]}},
    {attachment:{...v.attachment,trials:[{id:'E-08',status:'timeout',stopConfirmed:false}]}}])
    assert(!validEvaluationAttachment({...v,...patch}));
  v.attachment.trials=[{id:'E-08',status:'timeout',stopConfirmed:true}];
  assert(validEvaluationAttachment(v));
});
test('closed-screen recovery starts only the exact unrecorded remainder, including fresh local fixtures',()=>{
  const v={...input(),freshAfterInterruption:false,unrunRemainder:true,model:'gpt-5.6-sol',fixtureApprovals:true,
    publicReadPages:[],plannedTaskIds:['H-08','H-09'],selectedTasks:[{id:'H-08',environment:'local-fixture',readOnly:false},{id:'H-09',environment:'local-fixture',readOnly:false}]};
  v.attachment={...v.attachment,status:'setup_error',model:v.model,publicReadCapture:{allowedPages:[]},
    operatorSetup:{fixtureTransferApprovals:true},plannedTaskIds:['H-07','H-08','H-09'],trials:[{id:'H-07',status:'runner_error'}]};
  assert(validEvaluationAttachment(v));
  for(const patch of [{model:'gpt-5.6-luna'},{candidateSha256:'different'},{plannedTaskIds:['H-07','H-08','H-09']},
    {plannedTaskIds:['H-09']},{freshAfterInterruption:true},{repeatRecorded:true},{reuseProfile:false},
    {attachment:{...v.attachment,status:'trials_recorded'}},{attachment:{...v.attachment,operatorSetup:{}}},
    {selectedTasks:[{id:'H-09'},{id:'H-08'}]}]) assert(!validEvaluationAttachment({...v,...patch}));
});
test('Sol/Luna comparison uses the same candidate and an entirely new 30-task run after a recorded evaluation',()=>{
 const ids=['E','M','H'].flatMap(level=>Array.from({length:10},(_,index)=>`${level}-${String(index+1).padStart(2,'0')}`));
 const v={...input(),freshAfterInterruption:false,modelComparison:true,model:'gpt-5.6-luna',plannedTaskIds:ids,
   selectedTasks:ids.map(id=>({id})),publicReadPages:[],fixtureApprovals:true};
 v.attachment={...v.attachment,status:'trials_recorded',model:'gpt-5.6-sol',publicReadCapture:{allowedPages:[]},
   operatorSetup:{fixtureTransferApprovals:true},trials:[{id:'H-03',status:'answered'}]};
 assert(validEvaluationAttachment(v));
 for(const patch of [{model:'gpt-5.6-sol'},{model:'other-model'},{candidateSha256:'other'},
   {unrunRemainder:true},{plannedTaskIds:ids.slice(1)},{selectedTasks:[{id:'E-01'}]},
   {attachment:{...v.attachment,status:'interrupted'}},{attachment:{...v.attachment,trials:[{id:'H-03',status:'running'}]}},
   {attachment:{...v.attachment,trials:[{id:'H-03',status:'timeout',stopConfirmed:false}]}}]) assert(!validEvaluationAttachment({...v,...patch}));
});
test('public setup retry requires zero model requests and no prior submission',()=>{
 const v={...input(),freshAfterInterruption:false,retryUnsent:true,model:'gpt-5.6-sol'};
 v.attachment={...v.attachment,model:v.model,plannedTaskIds:['E-08'],trials:[{id:'E-08',status:'runner_error',modelRequests:0}]};
 assert(validEvaluationAttachment(v));
 for(const trial of [{...v.attachment.trials[0],modelRequests:1},{...v.attachment.trials[0],submission:{}},{...v.attachment.trials[0],status:'answered'}])
   assert(!validEvaluationAttachment({...v,attachment:{...v.attachment,trials:[trial]}}));
 assert(!validEvaluationAttachment({...v,selectedTasks:[{...task,readOnly:false}]}));
});
