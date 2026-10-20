const vscode=require('vscode'),assert=require('node:assert/strict');
const {mkdtemp,readFile,writeFile,rm}=require('node:fs/promises');
const path=require('node:path'),os=require('node:os');

exports.run=async()=>{
  const waitFor=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,30));}assert(check());};
  const browser=await require('playwright').chromium.connectOverCDP('http://127.0.0.1:'+process.env.NUBI_TEST_CDP_PORT);
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('workbench'))||browser.contexts()[0].pages()[0];
  const checks=[],directory=path.resolve(__dirname,'..'),root=vscode.workspace.workspaceFolders[0].uri.fsPath;
  const extension=vscode.extensions.getExtension('nubi-internal.nubi-workspace');assert(extension);
  if(process.env.NUBI_TEST_INSTALLED==='1')assert.notEqual(extension.extensionPath,directory);
  const {Runtime}=require(path.join(extension.extensionPath,'src/runtime.cjs')),{Host}=require(path.join(extension.extensionPath,'src/host.cjs'));
  const state=await mkdtemp(path.join(os.tmpdir(),'nubi-vscode-state-')),runtime=new Runtime(extension.extensionPath,state),host=new Host(vscode,runtime);
  const uri=vscode.Uri.file(path.join(root,'app.txt'));
  try{
    await extension.activate();await vscode.commands.executeCommand('nubi.open');checks.push('real VS Code activates the built-in native Nubi workspace view');
    let frame;for(let i=0;i<150&&!frame;i++){frame=page.frames().find(f=>f.url().includes('/fake.html'));if(!frame)await new Promise(r=>setTimeout(r,100));}assert(frame,'Nubi webview frame loads');
    for(const name of ['AI Pro','ChatGPT','FabriX'])await frame.getByRole('button',{name,exact:true}).waitFor({state:'visible',timeout:15000});
    assert.equal(await page.locator('.part.panel').isVisible(),true,'Nubi is the central native agent workspace');
    assert.equal(await page.locator('.part.editor').isVisible(),false,'the agent owns the center before a file is requested');
    assert.equal(vscode.window.tabGroups.all.flatMap(group=>group.tabs).filter(tab=>tab.input instanceof vscode.TabInputWebview&&tab.label==='누비 Workspace').length,0,'Nubi never occupies a closable editor tab');
    assert.equal(await frame.locator('[data-host-layout="integrated"]').count(),1,'shared workbench is sized to its native pane');
    const fonts=await frame.evaluate(async()=>{const faces=await document.fonts.load('400 14px "Noto Sans KR"','누비');return faces.map(f=>f.status);});assert(fonts.length&&fonts.every(s=>s==='loaded'));assert(await frame.evaluate(()=>Array.from(document.images).filter(i=>i.src).every(i=>i.complete&&i.naturalWidth>0)));checks.push('actual webview loads shared login, all three provider buttons, fonts and brand icons');
    await new Promise(resolve=>setTimeout(resolve,800));
    await page.screenshot({path:path.join(directory,'verification/vscode-ui.png')});
    await frame.getByRole('button',{name:'설정',exact:true}).click();await frame.getByRole('button',{name:'스킬 관리',exact:true}).click();await frame.getByRole('button',{name:'ZIP 등록',exact:true}).waitFor();await frame.getByText('등록한 스킬이 없어요.',{exact:false}).waitFor();
    await page.screenshot({path:path.join(directory,'verification/vscode-skills.png')});checks.push('actual skill modal loads registered catalog through the webview RPC');
    await page.keyboard.press('Escape');
    // User decision 2026-10-01: A2A with Nubi in the browser, through the real webview, host and bundled runtime.
    const a2a=await import(require('node:url').pathToFileURL(path.join(directory,'../nubi-a2a/client.mjs')).href);
    await page.keyboard.press('Escape');await frame.locator('.cx-panel-backdrop').waitFor({state:'detached',timeout:5000});// the skill panel returns to settings first
    await frame.getByRole('button',{name:'에이전트 연결',exact:true}).click();await frame.getByRole('button',{name:'브라우저 누비 연결 주소 만들기',exact:true}).click();
    const web=await a2a.taskApi(await a2a.connectA2A(await frame.locator('#nubi-agent-invite').inputValue(),'browser'));
    await frame.getByText('연결됨',{exact:true}).waitFor({timeout:15000});await frame.locator('.cx-panel-backdrop').getByRole('button',{name:'닫기',exact:true}).click();await frame.locator('.cx-panel-backdrop').waitFor({state:'detached'});
    const asked=await web.request({recipient:'desktop',skill:'source-search',request:'app.txt 첫 줄을 알려 주세요.'},{messageId:'vscode-webview-0001'});
    const waiting=frame.getByRole('button',{name:'에이전트 연결, 받은 요청 1개',exact:true});await waiting.waitFor({timeout:15000});checks.push('a request from the paired browser shows its count in the real webview header');
    await waiting.click();await frame.getByRole('article',{name:'브라우저 누비의 요청'}).getByRole('button',{name:'수락',exact:true}).click();
    await frame.getByRole('button',{name:'에이전트 연결',exact:true}).waitFor({timeout:15000});assert.equal((await web.get(asked.id)).state,'working');
    await frame.getByText('app.txt 첫 줄을 알려 주세요.',{exact:true}).first().waitFor();await new Promise(r=>setTimeout(r,1500));
    assert.equal(await frame.getByText('분석 이력을 불러오지 못했어요',{exact:false}).count(),0,'the conversation loads its analysis history through the host');
    await page.screenshot({path:path.join(directory,'verification/vscode-agent-connection.png')});checks.push('accepting it in the real webview opens it as a draft conversation and tells the browser it started');

    await host.openCurrent();const source=await host.api('read',{path:'app.txt'});assert.equal(source.content,'before\n');
    const wiki=await host.api('wikiQuery',{query:'Project identity'});assert(wiki.results.length>0);checks.push('bundled Node sidecar reads source and actual OpenWiki-SDS evidence');
    const task=await runtime.invoke('createTask',{request:'Replace fixture text',criteria:['Preserve human edits']});
    const proposal=await runtime.invoke('propose',{taskId:task.id,path:'app.txt',expectedHash:source.hash,content:'after\n',reason:'VS Code integration fixture',rulesFingerprint:source.projectRules.fingerprint});
    await host.review(proposal.id);assert(vscode.window.tabGroups.all.flatMap(g=>g.tabs).some(t=>t.input instanceof vscode.TabInputTextDiff));assert.equal(await page.locator('.part.editor').isVisible(),true,'requested diff reveals the supporting editor');assert.equal(await page.locator('.part.panel').isVisible(),true,'agent stays visible next to the supporting diff');checks.push('proposal opens in the actual VS Code diff editor');
    let editor=await vscode.window.showTextDocument(uri,{viewColumn:vscode.ViewColumn.One,preview:false});await editor.edit(e=>e.insert(new vscode.Position(0,0),'human '));
    await assert.rejects(host.apply(proposal.id),/editor_dirty/);assert.equal(await readFile(uri.fsPath,'utf8'),'before\n');assert(editor.document.getText().startsWith('human '));checks.push('dirty editor buffer blocks application and preserves disk and human text');
    editor=await vscode.window.showTextDocument(editor.document,{viewColumn:vscode.ViewColumn.One,preview:false});await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');await waitFor(()=>editor.document.getText()==='before\n');assert.equal(editor.document.getText(),'before\n');await editor.document.save();
    const result=await host.apply(proposal.id);assert.equal(result.state,'applied');assert.equal(await readFile(uri.fsPath,'utf8'),'after\n');checks.push('actual editor edit and save receive verified host readback');
    editor=await vscode.window.showTextDocument(editor.document,{viewColumn:vscode.ViewColumn.One,preview:false});await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');await waitFor(()=>editor.document.getText()==='before\n');assert.equal(editor.document.getText(),'before\n');await editor.document.save();checks.push('applied change remains in native VS Code undo history');
    const task2=await runtime.invoke('createTask',{request:'Check stale source'});const old=await runtime.invoke('read',{path:'app.txt'});
    const stale=await runtime.invoke('propose',{taskId:task2.id,path:'app.txt',expectedHash:old.hash,content:'stale\n',reason:'fixture',rulesFingerprint:old.projectRules.fingerprint});
    await editor.edit(e=>e.replace(new vscode.Range(editor.document.positionAt(0),editor.document.positionAt(editor.document.getText().length)),'human saved\n'));await editor.document.save();
    await assert.rejects(host.apply(stale.id),/source_stale/);assert.equal(await readFile(uri.fsPath,'utf8'),'human saved\n');checks.push('saved source drift refuses stale proposals');
    const copy=await runtime.invoke('exportReport',{taskId:task.id});await assert.rejects(host.handle({method:'openURI',args:[copy.uri]}),/path_scope/);
    const report=await host.api('exportReport',{taskId:task.id});await host.handle({method:'openURI',args:[report.uri]});checks.push('only host-issued report links open in VS Code');
    const processResult=await host.api('run',{taskId:task.id,profile:process.platform==='win32'?'powershell':'bash',script:process.platform==='win32'?"Write-Output 'VSCODE_NUBI_OK'":"printf VSCODE_NUBI_OK"});
    let processState=processResult;for(let i=0;i<100&&['running','stopping','checking'].includes(processState.state);i++){await new Promise(r=>setTimeout(r,100));processState=await host.api('poll',{id:processResult.id});}
    assert.equal(processState.state,'completed');assert.match(processState.output,/VSCODE_NUBI_OK/);checks.push('shared owned shell executes and returns actual output in the extension host');
    const peer=await a2a.taskApi(await a2a.connectA2A((await host.api('collaboration',{action:'invite',recipient:'browser'})).url,'browser'));
    const sent=await host.api('collaboration',{action:'task_request',taskId:task.id,requestId:'vscode-request-0001',skill:'web-lookup',request:'공지 날짜를 출처와 함께 찾아 주세요.',urls:['https://example.org/notice']});
    assert.deepEqual((await peer.list()).tasks.map(job=>[job.id,job.state]),[[sent.id,'submitted']]);await peer.accept(sent.id);
    await peer.complete(sent.id,{summary:'공지 날짜는 10월 1일입니다.',facts:[{name:'날짜',value:'2026-10-01',source_url:'https://example.org/notice'}],evidence:[],verification:'not_run',localRunId:'vscode-browser-run'});
    assert.equal((await host.api('state')).peerTasks.find(job=>job.id===sent.id).result.facts[0].source_url,'https://example.org/notice');checks.push('a task sent through the real host reaches the browser and its sourced result comes back');
    const file=path.join(directory,process.env.NUBI_TEST_INSTALLED==='1'?'verification/vscode-installed.json':'verification/vscode-host.json');await writeFile(file,JSON.stringify({passed:true,installedVsix:process.env.NUBI_TEST_INSTALLED==='1',platform:process.platform,version:vscode.version,checks,scope:'Actual VS Code extension host and editors, bundled Node worker, SQLite, OpenWiki-SDS and shell. No live LLM or Windows GUI claim.'},null,2));console.log(JSON.stringify({checks}));
    if(process.env.NUBI_TEST_DESIGN==='1')await require('./design-vscode-suite.cjs').runDesignChecks({page,frame});
  }finally{await browser.close();runtime.dispose();await new Promise(r=>setTimeout(r,2000));await rm(state,{recursive:true,force:true});}
};
