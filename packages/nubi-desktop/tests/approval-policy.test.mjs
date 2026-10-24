// Automatic approval (user decision 2026-09-30: three modes and "always allow", as in Codex and Claude Code).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {checkCommand,approvalPolicy,routineCommand} from '../runtime/approval-policy.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);

const scripts={test:'node --test',build:'node build.mjs',lint:'eslint .','check:types':'tsc --noEmit',deploy:'node deploy.mjs',start:'node server.mjs'};

test('a check command is a test, build, lint or check script of the manifest and nothing else',()=>{
  for(const script of ['npm test','npm run build','npm run-script lint','pnpm lint','pnpm run build','yarn check:types','yarn run test','npm.cmd test','npm test -- --test-name-pattern=배송'])assert.equal(checkCommand(script,scripts),true,script);
  for(const script of ['npm install','npm run deploy','npm start','npm build','npx eslint .','node --test','npm test; rm -rf ~','npm test && npm publish','npm run test -- --watch','npm test > out.txt','npm run lint2','npm test $(id)','pnpm deploy',''])assert.equal(checkCommand(script,scripts),false,script);
  assert.equal(checkCommand('npm run lint',{}),false,'a script the manifest does not declare');
  // Found by review (2026-09-30): a check name that also ships or rewrites files is not a check.
  const risky={'build:deploy':'x','test-and-publish':'x','check:release':'x','lint:fix':'x','check:format':'x','build:prod':'x','test:unit':'x'};
  for(const script of ['npm run build:deploy','pnpm test-and-publish','yarn check:release','npm run lint:fix','npm run check:format'])assert.equal(checkCommand(script,risky),false,script);
  for(const script of ['npm run build:prod','npm run test:unit'])assert.equal(checkCommand(script,risky),true,script);
});

async function setup(t){
  const {service,root}=await fixture(t),task=await service.createTask({request:'테스트를 돌려 줘.'});
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture',scripts}));
  service.store.set('task:'+task.id,{...service.task(task.id),state:'review'});
  let at=0;const stamp=()=>new Date(Date.UTC(2026,8,30,0,0,at++)).toISOString();
  const action=(script,extra={})=>{const id='a'+at;service.store.set('setup-action:'+id,{id,taskId:task.id,profile:'bash',script,privilege:'user',fingerprint:'f'+id,state:'proposed',createdAt:stamp(),...extra});return id;};
  const proposal=(file,extra={})=>{const id='p'+at;service.store.set('proposal:'+id,{id,taskId:task.id,path:file,state:'proposed',createdAt:stamp(),...extra});return id;};
  return {service,task,action,proposal,auto:()=>service.autoApprovals({taskId:task.id})};
}

test('the mode is kept for the project; always allow never takes an administrator command',async t=>{
  const {service,action}=await setup(t);
  assert.deepEqual(service.approvalPolicy(),{mode:'ask',allowedCommands:[],allowedMcpTools:[]});
  assert.throws(()=>service.setApprovalMode({mode:'everything'}),/approval_mode_invalid/);
  assert.equal(service.setApprovalMode({mode:'edits'}).mode,'edits');assert.equal(approvalPolicy(service.store).mode,'edits');
  const admin=action('Set-ExecutionPolicy RemoteSigned',{privilege:'administrator',profile:'powershell'});
  assert.throws(()=>service.allowCommand({id:admin}),/approval_administrator/);
  const plain=action('  npm test  ');
  assert.deepEqual(service.allowCommand({id:plain}).allowedCommands.map(item=>[item.profile,item.script]),[['bash','npm test']]);
  service.allowCommand({id:plain});assert.equal(service.approvalPolicy().allowedCommands.length,1,'allowed once');
  assert.deepEqual(service.removeAllowedCommand({profile:'bash',script:'npm test'}).allowedCommands,[]);
});

test('ask waits for everything except a command the user always allowed',async t=>{
  const {service,action,proposal,auto}=await setup(t);
  proposal('src/a.mjs');action('npm test');
  assert.deepEqual(await auto(),{mode:'ask',proposals:[],command:null});
  service.store.set('setting:approvals',{mode:'ask',allowedCommands:[{profile:'bash',script:'npm test'}]});
  const next=await auto();assert.equal(next.command.reason,'allowed');assert.deepEqual(next.proposals,[]);
});

test('edits applies the newest proposal of each file first, and runs no command by mode',async t=>{
  const {service,action,proposal,auto}=await setup(t);service.setApprovalMode({mode:'edits'});
  const older=proposal('src/a.mjs'),newer=proposal('src/a.mjs'),other=proposal('src/b.mjs');action('npm test');
  const next=await auto();assert.deepEqual(next.proposals,[other,newer]);assert.equal(next.command,null);
  for(const id of [older,newer,other])service.store.set('proposal:'+id,{...service.store.get('proposal:'+id),state:'applied'});
  assert.deepEqual(await auto(),{mode:'edits',proposals:[],command:null});
});

test('commands runs the check scripts of the manifest, never another command or an administrator one',async t=>{
  const {service,action,auto}=await setup(t);service.setApprovalMode({mode:'commands'});
  action('npm run deploy');action('Remove-Item -Recurse build',{privilege:'administrator',profile:'powershell'});
  assert.equal((await auto()).command,null);
  const tests=action('npm test');
  assert.deepEqual((await auto()).command,{kind:'setup',id:tests,fingerprint:'f'+tests,script:'npm test',reason:'check'});
});

