import {createProgressEstimator} from './remaining-time.mjs';
const states=new Set(['queued','running','waiting','completed','failed','cancelled','interrupted']);
export const taskIsActive=state=>['queued','running','waiting'].includes(state);
const fields=['title','label','risk','state','value','max','phase','startedAt','finishedAt'];
export function createBackgroundTaskQueue({now=Date.now,historyLimit=30}={}){
 const rows=new Map(),actions=new Map(),estimates=new Map(),listeners=new Set();let serial=0,snapshot=[];
 const estimate=(id,at=now())=>{const row=rows.get(id);if(!row||row.state!=='running')return {state:'unknown'};if(!estimates.has(id))estimates.set(id,createProgressEstimator());return estimates.get(id)({id:row.phase||row.title,completed:row.value,total:row.max,now:at});};
 const publish=()=>{snapshot=[...rows.values()].map(row=>({...row,canOpen:!!actions.get(row.id)?.open,canCancel:!!actions.get(row.id)?.cancel}));for(const listen of listeners){try{listen();}catch{}}};
 function update(id,patch={},controls){
  const previous=rows.get(id);if(!previous&&!taskIsActive(patch.state))return;
  // A delayed progress response cannot revive a settled operation.
  if(previous&&!taskIsActive(previous.state)&&taskIsActive(patch.state))return;
  const row={...(previous||{id,startedAt:now(),state:'running'})};
  for(const key of fields)if(patch[key]!==undefined)row[key]=patch[key];
  row.state=states.has(row.state)?row.state:'waiting';
  row.max=Number.isFinite(row.max)&&row.max>0?row.max:100;
  row.value=Number.isFinite(row.value)?Math.max(0,Math.min(row.max,row.value)):null;
  if(!Number.isFinite(row.startedAt))row.startedAt=now();
  if(!taskIsActive(row.state))row.finishedAt=Number.isFinite(patch.finishedAt)?patch.finishedAt:previous?.state===row.state&&previous?.finishedAt||now();
  if(controls)actions.set(id,{...actions.get(id),...controls});
  rows.set(id,row);
  if(row.state!=='running')estimates.delete(id);
  estimate(id);
  const history=[...rows.values()].filter(item=>!taskIsActive(item.state));
  for(const old of history.slice(0,Math.max(0,history.length-historyLimit))){const release=actions.get(old.id)?.release;rows.delete(old.id);actions.delete(old.id);estimates.delete(old.id);release?.();}
  publish();return id;
 }
 return {update,begin:(patch,controls)=>{const id=`operation-${++serial}`;update(id,{...patch,state:'running'},controls);return id;},
  get:id=>rows.get(id),estimate,controlsFor:id=>actions.get(id)||{},getSnapshot:()=>snapshot,subscribe:listen=>{listeners.add(listen);return()=>listeners.delete(listen);},
  controls(id,value){if(!rows.has(id))return;actions.set(id,{...actions.get(id),...value});publish();},
  open:id=>actions.get(id)?.open?.(),cancel:id=>Promise.resolve().then(()=>actions.get(id)?.cancel?.()).catch(()=>update(id,{label:'중지하지 못했어요. 현재 상태를 확인해 주세요.'})),
  dismiss(id){const row=rows.get(id);if(!row||taskIsActive(row.state))return;const release=actions.get(id)?.release;rows.delete(id);actions.delete(id);estimates.delete(id);release?.();publish();},
  clearFinished(){for(const [id,row]of rows)if(!taskIsActive(row.state)){const release=actions.get(id)?.release;rows.delete(id);actions.delete(id);estimates.delete(id);release?.();}publish();}
 };
}
export const backgroundTasks=createBackgroundTaskQueue();
export const backgroundJobId=(kind,job)=>job?.startedAt?`${kind}:${job.id||''}:${job.startedAt}`:null;
export function mailImportTask(job){
 const id=backgroundJobId('mail-import',job);if(!id)return null;
 const state=({scanning:'running',importing:'running',completed:job.failures?.length?'waiting':'completed',cancelled:'cancelled',interrupted:'interrupted',failed:'failed'})[job.state]||'waiting';
 return {id,title:'메일 파일 가져오기',state,label:state==='running'?(job.state==='scanning'?'파일 찾는 중':`${job.completed||0} / ${job.total||0}개 처리`):state==='waiting'?`읽지 못한 파일 ${job.failures?.length||0}개 확인`:undefined,value:job.state==='importing'&&job.total>0?job.completed:null,max:job.state==='importing'?job.total:100,startedAt:Date.parse(job.startedAt)};
}
export function wikiPreparationTask(job){
 const id=backgroundJobId('wiki',job);if(!id)return null;
 const state=({running:'running',completed:'completed',cancelled:'cancelled',attention:'failed',paused:'waiting',partial:'waiting'})[job.state];if(!state)return null;
 return {id,title:'프로젝트 위키 준비',state,label:job.state==='partial'?'일부 완료. 남은 문서 확인':job.state==='paused'?'연결 대기':job.state==='attention'?'준비 결과 확인 필요':undefined,value:Number.isFinite(job.percent)?job.percent:null,max:100,startedAt:Date.parse(job.startedAt)};
}
