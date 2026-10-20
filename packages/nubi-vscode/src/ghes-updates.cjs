const {createHash,randomUUID}=require('node:crypto');
const {mkdir,writeFile,rm}=require('node:fs/promises');
const path=require('node:path');
const {ORIGIN}=require('./ghes.cjs');
const REPOSITORY='/repos/Manufacturing-IT/nuri',EXTENSION_ID='nubi-internal.nubi-workspace',RECEIPT='nubi.ghes.update';
const MAX_VSIX=250*1024*1024;
function version(value){return typeof value==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)?value.split('.').map(BigInt):null;}
function compare(a,b){const x=version(a),y=version(b);if(!x||!y)throw Error('ghes_release_invalid');for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function releaseCandidate(release,target){
  const v=typeof release?.tag_name==='string'?release.tag_name.replace(/^v/,''):'';
  if(!version(v)||release.draft||release.prerelease||!Number.isSafeInteger(release.id)||!Array.isArray(release.assets)||release.assets.length>200)throw Error('ghes_release_invalid');
  const name=`nubi-workspace-${v}-${target}.vsix`;
  const assets=release.assets.filter(a=>a.name===name),sums=release.assets.filter(a=>a.name===name+'.sha256');
  if(assets.length!==1||sums.length!==1)throw Error('ghes_release_missing');
  const valid=a=>Number.isSafeInteger(a.id)&&a.id>0&&Number.isSafeInteger(a.size)&&a.size>0&&a.state==='uploaded';
  if(!valid(assets[0])||!valid(sums[0])||assets[0].size>MAX_VSIX||sums[0].size>2048)throw Error('ghes_release_invalid');
  return {version:v,releaseId:release.id,name,assetId:assets[0].id,size:assets[0].size,sumId:sums[0].id};
}
function checksum(bytes,name){
  const match=/^([a-f0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/.exec(bytes.toString('utf8'));
  if(!match||match[2]!==name)throw Error('ghes_checksum_invalid');return match[1];
}
async function validateVsix(file,expectedVersion,target){
  const yauzl=require('yauzl');
  return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(Error('ghes_package_invalid'));
    let found=false,metadata,count=0,finished=false;
    const finish=error=>{if(finished)return;finished=true;zip.close();error?reject(Error('ghes_package_invalid')):resolve(metadata);};
    zip.on('error',()=>finish(true));zip.on('end',()=>finish(!found));
    zip.on('entry',entry=>{
      if(++count>30000)return finish(true);
      if(entry.fileName!=='extension/package.json'){zip.readEntry();return;}
      if(found||entry.uncompressedSize>128*1024||entry.generalPurposeBitFlag&1)return finish(true);found=true;
      zip.openReadStream(entry,(error,stream)=>{
        if(error)return finish(true);const chunks=[];let size=0;
        stream.on('error',()=>finish(true));stream.on('data',chunk=>{size+=chunk.length;if(size>128*1024){stream.destroy();finish(true);}else chunks.push(chunk);});
        stream.on('end',()=>{
          try{metadata=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(metadata.publisher+'.'+metadata.name!==EXTENSION_ID||metadata.version!==expectedVersion||metadata.__metadata?.targetPlatform&&metadata.__metadata.targetPlatform!==target)return finish(true);zip.readEntry();}
          catch{finish(true);}
        });
      });
    });zip.readEntry();
  }));
}

