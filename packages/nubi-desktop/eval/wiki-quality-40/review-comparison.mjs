import{readFile,writeFile}from'node:fs/promises';
import{connectRelayProviders,defaultSocketPath}from'../relay.mjs';
export const CLAIM_GUIDANCE='Check material entailment, not just quoted words: "only if X" states a necessary condition; it does not prove X alone is sufficient or the only condition. Missing authority/owner/approval information does not prove no authority/owner/approval exists. An observation or arrival date is not an effective date. A later message does not override a conflicting decision without supersession or authority evidence. Reject these overclaims with revise and a precise wording correction; do not ask for unrelated investigation. Accept a narrowly attributed statement that preserves the actual condition or unknown.';
const p=await connectRelayProviders({socketPath:defaultSocketPath()}),results=[];
try{
 for(const [group,id,replacement,expected] of [
  [2,'personal-02',null,'revise'],
  [3,'personal-12','우선 권한도 없다고 명시되어 있습니다. 따라서 결정할 수 없습니다.','revise'],
  [2,'personal-02','메일상 배포 승인에는 보안 검토 통과가 필요하지만, 후속 메일에서는 검토가 아직 완료되지 않았습니다. 따라서 이 자료에서는 승인 조건이 충족됐다고 확인할 수 없습니다.','ready'],
  [3,'personal-12',null,'ready'],
 ]){
  const original=JSON.parse(await readFile(`verification/openwiki-quality-2026-10-15/final-${group}/${id}-trial1.json`));
  const entry=original.transcript.findLast(e=>e.request.messages[0]?.content?.startsWith('Nubi Desktop independent'));
  const messages=structuredClone(entry.request.messages),data=JSON.parse(messages[1].content);
  // Keep citation keys from the observed answer for concise control candidates.
  if(replacement)data.candidate=replacement+' '+(original.answer.match(/\[\d+\]\(#nubi-cite-[^)]+\)/g)||[]).filter((v,i,a)=>a.indexOf(v)===i).join(' ');
  messages[1].content=JSON.stringify(data);messages[0].content+='\n'+CLAIM_GUIDANCE;
  const result=await p.complete(messages,[],undefined,undefined,undefined,undefined,{responseFormat:{type:'json_object'},maxTokens:3000});
  let parsed;try{parsed=JSON.parse(result.content);}catch{parsed=null;}
  results.push({id,replacement,expected,passed:parsed?.status===expected,result:parsed||result.content});console.log(id+' '+expected+' '+parsed?.status);
 }
}finally{p.dispose();}
await writeFile('verification/openwiki-quality-2026-10-15/review-comparison.json',JSON.stringify({scope:'Fixed review inputs with additional entailment guidance, not complete-agent trials.',guidance:CLAIM_GUIDANCE,results},null,2)+'\n');
