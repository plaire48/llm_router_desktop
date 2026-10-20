const test=require('node:test'),assert=require('node:assert/strict');
const {Host}=require('../src/host.cjs');
const {registerGhesGit,chooseRepository}=require('../src/ghes-git.cjs');
function fixture(){
  const calls=[],account={generation:1,profile:{id:42},status:async()=>({connected:true}),credential:async()=>({token:'HOST_ONLY_PRIVATE',generation:1,userId:42}),action:async op=>{calls.push(op);return {connected:true};}};
  const vscode={workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:'/project'}}]},env:{},commands:{executeCommand:async(...args)=>{calls.push(args);return '/project';}},window:{}};
  const runtime={invoke:async(method,args)=>{calls.push({method,args});return {credentialsReady:true};}};
  const host=new Host(vscode,runtime,{account,updates:{action:async op=>{calls.push({update:op});return {};}},repositoryPicker:async()=>({cloned:true})});host.root='/project';return {calls,account,vscode,runtime,host};
}
test('profile and update RPCs cannot accept forged tokens or runtime connection methods',async()=>{
  const f=fixture();await f.host.handle({method:'ghesAccount',args:['status',{token:'FORGED'}]});await f.host.handle({method:'ghesUpdate',args:['status',{assetId:999}]});
  assert.deepEqual(f.calls,['status',{update:'status'}]);await assert.rejects(f.host.api('disconnectSkillMarketplace'),/method_invalid/);await assert.rejects(f.host.api('connectSkillMarketplace',{token:'FORGED'}),/method_invalid/);
});
test('account and profile work before a project opens, but untrusted and remote hosts remain blocked',async()=>{
  const f=fixture();f.vscode.workspace.workspaceFolders=[];f.host.root=null;assert.equal((await f.host.handle({method:'ghesAccount',args:['status']})).connected,true);
  f.vscode.workspace.isTrusted=false;await assert.rejects(f.host.handle({method:'ghesAccount',args:['login']}),/workspace_untrusted/);
  f.vscode.workspace.isTrusted=true;f.vscode.env.remoteName='ssh-remote';await assert.rejects(f.host.handle({method:'ghesAccount',args:['status']}),/local_workspace_required/);
});
test('marketplace reuses the verified host account and returns no token to the UI',async()=>{
  const f=fixture();assert.deepEqual(await f.host.handle({method:'connectMarketplace',args:[{token:'FORGED'}]}),{credentialsReady:true});assert.deepEqual(f.calls,[{method:'connectSkillMarketplace',args:{token:'HOST_ONLY_PRIVATE'}}]);
  f.calls.length=0;await f.host.api('skillMarketplace',{operation:'refresh'});assert.equal(f.calls[0].method,'connectSkillMarketplace');assert.equal(f.calls[1].method,'skillMarketplace');
});
test('marketplace login starts native Device Flow instead of asking for a token',async()=>{
  const f=fixture();f.account.status=async()=>({connected:false});f.account.login=async()=>{f.calls.push('login');};assert.deepEqual(await f.host.connectMarketplace(),{loginRequired:true});assert.deepEqual(f.calls,['login']);
});
test('native Git receives credentials only for the exact trusted HTTPS company origin',async()=>{
  const f=fixture();let provider;f.vscode.extensions={getExtension:()=>({isActive:true,exports:{getAPI:()=>({registerCredentialsProvider:p=>{provider=p;return {dispose(){}};}})}})};
  await registerGhesGit(f.vscode,f.account);
  assert.deepEqual(await provider.getCredentials({scheme:'https',authority:'code.sdsdev.co.kr'}),{username:'x-access-token',password:'HOST_ONLY_PRIVATE'});
  for(const uri of [{scheme:'https',authority:'attacker.invalid'},{scheme:'http',authority:'code.sdsdev.co.kr'},{scheme:'https',authority:'code.sdsdev.co.kr@attacker.invalid'}])assert.equal(await provider.getCredentials(uri),undefined);
  f.vscode.workspace.isTrusted=false;assert.equal(await provider.getCredentials({scheme:'https',authority:'code.sdsdev.co.kr'}),undefined);
});
test('repository picker lists only app-accessible repositories and uses a selected credential-free URL',async()=>{
  const f=fixture();f.account.json=async route=>route.startsWith('/user/installations?')?{installations:[{id:1}],total_count:1}:{repositories:[{id:1,full_name:'Manufacturing-IT/ai_workspace',private:true,clone_url:'https://code.sdsdev.co.kr/Manufacturing-IT/ai_workspace.git'},{id:2,full_name:'bad',clone_url:'https://attacker.invalid/x.git'}]};
  f.vscode.window.showQuickPick=async items=>{assert.equal(items.length,1);return items[0];};assert.deepEqual(await chooseRepository(f.vscode,f.account),{cloned:true});assert.deepEqual(f.calls,[['git.clone','https://code.sdsdev.co.kr/Manufacturing-IT/ai_workspace.git']]);
  f.calls.length=0;f.vscode.window.showQuickPick=async()=>undefined;assert.deepEqual(await chooseRepository(f.vscode,f.account),{cancelled:true});assert.deepEqual(f.calls,[]);
});
