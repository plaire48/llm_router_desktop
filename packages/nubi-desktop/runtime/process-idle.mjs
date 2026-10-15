import {randomUUID} from 'node:crypto';
import {makeQuestion} from '../../../extensions/aipro-chat/user-question.js';

// A silent command is not a failed command. Ask without killing or replaying it.
export function installProcessIdle(ProjectService) {
  ProjectService.prototype.processIdle=function(record){
    this.idleProcessQueue.add(record.id);
    this.drainRecovery().catch(()=>{});
  };
  ProjectService.prototype.drainProcessIdle=function(){
    if(this.disposed||this.setupBusy||this.newFileBusy||this.computerBusy||this.reconciling)return;
    for(const id of this.idleProcessQueue||[]){
      const record=this.processes.records.get(id);
      if(!record||record.state!=='running'||!record.idleRequestedAt){this.idleProcessQueue.delete(id);continue;}
      const task=this.task(record.taskId);
      if(task.state==='cancelled'){this.idleProcessQueue.delete(id);continue;}
      if(this.agentForTask(task.id)?.running||task.question||['pending','connected'].includes(task.computerConnectionRequest?.state))continue;
      const action=record.setupActionId&&this.store.get('setup-action:'+record.setupActionId);
      const title=(action?.title||'명령 실행').replace(/[\r\n]/g,' ').slice(0,60);
      const seconds=Math.max(1,Math.floor((Date.now()-record.lastOutputAt)/1000));
      const elapsed=seconds<60?`${seconds}초`:`${Math.floor(seconds/60)}분${seconds%60?` ${seconds%60}초`:''}`;
      const question={...makeQuestion(`${title}: ${elapsed} 동안 새 출력이 없어요. 계속 기다릴까요?`,[],[],{
        choices:[{label:'계속 기다리기',description:'실행을 유지하고 5분 뒤 다시 확인'},
          {label:'중지하고 원인 확인',description:'종료를 확인한 뒤 기존 출력으로 분석. 자동 재실행 안 함'}],
        inputMode:'none',selection:'single'
      }),processIdle:{id,previousState:task.state},runId:task.responseTiming?.runId};
      task.question=question;task.state='waiting_input';
      task.messages=[...(task.messages||[]),{id:randomUUID(),questionId:question.id,runId:question.runId,role:'assistant',content:question.text,at:new Date().toISOString()}];
      this.store.set('task:'+task.id,task);this.idleProcessQueue.delete(id);
    }
  };
  ProjectService.prototype.resolveProcessIdle=function(record,reason,answer){
    if(!record)return;
    this.idleProcessQueue?.delete(record.id);
    const task=this.store.get('task:'+record.taskId),question=task?.question;
    if(question?.processIdle?.id!==record.id)return;
    task.questionHistory=[...(task.questionHistory||[]),{...question,resolvedBy:reason,...(answer?{answer:{text:answer,at:new Date().toISOString()}}:{})}];
    task.question=null;
    if(task.state==='waiting_input')task.state=reason==='restart'?'interrupted':question.processIdle.previousState;
    this.store.set('task:'+task.id,task);
    queueMicrotask(()=>this.drainRecovery().catch(()=>{}));
  };
  ProjectService.prototype.answerProcessIdle=function(task,text){
    const id=task.question.processIdle.id,record=this.processes.records.get(id);
    if(!record||record.taskId!==task.id||record.state!=='running'||!record.idleRequestedAt)throw Error('question_changed');
    if(!['계속 기다리기','중지하고 원인 확인'].includes(text))throw Error('answer_invalid');
    if(text==='계속 기다리기')this.processes.continueWaiting(id);
    else this.processes.stop(id,'idle_review');
    this.resolveProcessIdle(record,'answered',text);
    return {accepted:true,processId:id,state:record.state};
  };
}