// Installs the Nubi feature VSIX, not the Code-OSS executable or Windows installer.
// A checksum proves artifact integrity, not publisher signing or deployment.
class GhesUpdates {
  constructor({account,vscode,context,platform=process.platform,arch=process.arch,validate=validateVsix}){
    this.account=account;this.vscode=vscode;this.context=context;this.target=platform+'-'+arch;this.validate=validate;this.state='unchecked';
  }
  installed(){return this.vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.version||this.context.extension?.packageJSON?.version;}
  async status(){
    const receipt=this.context.globalState.get(RECEIPT),installed=this.installed();
    if(receipt?.state==='install_requested'){
      if(installed===receipt.version){await this.context.globalState.update(RECEIPT,{...receipt,state:'installed_verified'});this.state='installed_verified';}
      else this.state='restart_required';
    }
    return {state:this.state,installedVersion:installed,availableVersion:this.candidate?.version||receipt?.version||null,error:this.failure||null,kind:'nubi_features',supported:this.target==='win32-x64'};
  }
  async check(){
    if(this.busy)throw Error('ghes_update_busy');this.busy=true;this.failure=null;
    try{
      if(this.target!=='win32-x64')throw Error('ghes_update_platform');
      const release=await this.account.json(REPOSITORY+'/releases/latest'),candidate=releaseCandidate(release,this.target);
      this.candidate={...candidate,userId:this.account.profile.id,generation:this.account.generation};
      this.state=compare(candidate.version,this.installed())>0?'update_available':'current';return this.status();
    }catch(e){this.state='attention';this.failure=e.message;throw e;}finally{this.busy=false;}
  }
  async install(){
    if(this.busy)throw Error('ghes_update_busy');this.busy=true;let folder;
    try{
      if(this.target!=='win32-x64')throw Error('ghes_update_platform');
      const pending=this.context.globalState.get(RECEIPT);
      if(pending?.state==='install_requested'&&this.installed()!==pending.version)throw Error('ghes_install_unconfirmed');
      const credential=await this.account.credential(),candidate=this.candidate;
      if(!candidate||candidate.userId!==credential.userId||candidate.generation!==credential.generation||compare(candidate.version,this.installed())<=0)throw Error('ghes_release_changed');
      const same=()=>{if(credential.generation!==this.account.generation)throw Error('ghes_session_changed');};
      // Recheck the pinned release before issuing an installation. Ignore URLs and
      // asset IDs supplied by a webview. Release assets can redirect only locally.
      const release=releaseCandidate(await this.account.request('/api/v3'+REPOSITORY+'/releases/'+candidate.releaseId,{token:credential.token}),this.target);
      if(JSON.stringify(release)!==JSON.stringify(Object.fromEntries(['version','releaseId','name','assetId','size','sumId'].map(k=>[k,candidate[k]]))))throw Error('ghes_release_changed');same();
      const sum=await this.account.request('/api/v3'+REPOSITORY+'/releases/assets/'+candidate.sumId,{token:credential.token,accept:'application/octet-stream',limit:2048,allowRedirect:true});same();
      const expected=checksum(sum,candidate.name),bytes=await this.account.request('/api/v3'+REPOSITORY+'/releases/assets/'+candidate.assetId,{token:credential.token,accept:'application/octet-stream',limit:MAX_VSIX,allowRedirect:true});same();
      if(bytes.length!==candidate.size||createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('ghes_checksum_mismatch');
      folder=path.join(this.context.globalStorageUri.fsPath,'ghes-updates',randomUUID());await mkdir(folder,{recursive:true});
      const file=path.join(folder,candidate.name);await writeFile(file,bytes,{flag:'wx',mode:0o600});await this.validate(file,candidate.version,this.target);same();
      const receipt={version:candidate.version,releaseId:candidate.releaseId,hash:expected,state:'install_requested'};
      await this.context.globalState.update(RECEIPT,receipt);same();
      this.state='installing';
      await this.vscode.commands.executeCommand('workbench.extensions.installExtension',this.vscode.Uri.file(file));
      this.state=this.installed()===candidate.version?'installed_verified':'restart_required';return await this.status();
    }catch(e){this.state='attention';this.failure=e.message;throw e;}
    finally{if(folder)await rm(folder,{recursive:true,force:true});this.busy=false;}
  }
  async action(operation){
    if(operation==='status')return this.status();if(operation==='check')return this.check();if(operation==='install')return this.install();
    if(operation==='restart'){if((await this.status()).state!=='restart_required')throw Error('ghes_update_not_pending');await this.vscode.commands.executeCommand('workbench.action.reloadWindow');return {state:'restart_requested'};}
    if(operation==='releases'){await this.vscode.env.openExternal(this.vscode.Uri.parse(ORIGIN+'/Manufacturing-IT/nuri/releases'));return this.status();}
    throw Error('method_invalid');
  }
}
module.exports={GhesUpdates,releaseCandidate,checksum,compare,validateVsix,RECEIPT,EXTENSION_ID};
