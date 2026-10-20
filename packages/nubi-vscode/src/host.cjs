const {createHash}=require('node:crypto');
const {realpath}=require('node:fs/promises');
const digest=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
// Before a folder opens as a project: Git missing or a folder outside a repository (user decision 2026-09-30).
const SETUP=new Set(['setupStatus','setupRun','setupRetry','setupSuggest']);
// https://host/path, ssh://host/path or user@host:path. An address that carries a password is refused.
const remoteAddress=text=>{
  const value=String(text||'').trim();
  if(!value||value.length>2000||/\s/.test(value))return false;
  if(/^[\w.-]+@[\w.-]+:[^:\s][^\s]*$/.test(value))return true;
  try{const url=new URL(value);return ['https:','http:','ssh:','git:'].includes(url.protocol)&&Boolean(url.hostname)&&!url.password;}catch{return false;}
};
// collaboration: A2A with Nubi in the browser (user decision 2026-10-01). Pairing and sending happen here;
// a request the browser sends runs only after this user accepts it.
// analysisHistory, setShellPreference, wikiUpdate: each conversation's analysis history, the default shell and the
// OpenWiki update of the shared screen, which this host refused until 2026-10-01. VOC stays off the screen (2026-09-30).
const API=new Set(['mail','collaboration','analysisHistory','setShellPreference','wikiUpdate','approvalPolicy','setApprovalMode','allowCommand','removeAllowedCommand','autoApprovals','listSkills','removeSkill','skillMarketplace','computer','decideSetupAction','codeOutline','recoverySnapshot','resumeAgent','diagnoseProcess','applyCommandRepair','knowledgeMap','knowledgeQuery','initializeKnowledgeCatalog','exportKnowledgeMap','databaseConnection','knowledgeStatus','recordKnowledge','comparison','connectKnowledge','overview','state','read','search','wikiQuery','createTask','exportRequirement','createWorktree','mergeProposal','diff','run','exportReport','compare','provider','fabrix','agentInput','startAgent','answerAgent','saveQuestionDraft','stopAgent','poll','stop','events','deleteTask']);

