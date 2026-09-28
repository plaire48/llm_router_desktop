// Finding a registered template from a slash command or a plain sentence.
// Retrieval only narrows the choice; it never opens a file or grants a write.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTemplateCommand,matchCommand,searchTemplates,suggestCommands} from '../worker/template-match.mjs';

const entry=(id,name,summary,extra={})=>({id:id.repeat(8)+'-'+id.repeat(4)+'-'+id.repeat(4)+'-'+id.repeat(4)+'-'+id.repeat(12),host:'excel',name,summary,revision:1,itemCount:1,inputCount:1,available:true,...extra});
const catalog=[entry('1','출장 신청서','임직원 국내외 출장 사전 신청'),entry('2','지출 결의서','부서 경비 지출 승인 요청'),entry('3','교육 신청서','사외 교육 수강 신청'),entry('4','견적서','고객사 제출용 물품 견적'),entry('5','출장 정산서','출장 후 경비 정산')];
const names=list=>list.map(item=>item.name);

test('a slash command is split into the template name and the rest of the request',()=>{
  assert.deepEqual(parseTemplateCommand('/출장신청서 부산에 2박 3일'),{name:'출장신청서',rest:'부산에 2박 3일'});
  assert.deepEqual(parseTemplateCommand('  /견적서'),{name:'견적서',rest:''});
  assert.deepEqual(parseTemplateCommand('/"지출 결의서" 사무용품 구입'),{name:'지출 결의서',rest:'사무용품 구입'});
  assert.deepEqual(parseTemplateCommand('/'),{name:'',rest:''});
  for(const text of ['출장 신청서 작성해줘','합계는 A1/B1로 계산해줘','https://example.com/견적서',''])assert.equal(parseTemplateCommand(text),null);
});
test('a command names a template by its exact name, ignoring spaces and case',()=>{
  assert.deepEqual([matchCommand('출장신청서',catalog).decision,names(matchCommand('출장신청서',catalog).candidates)],['use',['출장 신청서']]);
  assert.deepEqual(names(matchCommand('출장 신청서',catalog).candidates),['출장 신청서']);
  assert.equal(matchCommand('견적서',catalog).candidates[0].id,catalog[3].id);
  assert.equal(matchCommand('QUOTE',[entry('9','Quote','견적')]).decision,'use');
});
test('a partial name that fits several templates asks the user to choose',()=>{
  const partial=matchCommand('출장',catalog);
  assert.deepEqual([partial.decision,names(partial.candidates)],['choose',['출장 신청서','출장 정산서']]);
  assert.deepEqual([matchCommand('신청',catalog).decision,names(matchCommand('신청',catalog).candidates)],['choose',['출장 신청서','교육 신청서']]);
  assert.deepEqual([matchCommand('결의',catalog).decision,names(matchCommand('결의',catalog).candidates)],['use',['지출 결의서']]);
});
test('an exact name wins over longer names that contain it',()=>{
  const withLonger=[...catalog,entry('6','견적서 (해외)','해외 고객용 견적')];
  assert.deepEqual([matchCommand('견적서',withLonger).decision,names(matchCommand('견적서',withLonger).candidates)],['use',['견적서']]);
});
test('initial consonants name a template',()=>{
  assert.deepEqual([matchCommand('ㅊㅈㅅㅊㅅ',catalog).decision,names(matchCommand('ㅊㅈㅅㅊㅅ',catalog).candidates)],['use',['출장 신청서']]);
  assert.deepEqual(names(matchCommand('ㅊㅈ',catalog).candidates),['출장 신청서','출장 정산서']);
  assert.deepEqual(names(matchCommand('ㄱㅈㅅ',catalog).candidates),['견적서']);
});
test('an unknown or empty command matches nothing and an unavailable file is never offered',()=>{
  assert.deepEqual([matchCommand('회의록',catalog).decision,matchCommand('회의록',catalog).candidates],['none',[]]);
  assert.equal(matchCommand('',catalog).decision,'choose');assert.equal(matchCommand('',catalog).candidates.length,4,'an empty command lists the first templates');
  assert.equal(matchCommand('',[]).decision,'none');
  assert.equal(matchCommand('견적서',[entry('4','견적서','견적',{available:false})]).decision,'none');
});
test('a sentence finds the templates it is about, best first',()=>{
  for(const [request,expected] of [['출장 신청서 작성해줘','출장 신청서'],['부산 출장 가는데 신청서 써줘','출장 신청서'],['견적서 만들어줘. 수신은 대한상사','견적서'],['경비 쓴 거 결의서 올려야 해','지출 결의서'],['교육 받으려고 하는데 신청해줘','교육 신청서'],['출장 다녀와서 정산해야 해','출장 정산서']])
    assert.equal(searchTemplates(request,catalog)[0]?.name,expected,request);
});
test('a request about something else finds no template',()=>{
  for(const request of ['A2를 4로 바꿔줘','선택한 표의 합계를 알려줘','회의록 작성해줘','B열을 굵게 해줘'])assert.deepEqual(searchTemplates(request,catalog),[],request);
});
test('search results are bounded and carry only what the router needs',()=>{
  const many=Array.from({length:40},(_,index)=>entry(String(index%10),'신청서 '+index,'신청'));
  const found=searchTemplates('신청서 작성해줘',many.map((item,index)=>({...item,id:item.id.slice(0,-2)+String(index).padStart(2,'0')})));
  assert.equal(found.length,4);assert.deepEqual(Object.keys(found[0]),['id','name','summary','score']);
  assert.ok(searchTemplates('견적서',[entry('4','견적서','가'.repeat(3000))])[0].summary.length<=200);
});
test('malformed catalog entries are ignored instead of trusted',()=>{
  const broken=[null,{id:'x',name:'견적서'},{...catalog[3],name:''},{...catalog[3],host:'word'},catalog[3]];
  assert.deepEqual(names(searchTemplates('견적서 작성',broken)),['견적서']);assert.deepEqual(names(matchCommand('견적서',broken).candidates),['견적서']);
});
test('while a command is being typed the registered templates are suggested, best match first',()=>{
  assert.deepEqual(names(suggestCommands('/',catalog)),['출장 신청서','지출 결의서','교육 신청서','견적서','출장 정산서']);
  assert.deepEqual(names(suggestCommands('/출장',catalog)),['출장 신청서','출장 정산서']);
  assert.deepEqual(names(suggestCommands('/신청',catalog)),['출장 신청서','교육 신청서']);
  assert.deepEqual(names(suggestCommands('/ㅈㅊ',catalog)),['지출 결의서']);
  assert.deepEqual(names(suggestCommands('/정산서',[...catalog,entry('6','정산서','월별 정산')])),['정산서','출장 정산서'],'an exact name comes before a name that only contains it');
  assert.deepEqual(suggestCommands('/회의록',catalog),[]);
});
test('a suggestion carries the command that calls it, and the command finds the same template again',()=>{
  const [first]=suggestCommands('/지출',catalog);
  assert.deepEqual(Object.keys(first),['id','name','summary','command']);assert.equal(first.command,'/지출결의서 ');
  assert.equal(matchCommand(parseTemplateCommand(first.command+'사무용품 구입').name,catalog).candidates[0].id,first.id);
  const odd=suggestCommands('/',[entry('7','2026 "상반기" 보고')])[0];
  assert.equal(matchCommand(parseTemplateCommand(odd.command).name,[entry('7','2026 "상반기" 보고')]).decision,'use');
});
test('suggestions end when the request begins, and never appear for ordinary text',()=>{
  for(const draft of ['','견적서 작성해줘','/견적서 대한상사','/견적서\n','a/견적서',' /견적서',null,undefined])assert.equal(suggestCommands(draft,catalog),null,String(draft));
  assert.equal(suggestCommands('/'+'가'.repeat(101),catalog),null);
});
test('suggestions are bounded and ignore entries of another host or malformed entries',()=>{
  const many=Array.from({length:40},(_,index)=>({...entry('8','신청서 '+index,'신청'),id:'88888888-8888-8888-8888-8888888888'+String(index).padStart(2,'0')}));
  assert.equal(suggestCommands('/',many).length,6);assert.equal(suggestCommands('/',many,{limit:3}).length,3);
  assert.deepEqual(names(suggestCommands('/',[null,{...catalog[0],host:'word'},{...catalog[1],available:false},catalog[3]])),['견적서']);
  assert.ok(suggestCommands('/견',[entry('4','견적서','가'.repeat(3000))])[0].summary.length<=200);
});
