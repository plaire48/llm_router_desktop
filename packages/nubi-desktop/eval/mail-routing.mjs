// Real-model smoke evaluation over fixed synthetic emails and Personal Wiki
// files. No mailbox login, company data, synthesis or live server is exercised.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkspace} from './corpus.mjs';
import {connectRelayProviders,defaultSocketPath} from './relay.mjs';
import {recordingProviders} from './transcript.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {PersonalMail} from '../runtime/mail.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {readRunMetrics} from '../runtime/run-metrics.mjs';
import {disableHostedTracing} from '../runtime/worker-environment.mjs';
disableHostedTracing(process.env);
installAgent(ProjectService);
const option=name=>process.argv[process.argv.indexOf('--'+name)+1];
const output=process.argv.includes('--out')?option('out'):'verification/eval-live/mail-routing-20261012';
const sha=text=>createHash('sha256').update(text).digest('hex');
const workspace=await createWorkspace({corpus:'order-service'});
const service=new ProjectService({storageRoot:workspace.stateRoot});
let provider,timer;
try{
 await service.open(workspace.root);
 provider=await connectRelayProviders({socketPath:defaultSocketPath()});
 const transcript=[];
 const recorded=recordingProviders(provider,{write:entry=>transcript.push(entry),maxModelCalls:30,maxDelegatedCalls:10});
 service.providers=recorded;
 const root=path.join(workspace.stateRoot,'fixture-personal');await mkdir(root,{recursive:true});
 const data=new Map(),rows=[],bodies=new Map();
 const mail=Object.create(PersonalMail.prototype);
 Object.assign(mail,{root,wikiRoot:root,store:{get:key=>data.get(key),set:(key,value)=>data.set(key,value)},rows:()=>rows,searchSignature:async row=>row.sourceHash,source:async row=>structuredClone(bodies.get(row.id))});
 for(const [index,date,body,note] of [
  [0,'2026-10-08','가을 캠페인은 11월 10일에 시작합니다.','가을 캠페인 시작 예정일: 11월 10일'],
  [1,'2026-10-10','가을 캠페인 최종 일정을 11월 12일로 변경했습니다. 이전 11월 10일 일정은 취소합니다.','가을 캠페인 관련 일정 변경 안내. 원문 확인 필요.']
 ]){
  const id=sha('synthetic-mail-'+index),text='# 가을 캠페인\n\n'+note,filename=path.join(root,id+'.md');await writeFile(filename,text);
  const row={id,date,state:'saved',from:'홍보팀 <promotion@example.test>',path:filename,sourceHash:sha(body),wikiHash:sha(text),contentScope:'body_and_metadata'};
  rows.push(row);data.set('mail:'+id,row);bodies.set(id,{subject:'가을 캠페인 일정'+(index?' 변경':''),from:row.from,date,text:body,attachments:[]});
 }
 service.mail=args=>mail.call(args);
 const task=await service.createTask({request:'/mail 홍보팀의 가을 캠페인 일정이 최종 언제인지 찾아줘. 변경 전과 최종 일정을 구분하고 근거 메일을 표시해 줘.'});
 const started=Date.now();timer=setTimeout(()=>service.stopAgent({taskId:task.id}).catch(()=>{}),300000);
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const result=service.task(task.id),answer=result.messages?.findLast(item=>item.role==='assistant'),operations=service.store.list('operation:').filter(row=>row.taskId===task.id);
 const checks={delivered:result.state==='review'&&!!answer?.content,dates:/11(?:월\s*|[./-])10/.test(answer?.content||'')&&/11(?:월\s*|[./-])12/.test(answer?.content||''),searched:operations.some(row=>row.tool==='personal_mail_query'),readBoth:rows.every(source=>operations.some(row=>row.tool==='read_personal_mail'&&row.state==='completed'&&row.receipt?.id===source.id)),citedBoth:rows.every(row=>answer?.sourceReferences?.some(ref=>ref.id===row.id)),scope:operations.every(row=>['personal_mail_query','read_personal_mail','update_plan','select_tools','discover_capabilities','use_skill','read_skill','list_skill_resources'].includes(row.tool))};
 const report={kind:'real-model-synthetic-mail-smoke',provider:provider.status().provider,model:provider.status().model,checks,passed:Object.values(checks).every(Boolean),state:result.state,error:result.error||null,answer:answer?.content||'',elapsedMs:Date.now()-started,metrics:readRunMetrics(service.store,{taskId:task.id}).summary,limits:'One synthetic case, one trial. Actual Personal Wiki reads and mail search; fixture original-mail transport. Not POP3, company mail, Wiki synthesis, Windows or overall model accuracy.'};
 await mkdir(output,{recursive:true});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await writeFile(path.join(output,'transcript.jsonl'),transcript.map(row=>JSON.stringify(row)).join('\n')+'\n');
 console.log(JSON.stringify({passed:report.passed,checks,state:report.state,error:report.error,elapsedMs:report.elapsedMs}));
 if(!report.passed)process.exitCode=1;
}finally{clearTimeout(timer);service.dispose();provider?.dispose();service.store.close();await workspace.dispose();}