class Host {
  constructor(vscode,runtime,{account,updates,repositoryPicker}={}){this.vscode=vscode;this.runtime=runtime;this.account=account;this.updates=updates;this.repositoryPicker=repositoryPicker;this.root=null;this.opening=null;this.links=new Set();this.urls=new Set();this.applying=false;}
  trusted(){if(!this.vscode.workspace.isTrusted)throw Error('workspace_untrusted');if(this.vscode.env.remoteName)throw Error('local_workspace_required');}
  async openCurrent(){
    this.trusted();if(this.opening)return this.opening;
    this.opening=this.selectRoot();try{return await this.opening;}finally{this.opening=null;}
  }
  async selectRoot(){
    const v=this.vscode,roots=v.workspace.workspaceFolders||[];
    if(!roots.length)return null;
    if(this.root&&roots.some(r=>r.uri.fsPath===this.root))return this.runtime.invoke('overview');
    const selected=roots.length===1?roots[0]:await v.window.showWorkspaceFolderPick({placeHolder:'누비에서 사용할 프로젝트를 선택하세요.'});
    if(!selected)return null;if(selected.uri.scheme!=='file')throw Error('local_workspace_required');
    this.trusted();this.attempted=selected.uri.fsPath;const value=await this.runtime.invoke('open',{root:selected.uri.fsPath});this.root=selected.uri.fsPath;return value;
  }
  async ensureRoot(){
    this.trusted();
    if(!this.root||(this.vscode.workspace.workspaceFolders||[]).every(r=>r.uri.scheme!=='file'||r.uri.fsPath!==this.root))throw Error('project_missing');
  }
  async workspaceView(view){
    await this.ensureRoot();
    const commands={files:'workbench.view.explorer',changes:'workbench.view.scm',search:'workbench.action.findInFiles',terminal:'workbench.action.createTerminalEditor',commands:'workbench.action.showCommands'};
    const command=typeof view==='string'&&Object.hasOwn(commands,view)?commands[view]:null;
    if(!command)throw Error('input_invalid');
    await this.vscode.commands.executeCommand(command);
    return {view};
  }
  async openTeamWorkspace(){
    this.trusted();return this.vscode.env.openExternal(this.vscode.Uri.parse('https://code.sdsdev.co.kr/pages/Manufacturing-IT/ai_workspace'));
  }
  async connectMarketplace(){
    await this.ensureRoot();
    if(this.account){
      if(!(await this.account.status()).connected){await this.account.login();return {loginRequired:true};}
      const credential=await this.account.credential();await this.ensureRoot();
      if(credential.generation!==this.account.generation)throw Error('ghes_session_changed');
      return this.runtime.invoke('connectSkillMarketplace',{token:credential.token});
    }
    const token=await this.vscode.window.showInputBox({title:'회사 스킬 마켓플레이스 연결',prompt:'code.sdsdev.co.kr 저장소를 읽을 수 있는 토큰을 입력하세요. 현재 누비 실행 중에만 보관합니다.',password:true,ignoreFocusOut:true});
    if(!token)return {cancelled:true};
    await this.ensureRoot();return this.runtime.invoke('connectSkillMarketplace',{token});
  }
  async api(method,args={}){
    this.trusted();
    if(['chooseSkillPackage','chooseComputerApp'].includes(method)){
      await this.ensureRoot();const isSkill=method==='chooseSkillPackage',folder=isSkill&&args.kind==='folder';
      if(isSkill&&!['folder','zip'].includes(args.kind))throw Error('input_invalid');
      const choice=await this.vscode.window.showOpenDialog({title:isSkill?(folder?'스킬 폴더 등록':'스킬 ZIP 등록'):'실행할 Windows 앱 선택',canSelectFolders:folder,canSelectFiles:!folder,canSelectMany:false,...(!folder?{filters:isSkill?{'Skill ZIP':['zip']}:{'Windows apps':['exe']}}:{})});
      if(!choice?.length)return {cancelled:true};if(choice[0].scheme!=='file')throw Error('local_workspace_required');
      await this.ensureRoot();
      return this.runtime.invoke(isSkill?'importSkill':'computer',isSkill?{taskId:args.taskId,source:choice[0].fsPath}:{method:'register_app',taskId:args.taskId,file:choice[0].fsPath});
    }
    if(!API.has(method)&&!SETUP.has(method)||method==='computer'&&args.method==='register_app')throw Error('method_invalid');
    if(!['provider','fabrix'].includes(method)&&!SETUP.has(method))await this.ensureRoot();
    if(method==='skillMarketplace'&&this.account&&['refresh','install'].includes(args.operation)){
      const credential=await this.account.credential();await this.ensureRoot();
      if(credential.generation!==this.account.generation)throw Error('ghes_session_changed');
      // Do not clear a pinned catalog before install. Refresh gets credentials for
      // the current account; logout/revocation clears the worker via the host.
      if(args.operation==='refresh')await this.runtime.invoke('connectSkillMarketplace',{token:credential.token});
    }
    const result=await this.runtime.invoke(method,args);
    // The folder that did not open is the project once its setup opened it.
    if(SETUP.has(method)&&result?.opened&&this.attempted)this.root=this.attempted;
    if(method==='exportReport'&&result.uri)this.links.add(result.uri);
    if(method==='connectKnowledge'&&result.url)this.urls.add(result.url);
    return result;
  }
  // A remote repository by its address (user decision 2026-09-30). VS Code's Git clone asks where to save it,
  // signs in through the Git credential manager and opens the folder (git.openAfterClone is always).
  async cloneRepository(url){
    if(this.vscode.env.remoteName)throw Error('local_workspace_required');
    const value=typeof url==='string'&&url.trim()?url.trim():await this.vscode.window.showInputBox({title:'저장소 복제',prompt:'복제할 Git 저장소 주소를 입력하세요.',placeHolder:'https://code.sdsdev.co.kr/repo.git',ignoreFocusOut:true,validateInput:text=>remoteAddress(text)?null:'https://, ssh:// 또는 git@ 주소를 넣어 주세요. 비밀번호가 든 주소는 쓸 수 없어요.'});
    if(!value)return {cancelled:true};
    if(!remoteAddress(value))throw Error('remote_invalid');
    const folder=await this.vscode.commands.executeCommand('git.clone',value);
    return folder?{cloned:true}:{cancelled:true};
  }
  async openPath(file,taskId){await this.ensureRoot();const result=await this.runtime.invoke('read',{path:file,taskId,full:true});await this.vscode.window.showTextDocument(this.vscode.Uri.parse(result.uri),{preview:false,viewColumn:this.vscode.ViewColumn.One});}
  async review(proposalId){await this.ensureRoot();const p=await this.runtime.invoke('proposalArtifacts',{proposalId});await this.vscode.commands.executeCommand('vscode.diff',this.vscode.Uri.parse(p.beforeUri),this.vscode.Uri.parse(p.afterUri),'누비 변경 제안',{preview:true,viewColumn:this.vscode.ViewColumn.One});}
  async apply(proposalId){
    await this.ensureRoot();if(this.applying)throw Error('project_busy');this.applying=true;
    try{
      const v=this.vscode,p=await this.runtime.invoke('prepareProposal',{proposalId});if(p.alreadyApplied)return p;
      const uri=v.Uri.parse(p.uri),target=uri.fsPath;
      for(const doc of v.workspace.textDocuments){
        if(!doc.isDirty||doc.uri.scheme!=='file')continue;
        if(doc.uri.fsPath===target)throw Error('editor_dirty');
        const actual=await realpath(doc.uri.fsPath).catch(()=>null);if(actual&&actual===await realpath(target).catch(()=>null))throw Error('editor_dirty');
      }
      if(p.kind==='create')return this.runtime.invoke('applyNewFile',{proposalId});
      const editor=await v.window.showTextDocument(uri,{preview:false,viewColumn:v.ViewColumn.One}),doc=editor.document;
      if(doc.isDirty)throw Error('editor_dirty');
      const version=doc.version;if(digest(doc.getText())!==p.expectedHash)throw Error('source_stale');
      await this.ensureRoot();
      const check=await this.runtime.invoke('prepareProposal',{proposalId});
      if(check.alreadyApplied)return check;
      if(check.expectedHash!==p.expectedHash||check.afterHash!==p.afterHash||doc.version!==version||doc.isDirty)throw Error('source_stale');
      const edited=await editor.edit(edit=>edit.replace(new v.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),p.content),{undoStopBefore:true,undoStopAfter:true});
      if(!edited)throw Error('editor_apply_failed');
      if(doc.version!==version+1||digest(doc.getText())!==p.afterHash)throw Error('editor_changed');
      if(!await doc.save())throw Error('editor_save_failed');
      return this.runtime.invoke('confirmProposal',{proposalId});
    }finally{this.applying=false;}
  }
  async handle(request){
    this.trusted();if(!request||typeof request.method!=='string'||!Array.isArray(request.args))throw Error('method_invalid');
    const [a,b]=request.args;
    switch(request.method){
      case 'api':return this.api(a,b);
      case 'openCurrent':return this.openCurrent();
      case 'chooseFolder':return this.vscode.commands.executeCommand('vscode.openFolder');
      case 'cloneRepository':return this.cloneRepository(a);
      case 'ghesAccount':if(!this.account)throw Error('method_invalid');return this.account.action(a);
      case 'ghesUpdate':if(!this.updates)throw Error('method_invalid');return this.updates.action(a);
      case 'ghesRepositories':if(!this.account||!this.repositoryPicker)throw Error('method_invalid');return this.repositoryPicker();
      case 'connectMarketplace':return this.connectMarketplace();
      case 'openTeamWorkspace':return this.openTeamWorkspace();
      case 'workspaceView':return this.workspaceView(a);
      case 'openPath':return this.openPath(a,b);
      case 'review':return this.review(a);
      case 'apply':return this.apply(a);
      case 'openURI':if(!this.links.has(a))throw Error('path_scope');await this.vscode.window.showTextDocument(this.vscode.Uri.parse(a),{viewColumn:this.vscode.ViewColumn.One});return;
      case 'openBrowser':if(!this.urls.has(a)||!/^https?:\/\/127\.0\.0\.1:/.test(a))throw Error('url_scope');return this.vscode.env.openExternal(this.vscode.Uri.parse(a));
      default:throw Error('method_invalid');
    }
  }
}
module.exports={Host,remoteAddress};
