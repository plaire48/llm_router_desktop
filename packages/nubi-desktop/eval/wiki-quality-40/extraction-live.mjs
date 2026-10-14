import {mkdir,writeFile} from 'node:fs/promises';
import {connectRelayProviders,defaultSocketPath} from '../relay.mjs';
import {extractMailFacts} from '../../runtime/mail-facts.mjs';
import {candidateIdentity} from '../candidate.mjs';
const quote='최종 정정: 납기는 12월 15일이며 비용은 900만원입니다.';
const cases=[
 {id:'refusal',text:'배포 승인을 거절합니다.',expected:'거절'},
 {id:'conditional',text:'보안 검토를 통과할 때만 배포를 승인합니다.',expected:'통과할 때만'},
 {id:'owner',text:'결제 작업의 담당자는 김서연입니다.',expected:'김서연'},
 {id:'request',text:'배포를 승인해 주세요. 아직 승인 답변은 없습니다.',expected:'아직 승인 답변은 없습니다.'},
 {id:'tail-correction',text:'참고 설명입니다.\n'.repeat(400)+quote,expected:'900만원'},
];
const p=await connectRelayProviders({socketPath:defaultSocketPath()}),results=[];
try{for(const c of cases){const started=Date.now();let modelCalls=0;const result=await extractMailFacts({mail:{subject:c.id,text:c.text,date:'2026-10-15'},invoke:async(messages,tools,signal,kind,options)=>{modelCalls++;return p.complete(messages,tools,signal,undefined,undefined,undefined,options);}});const passed=result.facts.some(f=>f.value.includes(c.expected))&&result.coverage.complete;results.push({id:c.id,passed,elapsedMs:Date.now()-started,modelCalls,...result});console.log(c.id+' '+passed);}}finally{p.dispose();}
const out='verification/openwiki-quality-2026-10-15/extraction-live.json';await mkdir('verification/openwiki-quality-2026-10-15',{recursive:true});await writeFile(out,JSON.stringify({kind:'live-fact-extraction-component',candidate:await candidateIdentity(),model:p.status(),limitations:['Five synthetic examples, one trial. Not full mail ingestion or general entailment accuracy.'],results},null,2)+'\n');
