// Evaluation-only synthetic corpus and frozen oracle. Never imported by runtime.
import {createHash} from 'node:crypto';
export const CORPUS_REVISION='synthetic-s1-v1';
const digest=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
const id=(prefix,n)=>prefix+String(n).padStart(3,'0');
export function searchFixture(){
 const files={},cases=[],language=n=>n<=20?'direct':n<=30?'korean-paraphrase':'mixed';
 for(let n=0;n<410;n++)files[`openwiki/00-background-${String(n).padStart(3,'0')}.md`]=`# 운영 참고 ${n}\n\n이 합성 문서는 독립된 장비 번호 ${n}의 정기 점검 이력입니다. 다른 계약이나 서비스의 정책으로 일반화하지 않습니다.\n`;
 function doc(name,title,lines,{source,stale=false}={}){
  const page='openwiki/'+name+'.md',content='# '+title+'\n\n'+lines.join('\n')+'\n';files[page]=content;
  if(source){const resource='repo://'+source,text=files[source];files['openwiki/.claims/'+name+'.json']=JSON.stringify({schemaVersion:1,pageVersion:digest(content),claims:[{id:name,statement:lines.filter(Boolean).at(-1),evidence:[{resource,version:'repo-file-v1:'+digest(stale?'earlier synthetic source\n':text)}]}]});}
  return {page,content};
 }
 function span(d,quote){const lines=d.content.split('\n'),at=lines.indexOf(quote);if(at<0)throw Error('fixture_span_missing');return {page:d.page,sourceHash:digest(d.content),start:at+1,end:at+1,quote};}
 function add(key,category,n,query,groups,facts,tags=[],extra={}){cases.push({id:key,category,language:language(n),query,answerable:category!=='none',corpusRevision:CORPUS_REVISION,evidenceGroups:groups.map(group=>({alternatives:group})),requiredFacts:facts,forbiddenClaims:[],tags,...extra});}
 for(let n=1;n<=40;n++){
  const key=id('F',n),name='가온'+String(n).padStart(2,'0'),value=10+n,source='src/contracts/'+key+'.mjs';files[source]=`export const retentionDays=${value};\n`;
  const quote=`보관 기한은 ${value}일입니다.`,stale=n>20;files[source]+='// '+quote+'\n';
  const d=doc('10-fact-'+key,`${name} 자료 계약`,[`${name}의 합성 자료 처리 계약입니다.`,'',quote],{source,stale});
  const query=n<=20?`${name} 자료의 보관 기한은 며칠인가요?`:n<=30?`${name} 자료 계약에 적힌 저장 기간과 단위를 알려주세요.`:`${name} retention days는 얼마로 문서화되어 있나요?`;
  add(key,'fact',n,query,[[span(d,quote)]],[String(value)+'일'],['after-401',...(stale?['stale-evidence']:[])]);
 }
 for(let n=1;n<=40;n++){
  const key=id('P',n),name='다온'+String(n).padStart(2,'0'),source='src/jobs/'+key+'.mjs';files[source]=`export const attempts=${n%4+1};\n`;
  const quote=n<=20?'원본 해시 확인 → 사본 작성 → 사용자 승인 → 결과 반영 순서입니다.':`응답이 끊기면 결과를 재조회하고, 확인 전에는 재전송하지 않습니다. 재시도 대기는 ${n+5}초입니다.`;
  files[source]+='// '+quote+'\n';
  const d=doc('20-procedure-'+key,`${name} 실행`,['## 운영 절차','',quote],{source});
  const query=n<=20?`${name}의 실행 전 확인부터 반영까지 순서는?`:n<=30?`${name} 작업 응답이 사라지면 무엇부터 해야 하고 기다리는 시간은?`:`${name} workflow의 timeout recovery와 retry wait를 문서 기준으로 설명해 주세요.`;
  add(key,'procedure',n,query,[[span(d,quote)]],[quote],['after-401']);
 }
 for(let n=1;n<=40;n++){
  const key=id('C',n),name='라온'+String(n).padStart(2,'0'),source=`src/modules/${key}/run.mjs`,testPath=`tests/modules/${key}/run.test.mjs`;
  files[source]=`export function run(){return ${n};}\n`;files[testPath]=`// Synthetic test for ${source}\n`;
  const quote=`실행 구현은 ${source}:1의 run이고 검사는 ${testPath}:1입니다.`;
  files[source]+='// '+quote+'\n';
  const padding=n>20?Array.from({length:14},(_,i)=>`운영 문맥 ${i+1}: 이 절의 공통 구조는 입력을 확인하고 결과를 기록하는 흐름입니다.`):[];
  const d=doc('30-code-'+key,'모듈 개발 가이드',['## '+name,'','### 실행 위치','',...padding,'',quote],{source});
  const query=n<=20?`${name}의 실행 함수 구현 경로와 검사 파일은?`:n<=30?`다른 run 구현과 구별하여 ${name} 개발 가이드의 실행 위치를 찾아 주세요.`:`${name} module의 run implementation과 test path를 각각 알려주세요.`;
  add(key,'code',n,query,[[span(d,quote)]],[source,testPath],[...(n>20?['heading-only']:[]),'same-symbol']);
 }
 for(let n=1;n<=40;n++){
  const key=id('M',n),name='마루'+String(n).padStart(2,'0'),source=`src/limits/${key}.mjs`,limit=20+n;files[source]=`export const batchLimit=${limit};\n`;
  const a=`${name}의 문서상 묶음 상한은 ${limit}개입니다.`,b=n<=20?`${name}의 반영은 담당자의 승인 뒤에만 가능합니다.`:`${source}:1의 batchLimit 값은 ${limit+1}입니다. 문서와 구현의 값이 다릅니다.`;
  files[source]=`export const batchLimit=${n<=20?limit:limit+1};\n// ${a}\n// ${b}\n`;
  const d1=doc('40-policy-'+key,`${name} 처리 정책`,[a],{source}),d2=doc('40-control-'+key,`${name} 통제와 구현`,[b],{source});
  const query=n<=20?`${name}의 묶음 상한과 반영 승인 조건을 함께 알려주세요.`:n<=30?`${name} 정책 문서와 구현 상한이 일치하나요? 두 근거를 비교해 주세요.`:`${name} documented limit과 implementation limit의 차이 및 source path는?`;
  add(key,'multi',n,query,[[span(d1,a)],[span(d2,b)]],[a,b],['two-sources']);
 }
 for(let n=1;n<=40;n++){
  const key=id('N',n),known='누리'+String(n).padStart(2,'0');let query,counterEvidence=[],reason;
  if(n<=20){query=`이 코퍼스에 없는 바다${n} 서비스의 퇴직금 계산 규칙은?`;reason='The named service and payroll policy are absent.';}
  else if(n<=30){const quote=`${known}의 무인 결제는 비활성화되어 있습니다.`,d=doc('50-counter-'+key,`${known} 기능 범위`,[quote]);counterEvidence=[span(d,quote)];query=`${known}에서 활성화된 무인 결제를 지금 실행하는 절차는?`;reason='The premise conflicts with the documented disabled capability.';}
  else{query=n<=35?`사내 personal account의 실제 ${n}월 급여를 알려주세요.`:`사용자 PC의 live screen과 로그인 비밀번호를 확인해 주세요. 요청 번호 ${n}.`;reason='Personal accounts and live devices are outside this synthetic repository.';}
  add(key,'none',n,query,[],[],[],{absenceReason:reason,counterEvidence});
 }
 return {revision:CORPUS_REVISION,files,cases};
}
export function validateSearchFixture({files,cases}){
 if(cases.length!==200||new Set(cases.map(c=>c.id)).size!==200)throw Error('search_case_count');
 for(const category of ['fact','procedure','code','multi','none'])if(cases.filter(c=>c.category===category).length!==40)throw Error('search_case_categories');
 for(const c of cases)for(const ref of [...c.evidenceGroups.flatMap(g=>g.alternatives),...(c.counterEvidence||[])]){
  const content=files[ref.page];if(typeof content!=='string'||digest(content)!==ref.sourceHash||content.split('\n').slice(ref.start-1,ref.end).join('\n')!==ref.quote)throw Error('search_case_span');
 }
 return {cases:cases.length,files:Object.keys(files).length,pages:Object.keys(files).filter(p=>p.endsWith('.md')).length};
}
