import test from 'node:test';
import assert from 'node:assert/strict';
import {startWorkflowSite} from '../evaluation/site.mjs';
import {scoreWorkflow} from '../evaluation/workflows.mjs';

async function setup(t){
  const site=await startWorkflowSite();t.after(()=>site.close());
  const login=await fetch(site.origin+'/login',{method:'POST',headers:{origin:site.origin},redirect:'manual'});
  assert.equal(login.status,303);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const get=path=>fetch(site.origin+path,{headers:{cookie},redirect:'manual'});
  const save=fields=>fetch(site.origin+'/drafts',{method:'POST',headers:{cookie,origin:site.origin},body:new URLSearchParams(fields),redirect:'manual'});
  return {site,get,save};
}

test('workflow fixture requires synthetic user login, preserves target, and supports expiration',async t=>{
  const {site,get}=await setup(t);
  const unauth=await fetch(site.origin+'/mail/MAIL-201',{redirect:'manual'});
  assert.equal(unauth.status,303);assert.equal(unauth.headers.get('location'),'/login?next=%2Fmail%2FMAIL-201');
  assert.equal((await get('/mail/MAIL-201')).status,200);
  site.expireSessions();assert.equal((await get('/mail/MAIL-201')).status,303);
});

test('JSM filters exclude completed, wrong type and out-of-window issues; reading details is required',async t=>{
  const {site,get}=await setup(t);
  const listing=await (await get('/jsm?'+new URLSearchParams({type:'변경',status:'진행 중',from:'2026-10-16',to:'2026-10-17'}))).text();
  assert.match(listing,/CHG-104/);assert.match(listing,/CHG-105/);
  for(const wrong of ['CHG-099','INC-104','CHG-106'])assert.ok(!listing.includes(wrong));
  const output={sources:['CHG-104','CHG-105'],answer:'CHG-104 2026-10-16 22:00 KST 10분 접속 중단 기존 인증서 복원. CHG-105 2026-10-17 21:00 KST 검색 지연 이전 인덱스 복원.'};
  assert.ok(scoreWorkflow('JSM-01',output,site.snapshot()).failures.includes('source_not_opened'));
  await get('/jsm/CHG-104');await get('/jsm/CHG-105');assert.equal(scoreWorkflow('JSM-01',output,site.snapshot()).passed,true);
});

test('mail read oracle rejects fabricated sources and a same-subject decoy',async t=>{
  const {site,get}=await setup(t);await get('/mail/MAIL-202');
  const output={sources:['MAIL-201'],answer:'CHG-104 作業前 보안팀 확인이 필요합니다.'};
  assert.equal(scoreWorkflow('MAIL-01',output,site.snapshot()).passed,false);
  await get('/mail/MAIL-201');assert.equal(scoreWorkflow('MAIL-01',output,site.snapshot()).passed,true);
  assert.equal(scoreWorkflow('MAIL-01',{...output,sources:['MAIL-202']},site.snapshot()).passed,false);
});

test('draft oracle checks persisted recipients, facts, thread and no unexpected cc',async t=>{
  const {site,get,save}=await setup(t);await get('/jsm/CHG-104');
  const fields={to:'ops-team@example.invalid',subject:'CHG-104 안내',body:'CHG-104: 2026-10-16 22:00 KST, 10분 접속 중단'};
  const result=await save(fields);assert.equal(result.status,303);
  const draft=site.snapshot().drafts[0],output={sources:['CHG-104'],draftId:draft.id};
  assert.equal(scoreWorkflow('MAIL-02',output,site.snapshot()).passed,true);
  const wrong=site.snapshot();wrong.drafts[0].cc='other@example.invalid';assert.equal(scoreWorkflow('MAIL-02',output,wrong).passed,false);
  const changed=site.snapshot();changed.drafts[0].body='작업 예정입니다';assert.equal(scoreWorkflow('MAIL-02',output,changed).passed,false);
  const forged=site.snapshot();forged.sentCount=1;assert.equal(scoreWorkflow('MAIL-02',output,forged).passed,false);
  assert.equal((await get('/send')).status,404);
});

test('reply draft selects exact source and same-name wrong recipient fails independently',async t=>{
  const {site,get,save}=await setup(t);await get('/mail/MAIL-201');
  const compose=await (await get('/compose?replyTo=MAIL-201')).text();assert.match(compose,/minsu.ops@example.invalid/);assert.ok(!compose.includes('minsu.sales'));
  await save({to:'minsu.ops@example.invalid',replyTo:'MAIL-201',subject:'Re: 포털 인증서 교체 확인',body:'CHG-104 작업 전 보안팀 확인이 필요합니다.'});
  const output={sources:['MAIL-201'],draftId:site.snapshot().drafts[0].id};
  assert.equal(scoreWorkflow('MAIL-03',output,site.snapshot()).passed,true);
  const wrong=site.snapshot();wrong.drafts[0].to='minsu.sales@example.invalid';assert.equal(scoreWorkflow('MAIL-03',output,wrong).passed,false);
  const thread=site.snapshot();thread.drafts[0].replyTo='MAIL-202';assert.equal(scoreWorkflow('MAIL-03',output,thread).passed,false);
});

test('cross-system draft requires both sources and escaped output; other origins cannot save',async t=>{
  const {site,get,save}=await setup(t);await get('/jsm/CHG-104');
  await save({to:'ops-team@example.invalid',subject:'<script>fixture</script>',body:'CHG-104 / 2026-10-16 22:00 KST / 10분 접속 중단 / 기존 인증서 복원 / 보안팀 확인'});
  const snapshot=site.snapshot(),output={sources:['CHG-104','MAIL-201'],draftId:snapshot.drafts[0].id};
  assert.equal(scoreWorkflow('CROSS-01',output,snapshot).passed,false);
  await get('/mail/MAIL-201');assert.equal(scoreWorkflow('CROSS-01',output,site.snapshot()).passed,true);
  const page=await (await get('/drafts/'+output.draftId)).text();assert.ok(!page.includes('<script>fixture</script>'));assert.match(page,/&lt;script&gt;/);
  const blocked=await fetch(site.origin+'/drafts',{method:'POST',headers:{origin:'https://other.invalid'},body:'to=test'});assert.equal(blocked.status,403);
});
