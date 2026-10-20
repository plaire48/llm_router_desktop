const vscode=require('vscode');
const {randomBytes}=require('node:crypto');
const {Runtime}=require('./runtime.cjs');
const {Host}=require('./host.cjs');
const {GhesAccount,CLIENT_ID,SECRET_KEY}=require('./ghes.cjs');
const {GhesUpdates}=require('./ghes-updates.cjs');
const {registerGhesGit,chooseRepository}=require('./ghes-git.cjs');

function activate(context){
  const runtime=new Runtime(context.extensionPath,context.globalStorageUri.fsPath);
  let updates;
  const clientId=vscode.workspace.getConfiguration('nubi.ghes').inspect('clientId')?.globalValue||CLIENT_ID;
  const account=new GhesAccount({secrets:context.secrets,clientId,openExternal:url=>vscode.env.openExternal(vscode.Uri.parse(url)),copyCode:code=>vscode.env.clipboard.writeText(code),onInvalidated:async()=>{
    if(updates){updates.candidate=null;updates.state='unchecked';}
    if(runtime.child?.connected)await runtime.invoke('disconnectSkillMarketplace');
  }});
  updates=new GhesUpdates({account,vscode,context});
  const gitReady=registerGhesGit(vscode,account).then(disposable=>{if(disposable)context.subscriptions.push(disposable);return !!disposable;}).catch(()=>false);
  const host=new Host(vscode,runtime,{account,updates,repositoryPicker:async()=>{if(!await gitReady)throw Error('ghes_git_unavailable');return chooseRepository(vscode,account);}});
  context.subscriptions.push({dispose:()=>account.dispose()},context.secrets.onDidChange(async event=>{
    if(event.key!==SECRET_KEY||!account.record)return;
    let saved;try{saved=await context.secrets.get(SECRET_KEY);}catch{return;}
    let token;try{token=JSON.parse(saved).token;}catch{}
    if(token!==account.record?.token){account.dispose();account.loaded=false;account.state='guest';if(runtime.child?.connected)await runtime.invoke('disconnectSkillMarketplace').catch(()=>{});}
  }));
  let panel,showPending;
  const bind=target=>{
    panel=target;const nonce=randomBytes(24).toString('base64url');
    const media=vscode.Uri.joinPath(context.extensionUri,'media');
    panel.webview.options={enableScripts:true,localResourceRoots:[media]};
    panel.title='에이전트';
    const base=panel.webview.asWebviewUri(media).toString()+'/',source=panel.webview.cspSource;
    panel.webview.html=`<!doctype html><html lang="ko"><head><title>누비 Workspace</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${source} data: blob:; font-src ${source}; style-src ${source} 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri ${source};"><base href="${base}"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script nonce="${nonce}" src="app.js"></script></body></html>`;
    const active=new Set();
    panel.webview.onDidReceiveMessage(async message=>{
      if(!message||typeof message.id!=='string'||message.id.length>100||active.has(message.id))return;
      active.add(message.id);
      try {const result=await host.handle(message);await target.webview.postMessage({id:message.id,result});}
      catch(error){await target.webview.postMessage({id:message.id,error:/^[a-z_]{3,50}$/.test(error.message)?error.message:'operation_failed'});}
      finally{active.delete(message.id);}
    },null,context.subscriptions);
    panel.onDidDispose(()=>{if(panel===target)panel=null;},null,context.subscriptions);
  };
  const show=()=>{
    if(showPending)return showPending;
    showPending=(async()=>{
    if(!vscode.workspace.isTrusted){await vscode.window.showWarningMessage('이 프로젝트를 신뢰한 뒤 누비를 열어 주세요.');return;}
    if(vscode.env.remoteName||vscode.workspace.workspaceFolders?.some(f=>f.uri.scheme!=='file')){await vscode.window.showWarningMessage('현재 누비는 로컬 VS Code 작업 공간을 지원합니다.');return;}
    // Nubi is the permanent native workspace view, never a closable editor tab.
    // Opening it preserves the user's file/editor/Git layout.
    await vscode.commands.executeCommand('nubi.workspace.focus');
    })();
    return showPending.finally(()=>{showPending=null;});
  };
  // A remote repository by its address; VS Code's Git clone saves it and opens it (user decision 2026-09-30).
  const connect=async()=>{try{await host.cloneRepository();}catch(error){await vscode.window.showErrorMessage(error.message==='remote_invalid'?'https://, ssh:// 또는 git@ 주소를 넣어 주세요.':'저장소를 복제하지 못했어요. 주소와 로그인을 확인해 주세요.');}};
  context.subscriptions.push(vscode.commands.registerCommand('nubi.cloneRepository',connect),
    vscode.window.registerWebviewViewProvider('nubi.workspace',{resolveWebviewView:view=>bind(view)},{webviewOptions:{retainContextWhenHidden:true}}),
    vscode.commands.registerCommand('nubi.open',show),{dispose:()=>runtime.dispose()});
  // Migrate a restored legacy Nubi editor tab to the native view. No file tab
  // is closed and no agent call is made during this layout migration.
  context.subscriptions.push(vscode.window.registerWebviewPanelSerializer('nubi.workspace',{async deserializeWebviewPanel(saved){saved.dispose();await show();}}));
  const opening=setTimeout(()=>show().catch(()=>{}),800);context.subscriptions.push({dispose:()=>clearTimeout(opening)});
  return {show};
}
module.exports={activate};
