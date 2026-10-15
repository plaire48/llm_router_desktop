const {createCloneErrorCapture,cloneFailure}=require('./git-clone-error.cjs');
const {createCloneProgress}=require('./git-clone-progress.cjs');
const {ORIGIN,SECRET_KEY}=require('../../nubi-vscode/src/ghes.cjs');
const {DesktopGhesAccount}=require('./ghes-profile-status.cjs');
const {chooseRepository}=require('../../nubi-vscode/src/ghes-git.cjs');
const {WorkspaceCommunity}=require('./workspace-community.cjs');
const {WikiRepository}=require('./wiki-repository.cjs');
const {startTeamWorkspace}=require('./team-workspace.cjs');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const {randomUUID,randomBytes}=require('node:crypto');
const {mkdtemp,mkdir,writeFile,rm,rmdir,realpath}=require('node:fs/promises');
const path=require('node:path'),os=require('node:os');
const SECRET_SERVICE='nubi.workspace.electron';
const missingWorkspaceBrowser=async()=>{throw Error('ghes_browser_unavailable');};
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function remote(input){
  if(typeof input!=='string'||input.length>2000||/[\s\x00-\x1f]/.test(input))throw Error('remote_invalid');
  if(/^[\w.-]+@[\w.-]+:[^:\s][^\s]*$/.test(input)){const href=input.replace(/\/+$/,'');return {href,pathname:href.slice(href.indexOf(':')+1),origin:null,protocol:'ssh:'};}
  let url;try{url=new URL(input);}catch{throw Error('remote_invalid');}
  if(!['https:','http:','ssh:','git:'].includes(url.protocol)||!url.hostname||url.password||url.search||url.hash)throw Error('remote_invalid');
  url.pathname=url.pathname.replace(/\/+$/,'');
  // Company HTTPS clones use the signed-in app identity, not a pasted URL username.
  if(url.origin===ORIGIN)url.username='';
  return url;
}
class ElectronHost{
  constructor({keyStore,storage,invoke,helperPath,fetcher,avatarFetcher,openBrowser=missingWorkspaceBrowser,confirmWorkspaceSave,platform=process.platform,spawnProcess=spawn}){
    this.invoke=invoke;this.helperPath=helperPath;this.platform=platform;this.spawnProcess=spawnProcess;this.repositories=new Map();this.children=new Set();
    this.confirmWorkspaceSave=confirmWorkspaceSave;this.storage=storage;
    this.account=new DesktopGhesAccount({fetcher,avatarFetcher,cacheAvatars:true,openExternal:openBrowser,copyCode:async()=>{},
      // A key-store write failure reads as its own code (ghes_storage), not a bare login failure (2026-10-14).
      secrets:{get:key=>keyStore.getPassword(SECRET_SERVICE,key),store:async(key,value)=>{try{return await keyStore.setPassword(SECRET_SERVICE,key,value);}catch{throw Error('ghes_storage');}},delete:key=>keyStore.deletePassword(SECRET_SERVICE,key)},
      onInvalidated:async()=>{this.workspace?.close();this.workspace=null;this.wikis?.cancel();this.repositories.clear();for(const child of this.children)child.kill();await invoke('disconnectSkillMarketplace').catch(()=>{});}});
  }
  get community(){return this.communities??=new WorkspaceCommunity({account:this.account,outboxFile:path.join(this.storage||os.tmpdir(),'community-outbox.json')});}
  get wikiRepository(){return this.wikis??=new WikiRepository({account:this.account,confirmSave:this.confirmWorkspaceSave});}
  async accountAction(operation){return this.account.action(operation);}
  async openTeamWorkspace({refresh=false}={}){
    if(!(await this.account.status()).connected)return {loginRequired:true};
    if(!refresh&&this.workspace?.generation===this.account.generation)return this.workspaceInfo();
    if(this.workspaceOpening)return this.workspaceOpening;
    this.workspaceOpening=(async()=>{
      const next=await startTeamWorkspace({account:this.account,confirmSave:this.confirmWorkspaceSave});
      this.workspace?.close();this.workspace=next;return this.workspaceInfo();
    })();
    try{return await this.workspaceOpening;}finally{this.workspaceOpening=null;}
  }
  workspaceInfo(){const {url,revision,repository}=this.workspace;return {embedded:true,url,revision,repository};}
  async connectMarketplace(){
    if(!(await this.account.status()).connected)return {loginRequired:true};
    const credential=await this.account.credential();
    const result=await this.invoke('connectSkillMarketplace',{token:credential.token});
    if(credential.generation!==this.account.generation){await this.invoke('disconnectSkillMarketplace');throw Error('ghes_session_changed');}
    return result;
  }
  async listRepositories(){
    const generation=this.account.generation;let choices=[];
    await chooseRepository({window:{showQuickPick:async items=>{choices=items;return undefined;}}},this.account);
    if(generation!==this.account.generation)throw Error('ghes_session_changed');
    this.repositories.clear();return choices.map(item=>{const id=randomUUID();this.repositories.set(id,{url:item.url,generation});return {id,label:item.label,description:item.description};});
  }
  async clone({url,parent,repositoryId},onProgress=()=>{}){
    if(repositoryId){const item=this.repositories.get(repositoryId);if(!item||item.generation!==this.account.generation)throw Error('ghes_session_changed');url=item.url;}
    const address=remote(url);let directory;
    try{directory=await realpath(parent);}catch(error){throw cloneFailure(['EACCES','EPERM'].includes(error.code)?'clone_permission':'clone_destination_missing',{stage:'destination'});}
    const name=address.pathname.split('/').at(-1).replace(/\.git$/,'');
    if(!/^[\w.-]+$/.test(name)||['.','..'].includes(name))throw Error('remote_invalid');
    const target=path.join(directory,name);let stage='destination',allocated=false;
    const report=value=>{stage=value.stage;onProgress(value);};
    try{
      await mkdir(target).catch(error=>{throw cloneFailure(error.code==='EEXIST'?'clone_target_exists':error.code==='ENOSPC'?'clone_disk_full':['EACCES','EPERM'].includes(error.code)?'clone_permission':'clone_failed',{stage});});allocated=true;
      report({stage:'connecting',percent:null});
      return await this.withGitAccess(address,async({env,credential})=>{
        await new Promise((resolve,reject)=>{
          const capture=createCloneErrorCapture(),progress=createCloneProgress(report);let child,settled=false;
          const fail=(error={},exitCode,signal)=>{if(settled)return;settled=true;progress.end();let code=capture.finish(error);if(signal&&code==='clone_failed')code='clone_interrupted';if(code==='clone_auth'&&address.origin===ORIGIN&&!credential)code='clone_login_required';reject(cloneFailure(code,{stage,exitCode,signal,httpStatus:capture.httpStatus}));};
          try{child=this.spawnProcess(this.platform==='win32'&&process.env.NUBI_BUNDLED_GIT||'git',[...(credential?['-c','credential.helper=']:[]),...(this.platform==='win32'?['-c','http.sslBackend=schannel','-c','core.longpaths=true']:[]),'-c','http.sslVerify=true','clone','--progress','--',address.href,target],{env:{...env,LC_ALL:'C',LANG:'C'},stdio:['ignore','pipe','pipe'],windowsHide:true});}catch(error){fail(error);return;}
          this.children.add(child);child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>{progress.write(chunk);capture.write(chunk);});
          child.once('error',error=>{this.children.delete(child);fail(error);});
          child.once('close',(code,signal)=>{this.children.delete(child);if(settled)return;if(code!==0){fail({},code,signal);return;}settled=true;progress.end();capture.finish();resolve();});
        });
        report({stage:'opening',percent:null});return {cloned:true,root:target};
      });
    }catch(error){
      // Only remove the empty directory allocated by this attempt. Partial files
      // and pre-existing destinations are never overwritten or recursively removed.
      let retained=allocated;if(allocated)try{await rmdir(target);retained=false;}catch{}
      if(error.cloneFailure)throw cloneFailure(error.message,{...error.cloneFailure,retained});
      if(error.message?.startsWith('ghes_'))throw error;
      throw cloneFailure(['EACCES','EPERM'].includes(error.code)?'clone_permission':'clone_auth_helper',{stage,retained});
    }
  }

  async withGitAccess(address,operation){
    const credential=address.origin===ORIGIN&&(await this.account.status()).connected?await this.account.credential():null;
    const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-git-'));
    const socketPath=this.platform==='win32'?'\\\\.\\pipe\\nubi-git-'+randomUUID():path.join(temp,'socket');
    const nonce=randomBytes(32).toString('hex');let server;
    try{
      const askpass=path.join(temp,this.platform==='win32'?'askpass.cmd':'askpass.sh');
      const executable=process.execPath;
      if(this.platform==='win32'&&[executable,this.helperPath].some(value=>/["%\r\n]/.test(value)))throw cloneFailure('clone_auth_helper',{stage:'connecting'});
      await writeFile(askpass,this.platform==='win32'?`@echo off\r\n"${executable}" "${this.helperPath}" %*\r\n`:`#!/bin/sh\nexec ${quote(executable)} ${quote(this.helperPath)} "$@"\n`,{mode:0o700});
      server=createServer(socket=>{
        let raw='';socket.setTimeout(15000,()=>socket.destroy());
        socket.on('error',()=>{});socket.on('data',async chunk=>{
          raw+=chunk;if(raw.length>8192)return socket.destroy();if(!raw.includes('\n'))return;
          socket.pause();let value='';
          try{const message=JSON.parse(raw);const match=/^(Username|Password) for '([^']+)':\s*$/.exec(message.prompt||'');
            const prompt=match&&new URL(match[2]);
            if(message.nonce!==nonce||!credential||credential.generation!==this.account.generation||this.account.state!=='connected'||this.account.record?.expiresAt&&this.account.record.expiresAt<=Date.now()||!prompt||prompt.origin!==ORIGIN||prompt.password||prompt.username&&!['x-access-token'].includes(prompt.username))throw Error();
            value=match[1]==='Username'?'x-access-token':credential.token;
          }catch{}socket.end(JSON.stringify({value}));
        });
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
      const env={...process.env,ELECTRON_RUN_AS_NODE:'1',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:askpass,NUBI_GIT_SOCKET:socketPath,NUBI_GIT_NONCE:nonce};
      for(const key of Object.keys(env))if(/^GIT_TRACE|^GIT_CURL_VERBOSE$|^GIT_SSL_NO_VERIFY$/.test(key))delete env[key];
      const result=await operation({env,credential});
      if(credential&&credential.generation!==this.account.generation)throw Error('ghes_session_changed');
      return result;
    }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
  }
  async syncWikiSources(root,{signal}={}){
    const {git}=require('../runtime/files.mjs');
    const {pullSources}=require('../runtime/wiki-refresh.mjs');
    const branch=(await git(root,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>'' )).trim();
    const name=branch&&(await git(root,['config','--get',`branch.${branch}.remote`]).catch(()=>'' )).trim();
    const url=name&&(await git(root,['remote','get-url',name]).catch(()=>'' )).trim();
    let address;try{address=remote(url);}catch{return pullSources(root,{signal});}
    if(address.origin!==ORIGIN)return pullSources(root,{signal});
    return this.withGitAccess(address,({env,credential})=>pullSources(root,{signal,run:(directory,args,options={})=>git(directory,[...(credential?['-c','credential.helper=']:[]),...(this.platform==='win32'?['-c','http.sslBackend=schannel']:[]),'-c','http.sslVerify=true',...args],{...options,env})}));
  }
  dispose(){this.wikis?.cancel();this.workspace?.close();this.workspace=null;this.account.dispose();for(const child of this.children)child.kill();this.repositories.clear();}
}
module.exports={ElectronHost,SECRET_SERVICE,remote};
