// Same JSON input for both algorithms; excludes transport and model time.
import {mergeSnapshot} from '../ui/mergeSnapshot.js';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Baseline algorithm from 2026-10-15 before structural sharing.
const same=(a,b)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}};
function before(previous,next){let changed=false;const merged={...previous};for(const [key,value] of Object.entries(next)){if(!same(previous[key],value)){merged[key]=value;changed=true;}}return changed?merged:previous;}
const previous={projectId:'fixture',tasks:Array.from({length:50},(_,i)=>({id:'task-'+i,state:i===0?'running':'review',messages:Array.from({length:10},(_,j)=>({id:`${i}-${j}`,content:('## 검증용 대화\n\n본문과 코드, 메일 근거를 유지합니다.\n').repeat(150),sourceReferences:[{path:'fixture.js',line:j+1}]})),trace:[{id:'step',status:'running'}]}))};
const next=JSON.parse(JSON.stringify(previous));next.tasks[0].trace[0].status='done';
const results={bytes:Buffer.byteLength(JSON.stringify(next)),scope:'Synthetic 50 tasks / 500 messages. Snapshot merge only; no model, network or Windows timing.'};
for(const [name,merge] of [['before',before],['after',mergeSnapshot]]){
 for(let i=0;i<3;i++)merge(previous,next);
 const times=[];for(let i=0;i<30;i++){const start=performance.now();const value=merge(previous,next);times.push(performance.now()-start);if(i===0){assert.deepEqual(value,next);results[name+'PreservesMessages']=value.tasks[0].messages===previous.tasks[0].messages;}}
 times.sort((a,b)=>a-b);results[name]={medianMs:times[15],p95Ms:times[28]};
}
await mkdir('verification/smooth-performance-2026-10-15',{recursive:true});await writeFile('verification/smooth-performance-2026-10-15/snapshot.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
