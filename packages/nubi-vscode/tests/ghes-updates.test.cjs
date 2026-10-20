const test=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm}=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {GhesUpdates,releaseCandidate,checksum,validateVsix,RECEIPT}=require('../src/ghes-updates.cjs');
const tag='2.1.0',name=`nubi-workspace-${tag}-win32-x64.vsix`,bytes=Buffer.from('PACKAGE');
const release={id:7,tag_name:'v'+tag,draft:false,prerelease:false,assets:[{id:8,name,size:bytes.length,state:'uploaded'},{id:9,name:name+'.sha256',size:130,state:'uploaded'}]};
async function fixture(t,{installed='2.0.0',platform='win32',validate=async()=>{}}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-ghes-update-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[],data=new Map(),account={generation:1,profile:{id:42},credential:async()=>({token:'HOST_ONLY_PRIVATE',generation:1,userId:42}),json:async()=>release,request:async route=>route.endsWith('/7')?release:route.endsWith('/9')?Buffer.from(createHash('sha256').update(bytes).digest('hex')+'  '+name+'\n'):bytes};
  const context={globalStorageUri:{fsPath:root},globalState:{get:k=>data.get(k),update:async(k,v)=>data.set(k,v)},extension:{packageJSON:{version:installed}}};
  const vscode={extensions:{getExtension:()=>({packageJSON:{version:installed}})},Uri:{file:p=>p,parse:u=>u},commands:{executeCommand:async(...args)=>calls.push(args)},env:{openExternal:async uri=>calls.push(uri)}};
  return {updates:new GhesUpdates({account,vscode,context,platform,arch:'x64',validate}),vscode,account,calls,data,root};
}
test('release selection pins the Windows asset and refuses drafts, ambiguous assets and oversized packages',()=>{
  assert.equal(releaseCandidate(release,'win32-x64').assetId,8);
  for(const r of [{...release,draft:true},{...release,prerelease:true},{...release,assets:[...release.assets,release.assets[0]]},{...release,assets:[{...release.assets[0],size:300*1024*1024},release.assets[1]]}])assert.throws(()=>releaseCandidate(r,'win32-x64'),/ghes_release_invalid|ghes_release_missing/);
});
test('checksum names must identify the exact package',()=>{
  const hash='a'.repeat(64);assert.equal(checksum(Buffer.from(hash+'  '+name+'\n'),name),hash);assert.throws(()=>checksum(Buffer.from(hash+'  other.vsix'),name),/ghes_checksum_invalid/);
});
test('verified artifact installation distinguishes request, restart and the actual installed version',async t=>{
  const f=await fixture(t);assert.equal((await f.updates.check()).state,'update_available');const state=await f.updates.install();assert.equal(state.state,'restart_required');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'workbench.extensions.installExtension');assert.ok(!JSON.stringify(f.data.get(RECEIPT)).includes('PRIVATE'));
  await assert.rejects(f.updates.install(),/ghes_install_unconfirmed/);assert.equal(f.calls.length,1);
  f.vscode.extensions.getExtension=()=>({packageJSON:{version:tag}});assert.equal((await f.updates.status()).state,'installed_verified');assert.equal(f.data.get(RECEIPT).state,'installed_verified');
});
test('wrong hashes prevent installation and preserve the original version',async t=>{
  const f=await fixture(t);await f.updates.check();f.account.request=async route=>route.endsWith('/7')?release:route.endsWith('/9')?Buffer.from('0'.repeat(64)+'  '+name+'\n'):bytes;
  await assert.rejects(f.updates.install(),/ghes_checksum_mismatch/);assert.deepEqual(f.calls,[]);assert.equal(f.data.size,0);assert.equal(f.updates.installed(),'2.0.0');
});
test('changed releases and changed accounts cannot reuse a checked update',async t=>{
  const f=await fixture(t);await f.updates.check();f.account.request=async()=>({...release,id:99});await assert.rejects(f.updates.install(),/ghes_release_changed/);assert.equal(f.calls.length,0);
  const g=await fixture(t);await g.updates.check();g.account.generation=2;g.account.credential=async()=>({token:'PRIVATE',generation:2,userId:43});await assert.rejects(g.updates.install(),/ghes_release_changed/);assert.equal(g.calls.length,0);
});
test('an uncertain install request is retained and never automatically repeated',async t=>{
  const f=await fixture(t);await f.updates.check();f.vscode.commands.executeCommand=async()=>{f.calls.push('install');throw Error('LOST_RESPONSE');};
  await assert.rejects(f.updates.install(),/LOST_RESPONSE/);assert.equal(f.data.get(RECEIPT).state,'install_requested');await assert.rejects(f.updates.install(),/ghes_install_unconfirmed/);assert.deepEqual(f.calls,['install']);
});
test('non-Windows targets refuse the update before reading releases',async t=>{
  const f=await fixture(t,{platform:'darwin'});f.account.json=async()=>assert.fail('network must not run');await assert.rejects(f.updates.check(),/ghes_update_platform/);assert.equal((await f.updates.status()).supported,false);
});
test('valid VSIX identity is read from the archive and unrelated extension manifests are refused',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-vsix-'));t.after(()=>rm(root,{recursive:true,force:true}));const {ZipFile}=require('yazl');
  async function zip(metadata){const archive=new ZipFile(),chunks=[];const result=new Promise((resolve,reject)=>{archive.outputStream.on('data',chunk=>chunks.push(chunk));archive.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));archive.outputStream.on('error',reject);});archive.addBuffer(Buffer.from(JSON.stringify(metadata)),'extension/package.json');archive.end();const file=path.join(root,'package.vsix');await writeFile(file,await result);return file;}
  const good={publisher:'nubi-internal',name:'nubi-workspace',version:tag,__metadata:{targetPlatform:'win32-x64'}};
  assert.equal((await validateVsix(await zip(good),tag,'win32-x64')).version,tag);
  for(const changed of [{publisher:'other'},{version:'99.0.0'},{__metadata:{targetPlatform:'darwin-arm64'}}])await assert.rejects(validateVsix(await zip({...good,...changed}),tag,'win32-x64'),/ghes_package_invalid/);
});