test('a command that waits for its fix, a running agent or an open question is not approved automatically',async t=>{
  const {service,task,action,proposal,auto}=await setup(t);service.setApprovalMode({mode:'commands'});
  const fix=proposal('src/a.mjs');service.setApprovalMode({mode:'ask'});
  service.store.set('setting:approvals',{mode:'ask',allowedCommands:[{profile:'bash',script:'npm test'}]});
  action('npm test',{afterProposals:[fix]});
  assert.equal((await auto()).command,null,'held until the fix is applied');
  service.store.set('proposal:'+fix,{...service.store.get('proposal:'+fix),state:'applied'});
  assert.equal((await auto()).command.reason,'allowed');
  service.agent={running:true,taskId:task.id};assert.equal((await auto()).command,null);service.agent=null;
  service.store.set('task:'+task.id,{...service.task(task.id),question:{id:'q',text:'어느 쪽?'}});assert.equal((await auto()).command,null);
});

for(const mode of ['ask','edits','commands'])test(`irreversible proposals and commands wait in ${mode} with persisted reasons`,async t=>{
 const {service,action,proposal,auto}=await setup(t);service.setApprovalMode({mode});
 const del=proposal('src/remove.mjs',{kind:'delete'}),cmd=action('git push --force origin main');
 const before=service.state();assert.match(before.setupActions.find(a=>a.id===cmd).irreversible?.reason||'',/강제 push/);
 const next=await auto();assert.deepEqual(next.proposals,[]);assert.equal(next.command,null);
 assert.equal(service.store.get('proposal:'+del).irreversible.reason,'기존 파일 삭제');
 assert.match(service.store.get('setup-action:'+cmd).irreversible.reason,/강제 push/);
});
test('exact shell allowlist remains an exception, never a broader command',async t=>{
 const {service,action,auto}=await setup(t);service.setApprovalMode({mode:'commands'});
 const id=action('git push --force origin main');service.allowCommand({id});
 assert.equal((await auto()).command.id,id);
 service.store.set('setup-action:'+id,{...service.store.get('setup-action:'+id),state:'done'});
 action('git push --force origin other');assert.equal((await auto()).command,null);
});
test('deletion does not expose an older proposal for the same path to auto approval',async t=>{
 const {service,proposal,auto}=await setup(t);service.setApprovalMode({mode:'edits'});
 proposal('src/a.mjs',{kind:'patch'});proposal('src/a.mjs',{kind:'delete'});
 const safe=proposal('src/b.mjs',{kind:'patch'});assert.deepEqual((await auto()).proposals,[safe]);
});
// opencode always-allow prefixes (user request 2026-10-23): allowing "npm run test -- --grep a" also allows "npm run
// test", never another script, an irreversible command, a deletion program or a line the scanner cannot read.
test('always allow saves the deciding prefix of each subcommand and covers the same prefix later',async t=>{
 const {service,action,auto}=await setup(t);
 const id=action('git status --short && npm run test -- --grep a');
 assert.deepEqual(service.allowCommand({id}).allowedCommands[0].patterns,['git status *','npm run test *']);
 service.store.set('setup-action:'+id,{...service.store.get('setup-action:'+id),state:'done'});
 const later=action('npm run test');
 assert.deepEqual((await auto()).command,{kind:'setup',id:later,fingerprint:'f'+later,script:'npm run test',reason:'allowed'});
});
test('a prefix never covers another subcommand, an unread line, a deletion program or an irreversible command',async t=>{
 const {service,action,auto}=await setup(t);
 for(const script of ['git push origin main','npm run test','rm build/out.txt']){const id=action(script);service.allowCommand({id});service.store.set('setup-action:'+id,{...service.store.get('setup-action:'+id),state:'done'});}
 assert.deepEqual(service.approvalPolicy().allowedCommands.map(item=>item.patterns),[['git push *'],['npm run test *'],[]]);
 for(const script of ['npm run deploy','npm run test && npm run deploy','npm run test > out.txt','npm run test $(whoami)','rm other.txt','git push --force origin main']){
  const id=action(script);
  assert.equal((await auto()).command,null,script);
  service.store.set('setup-action:'+id,{...service.store.get('setup-action:'+id),state:'done'});
 }
 const same=action('git push origin feature');assert.equal((await auto()).command?.id,same);
});
test('a prefix belongs to the shell it was allowed in',async t=>{
 const {service,action,auto}=await setup(t);
 const id=action('npm run test');service.allowCommand({id});service.store.set('setup-action:'+id,{...service.store.get('setup-action:'+id),state:'done'});
 action('npm run test -- --grep b',{profile:'powershell'});
 assert.equal((await auto()).command,null);
});

test('unsaved projects default to autonomous coding while an explicit approval choice is preserved',()=>{
 assert.equal(approvalPolicy({get:()=>undefined}).mode,'commands');
 for(const mode of ['ask','edits','commands'])assert.equal(approvalPolicy({get:()=>({mode})}).mode,mode);
});
test('routine local commands cover actual inspection and checks while inline programs and external mutations require approval',()=>{
 for(const script of ['node --version','git status --short','git diff --stat','rg --files','ls -la','pwd','Get-ChildItem','Get-Content package.json','node --test tests/a.test.mjs','python -m pytest tests'])assert.equal(routineCommand(script),true,script);
 for(const script of ['node -e "write()"','git push','git reset --hard','git diff --ext-diff','rg --pre=program x','npm install','curl https://example.invalid','node --test --require side-effect.cjs','ls; rm a','cat .env > output','cat .env','cat .*','Get-Content *','cat ../private.txt','cat /etc/passwd','Get-Content Env:','rg --hidden TOKEN','sudo pwd'])assert.equal(routineCommand(script),false,script);
});
