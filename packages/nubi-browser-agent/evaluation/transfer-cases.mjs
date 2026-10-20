// Evaluation only. Site profiles and oracle values never enter the generic runtime.
export const documents = Object.freeze({
  news:{title:'뉴스',path:'/docs/serviceapi/search/news/news.md',endpoint:'https://openapi.naver.com/v1/search/news.json',sort:['date','sim'],timeField:'pubDate'},
  blog:{title:'블로그',path:'/docs/serviceapi/search/blog/blog.md',endpoint:'https://openapi.naver.com/v1/search/blog.json',sort:['date','sim'],timeField:'postdate'},
  web:{title:'웹문서',path:'/docs/serviceapi/search/web/web.md',endpoint:'https://openapi.naver.com/v1/search/webkr.json',sort:[],timeField:null},
  book:{title:'책 기본 검색',path:'/docs/serviceapi/search/book/book.md',endpoint:'https://openapi.naver.com/v1/search/book.json',sort:['date','sim'],timeField:'pubdate'},
  encyclopedia:{title:'백과사전',path:'/docs/serviceapi/search/encyclopedia/encyclopedia.md',endpoint:'https://openapi.naver.com/v1/search/encyc.json',sort:[],timeField:null},
});
export const cases=Object.freeze([
  {id:'new-query',title:'새 검색어와 기존 상세 3개',start:'home',query:'site:developers.naver.com/docs/serviceapi/search 웹문서 블로그 뉴스',kinds:['web','blog','news']},
  {id:'new-documents',title:'미학습 상세 2개',start:'home',query:'site:developers.naver.com/docs/serviceapi/search 책 백과사전 API 레퍼런스',kinds:['book','encyclopedia']},
  {id:'different-start',title:'다른 검색 화면과 상세 1개',start:'results',query:'site:developers.naver.com/docs/serviceapi/search/book/book.md 책 검색 JSON',kinds:['book']},
]);
export function schedule(repetitions=3){
  if(!Number.isInteger(repetitions)||repetitions<1||repetitions>10)throw Error('repetitions_invalid');
  const result=[];
  for(let index=1;index<=repetitions;index++)for(let offset=0;offset<cases.length;offset++){
    const task=cases[(offset+index-1)%cases.length];
    for(const arm of (index+offset)%2?['none','reuse']:['reuse','none'])result.push({index,caseId:task.id,arm});
  }
  return result;
}
export function requestFor(task){
  const subjects=task.kinds.map(kind=>`${documents[kind].title}(kind=${kind})`).join(', ');
  return `현재 요청에 맞는 검증된 검색 하위 절차가 있으면 현재 검색어와 조회할 문서 제목 조건을 함께 지정하세요. 없거나 대상이 다르면 현재 관찰의 일반 도구로 진행하세요. 절차 완료 후에도 실제 조회와 정리를 끝내야 합니다. 현재 네이버 검색창에 "${task.query}"를 입력하고 Enter로 검색하세요. AI 검색은 누르지 마세요. 검색 결과에서 공식 네이버 개발자 문서 ${subjects}, 총 ${task.kinds.length}개를 browser_read_documents로 새로 읽으세요. 현재 documentLinks의 linkId만 선택하고 검색 요약으로 답하지 마세요. JSON 요청 endpoint, display 최댓값, 문서에 명시한 sort 값(명시하지 않으면 빈 배열), 개별 결과의 시간 필드(없으면 null)를 정리하세요. 책은 책 기본 검색 결과 조회를 대상으로 하며 상세 검색 전용 API와 구분하세요. 최종 답변은 {"items":[{"kind":"요청한 kind","url":"실제로 읽은 상세 URL","sourceId":"읽기 결과의 sourceId","endpoint":"JSON 요청 URL","displayMax":숫자,"sort":["명시된 값"],"timeField":"필드명 또는 null"}],"summary":"${task.kinds.length>1?'공통점과 차이':'조회 내용'}를 한국어 120자 안팎으로 요약"} JSON 객체만 반환하세요. 요청하지 않은 문서를 추가하지 마세요. 로그인, API 호출, 다른 데이터 변경은 하지 않습니다.`;
}
export function verifyAnswer(task,answer,{query,sources,oracles}){
  const kinds=task.kinds;
  const checks={query:query===task.query,freshDocuments:oracles.size===kinds.length,items:Array.isArray(answer?.items)&&answer.items.length===kinds.length,fields:false,summary:typeof answer?.summary==='string'&&answer.summary.length>=20};
  checks.fields=checks.items&&new Set(answer.items.map(x=>x.kind)).size===kinds.length&&kinds.every(kind=>{
    const expected=documents[kind],item=answer.items.find(x=>x.kind===kind),actual=oracles.get(kind),source=sources.get(item?.sourceId);
    return actual&&source&&source.url==='https://developers.naver.com'+expected.path&&item.url===source.url&&item.endpoint===expected.endpoint&&item.displayMax===100&&Array.isArray(item.sort)&&item.sort.every(x=>typeof x==='string')&&JSON.stringify([...item.sort].sort())===JSON.stringify(expected.sort)&&item.timeField===expected.timeField&&actual.endpoint&&actual.display&&actual.sort&&actual.time;
  });
  return checks;
}
export function summarize(report){
  const median=xs=>{const a=[...xs].sort((a,b)=>a-b),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:null;};
  const byArm=arm=>{
    const rows=report.trials.filter(x=>x.arm===arm),finished=rows.filter(x=>Number.isFinite(x.totalMs));
    return {trials:rows.length,finished:finished.length,successes:rows.filter(x=>x.success).length,within25:rows.filter(x=>x.success&&x.totalMs<25000).length,medianMs:median(finished.map(x=>x.totalMs)),maxMs:finished.length?Math.max(...finished.map(x=>x.totalMs)):null,calls:rows.map(x=>x.modelCalls),wikiHits:rows.flatMap(x=>x.knowledge??[]).filter(x=>x.status==='matched').length,knowledgeMisses:rows.flatMap(x=>x.knowledge??[]).filter(x=>x.status==='missing').length};
  };
  return {none:byArm('none'),reuse:byArm('reuse'),cases:cases.map(task=>({id:task.id,...Object.fromEntries(['none','reuse'].map(arm=>{const rows=report.trials.filter(x=>x.arm===arm&&x.caseId===task.id);return [arm,{completed:rows.filter(x=>x.success).length,allThreeSucceeded:rows.length===3&&rows.every(x=>x.success),timesMs:rows.map(x=>x.totalMs??null),medianMs:median(rows.filter(x=>Number.isFinite(x.totalMs)).map(x=>x.totalMs)),calls:rows.map(x=>x.modelCalls)}];}))})),complete:report.trials.length===report.schedule.length&&report.trials.every(x=>Number.isFinite(x.totalMs)),frozenKnowledge:report.memoryUnchanged===true};
}
