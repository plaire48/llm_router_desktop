import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const safety=await import('../scripts/check-safety-regression.mjs').catch(()=>({}));
const hash=s=>createHash('sha256').update(s).digest('hex');
const legacy='packages/nubi-desktop/eval/legacy-case.json',manifestPath='packages/nubi-desktop/fixtures-manifest.json';
function fixture(){const text='{"ticket":"DEMO-101","from":"sender@example.invalid"}';return {files:new Map([[legacy,text]]),manifest:{version:1,fixtures:[{path:legacy,kind:'합성 티켓',evidence:'DEMO-101와 예약 도메인, 전체 패턴 검사 통과',reviewer:'Codex',reviewedAt:'2026-10-20',sha256:hash(text)}]}};}
async function check(f,changed=[],basePaths=[...f.files.keys()]){assert.equal(typeof safety.inspectSafetyDelta,'function');return safety.inspectSafetyDelta({paths:[...f.files.keys()],basePaths,changedPaths:changed,readCandidate:async p=>Buffer.from(f.files.get(p)||''),manifest:f.manifest});}
test('delta blocks newly uploaded evidence and secret paths but preserves unchanged legacy evidence',async()=>{
 const f=fixture();f.files.set('packages/nubi-office/verification/old.png','old');assert.equal((await check(f)).ok,true);
 for(const p of ['new.har','new.webm','.env','profiles.yaml','.playwright-mcp/session.json','__pycache__/cache.pyc','개인정보암호화/file.bin','packages/nubi-desktop/verification/new.json']){f.files.set(p,'synthetic');const r=await check(f,[p]);assert.equal(r.ok,false,p);assert(r.issues.some(x=>x.code==='safety_upload_path'&&x.path===p));}
});
test('new fixtures need a synthetic prefix; legacy declarations cannot authorize newly added fixtures',async()=>{
 const f=fixture();const p='packages/nubi-desktop/tests/fixtures/new-case.json';f.files.set(p,'{}');assert.equal((await check(f,[p])).ok,false);f.manifest.fixtures.push({path:p,kind:'합성 자료',evidence:'빈 합성 JSON, 전체 패턴 검사 통과',reviewer:'Codex',reviewedAt:'2026-10-20',sha256:hash('{}')});assert.equal((await check(f,[p],[legacy])).ok,false);
 f.manifest.fixtures.pop();f.files.delete(p);const valid='packages/nubi-desktop/tests/fixtures/synthetic-new.json';f.files.set(valid,'{}');assert.equal((await check(f,[valid],[legacy])).ok,true);
});
test('declared legacy fixture evidence is hash bound and secret checks cannot be bypassed by the manifest',async()=>{
 const f=fixture();assert.equal((await check(f,[legacy])).ok,true);f.files.set(legacy,'{"ticket":"changed"}');assert.equal((await check(f,[legacy])).ok,false);
 f.manifest.fixtures[0].sha256=hash(f.files.get(legacy));f.manifest.fixtures[0].evidence='';assert.equal((await check(f,[legacy])).ok,false);
 f.manifest.fixtures[0].evidence='검토된 합성 자료라는 선언이나 비밀은 별도 검사';const text=JSON.stringify({apiKey:'sk-'+'Ab3z'.repeat(9)});f.files.set(legacy,text);f.manifest.fixtures[0].sha256=hash(text);assert.equal((await check(f,[legacy])).ok,false);
});
test('privacy pattern findings cover email phone resident employee and credential shapes without exposing values',()=>{
 assert.equal(typeof safety.scanSensitivePatterns,'function');const samples=[['email','person'+'@acme-industries.com'],['phone','010'+'-2345-6789'],['resident','900101'+'-1234567'],['employee','사번: E'+'12345678'],['secret','ghp_'+'Aa19'.repeat(9)]];
 for(const [kind,text] of samples){const r=safety.scanSensitivePatterns('synthetic.txt',Buffer.from(text));assert(r.some(x=>x.kind===kind),kind);assert(!JSON.stringify(r).includes(text));}
});
test('reserved example addresses stay usable as synthetic data',()=>{
 assert.equal(typeof safety.scanSensitivePatterns,'function');for(const text of ['sender@example.invalid','sender@example.com','sender@example.org','sender@example.net','sender@fixture.test'])assert.deepEqual(safety.scanSensitivePatterns('synthetic.txt',Buffer.from(text)),[]);
});
test('whole tree patterns run without a delta baseline and verification is explicitly excluded from the bundle projection',async()=>{
 assert.equal(typeof safety.inspectSafetyTree,'function');const files=new Map([['packages/nubi-office/verification/old.txt','ghp_'+'Bb29'.repeat(9)],['src/config.txt','person'+'@acme-industries.com']]);const r=await safety.inspectSafetyTree({paths:[...files.keys()],readCandidate:async p=>Buffer.from(files.get(p))});assert.equal(r.ok,false);assert.equal(r.excludedVerification.length,1);assert(r.issues.some(x=>x.path==='src/config.txt'));assert(!r.issues.some(x=>x.path.includes('/verification/')));
});
test('pattern scanning covers the end of large files instead of sampling a prefix',()=>{
 assert.equal(typeof safety.scanSensitivePatterns,'function');const r=safety.scanSensitivePatterns('large.txt',Buffer.from('x'.repeat(1_100_000)+'\n'+'ghp_'+'Cc39'.repeat(9)));assert(r.some(x=>x.kind==='secret'));
});
test('missing fixture declarations fail closed instead of inferring a safe baseline',async()=>{
 const f=fixture();f.manifest=null;assert.equal((await check(f,[legacy])).ok,false);
});
test('legacy fixture declarations must cover unchanged baseline data, not just the upload delta',async()=>{
 const f=fixture();f.files.set('packages/nubi-desktop/eval/another-legacy.json','{}');const r=await check(f);assert.equal(r.ok,false);assert(r.issues.some(x=>x.code==='safety_fixture_unreviewed'&&x.path.endsWith('/another-legacy.json')));
});
test('credential prefix matching does not mistake task CSS names and ordinary hyphenated words for keys',()=>{
 assert.deepEqual(safety.scanSensitivePatterns('source.mjs',Buffer.from('task-progress-long-operation-identifier task-specific-workflow-name')),[]);
});
test('compressed image pixels are not interpreted as plaintext credentials',async()=>{
 const {readFile}=await import('node:fs/promises');const p='extensions/aipro-chat/docs/images/1.1.0/project-connect.png';assert.deepEqual(safety.scanSensitivePatterns(p,await readFile(new URL('../../../'+p,import.meta.url))),[]);
});

test('PNG text metadata remains inspected independently of compressed pixel bytes',()=>{
 const text=Buffer.from('Comment\0'+('ghp_'+'Dd49'.repeat(9))),chunk=(type,data)=>{const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);return out;};const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('tEXt',text),chunk('IEND',Buffer.alloc(0))]);assert(safety.scanSensitivePatterns('synthetic.png',bytes).some(x=>x.kind==='secret'));
});
test('OpenSSH security-key algorithm identifiers are protocol names, while adjacent real key shapes still block',()=>{
 for(const identifier of ['sk-ssh-ed25519@openssh.com','sk-ecdsa-sha2-nistp256@openssh.com','sk-ssh-ed25519-cert-v01@openssh.com','sk-ecdsa-sha2-nistp256-cert-v01@openssh.com'])assert.deepEqual(safety.scanSensitivePatterns('ssh.exe',Buffer.from(identifier)),[]);
 assert(safety.scanSensitivePatterns('settings.txt',Buffer.from('sk-'+'Ab3z'.repeat(9)+'@openssh.com')).some(x=>x.kind==='secret'));
});
