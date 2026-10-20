const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),path=require('node:path');
const {Host}=require('../src/host.cjs');
const luminance=hex=>{const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
const contrast=(a,b)=>{const l=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (l[0]+.05)/(l[1]+.05);};

test('native navigation cannot inject commands, access remote projects or run the agent',async()=>{
  const calls=[],v={workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:'/project'}}]},env:{},commands:{executeCommand:async command=>calls.push(command)}};
  const host=new Host(v,{invoke:async method=>{assert.equal(method,'open');return {};}});
  await assert.rejects(host.workspaceView('files'),/project_missing/);await host.openCurrent();
  for(const view of ['files','changes','search','terminal','commands'])await host.handle({method:'workspaceView',args:[view]});
  assert.deepEqual(calls,['workbench.view.explorer','workbench.view.scm','workbench.action.findInFiles','workbench.action.createTerminalEditor','workbench.action.showCommands']);
  for(const bad of ['terminal.sendSequence','workbench.action.terminal.new','__proto__',{},null])await assert.rejects(host.workspaceView(bad),/input_invalid/);
  v.env.remoteName='ssh-remote';await assert.rejects(host.workspaceView('files'),/local_workspace_required/);v.env.remoteName=null;
  v.workspace.isTrusted=false;await assert.rejects(host.workspaceView('changes'),/workspace_untrusted/);
  v.workspace.isTrusted=true;v.workspace.workspaceFolders=[];await assert.rejects(host.workspaceView('files'),/project_missing/);
  assert.equal(calls.length,5);
});

test('the built-in theme is local and critical native text pairs meet 4.5:1 contrast',()=>{
  const directory=path.resolve(__dirname,'..'),manifest=JSON.parse(readFileSync(path.join(directory,'package.json')));
  const contribution=manifest.contributes.themes.find(theme=>theme.id===manifest.contributes.configurationDefaults['workbench.colorTheme']);
  assert(contribution&&contribution.uiTheme==='vs');
  const theme=JSON.parse(readFileSync(path.join(directory,contribution.path))),colors=theme.colors;
  for(const [fg,bg]of [['foreground','editor.background'],['descriptionForeground','sideBar.background'],['button.foreground','button.background'],['activityBarBadge.foreground','activityBarBadge.background'],['statusBar.foreground','statusBar.background'],['input.placeholderForeground','input.background'],['tab.inactiveForeground','tab.inactiveBackground']])
    assert(contrast(colors[fg],colors[bg])>=4.5,fg+' on '+bg);
  const syntax=JSON.parse(readFileSync(path.resolve(directory,path.dirname(contribution.path),theme.include)));
  for(const token of syntax.tokenColors)assert(contrast(token.settings.foreground,colors['editor.background'])>=4.5,token.scope.join(','));
});

// The product requirement supersedes the former closable editor-tab layout.
test('Nubi contributes a permanent native view rather than an editor panel',()=>{
  const manifest=JSON.parse(readFileSync(path.resolve(__dirname,'../package.json'))),source=readFileSync(path.resolve(__dirname,'../src/extension.cjs'),'utf8');
  assert.equal(manifest.contributes.viewsContainers.panel[0].id,'nubi');
  assert.equal(manifest.contributes.views.nubi[0].type,'webview');
  assert.equal(manifest.contributes.views.nubi[0].id,'nubi.workspace');
  assert(source.includes('registerWebviewViewProvider'));assert(!source.includes('createWebviewPanel'));
});
