const vscode=require('vscode'),assert=require('node:assert/strict'),path=require('node:path');
const {writeFile}=require('node:fs/promises');

// Run within the original live CDP session: reconnecting loses already attached
// out-of-process webview frames in Electron. All original host checks remain.
exports.runDesignChecks=async({page,frame})=>{
  const checks=[],directory=path.resolve(__dirname,'..');
  const wait=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}assert(await fn());};
  const settings=vscode.workspace.getConfiguration('workbench'),original=settings.inspect('colorTheme')?.globalValue;
  try {
    await vscode.commands.executeCommand('nubi.open');assert(frame);assert.equal(await page.locator('.part.panel').isVisible(),true);
    const before=await page.locator('.part.panel').boundingBox();await vscode.commands.executeCommand('nubi.open');const after=await page.locator('.part.panel').boundingBox();assert.equal(after.width,before.width);assert.equal(await page.locator('.part.editor').isVisible(),true);checks.push('reopening the central agent preserves supporting editors and the user layout');
    assert.equal(settings.get('colorTheme'),'Nubi Light');await wait(()=>page.locator('.monaco-workbench').evaluate(e=>e.classList.contains('vs')));
    const chrome=await page.locator('.part.titlebar').evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(chrome,'rgb(241, 247, 254)');assert.equal(await page.locator('.part.activitybar').isVisible(),false);assert.equal(await page.locator('.part.statusbar').isVisible(),false);assert.equal(await page.locator('.command-center').count(),0);checks.push('Nubi Light colors native chrome while generic icon/status bars and command center are hidden');
    assert.equal(await frame.locator('.nubi-logo-title').innerText(),'누비 Workspace');assert.equal(await frame.locator('.nubi-beta').innerText(),'Beta');checks.push('actual webview displays 누비 Workspace with Beta');
    await frame.getByRole('button',{name:'파일',exact:true}).focus();await frame.getByRole('button',{name:'파일',exact:true}).press('Enter');await page.locator('.part.sidebar').waitFor({state:'visible'});await vscode.commands.executeCommand('nubi.open');assert.equal(await page.locator('.part.sidebar').isVisible(),true);checks.push('keyboard native file navigation works and reopening Nubi preserves the sidebar');
    await frame.getByRole('button',{name:'Git 변경',exact:true}).click();await wait(()=>page.locator('.part.sidebar').innerText().then(text=>/Source Control|소스 제어|Changes|변경/.test(text)));checks.push('native Git view is reached from the same conversation');
    await frame.getByRole('button',{name:'검색',exact:true}).click();await page.locator('.search-view').waitFor({state:'visible'});checks.push('project search remains available from the Nubi rail');
    await frame.getByRole('button',{name:'터미널',exact:true}).click();await wait(()=>vscode.window.tabGroups.all.flatMap(group=>group.tabs).some(tab=>tab.input instanceof vscode.TabInputTerminal));assert.equal(await page.locator('.part.panel').isVisible(),true);checks.push('native terminal opens as a supporting editor without replacing the agent');
    await vscode.commands.executeCommand('nubi.open');
    const panel=await page.locator('.part.panel').boundingBox(),editor=await page.locator('.part.editor').boundingBox();
    const target=Math.min(900,panel.width+editor.width-300),edge=panel.x+panel.width;
    const sashes=await page.locator('.monaco-sash.vertical:not(.disabled)').all();let sash;
    for(const candidate of sashes){const box=await candidate.boundingBox();if(box&&Math.abs(box.x+box.width/2-edge)<=5&&box.height>100){sash=box;break;}}
    assert(sash,'a native sash separates the central agent and supporting editor');
    await page.mouse.move(sash.x+sash.width/2,sash.y+sash.height/2);await page.mouse.down();await page.mouse.move(sash.x+sash.width/2+target-panel.width,sash.y+sash.height/2,{steps:12});await page.mouse.up();
    await wait(()=>frame.locator('.nubi-sidebar').isVisible());const resized=await page.locator('.part.panel').boundingBox();assert(resized.width>=760);await vscode.commands.executeCommand('nubi.open');assert.equal((await page.locator('.part.panel').boundingBox()).width,resized.width);
    checks.push('native resizing shows project history, central conversation and supporting editor together and reopening preserves it');
    await page.screenshot({path:path.join(directory,'verification/design-native-light.png')});
    await frame.getByRole('button',{name:'스킬',exact:true}).click();const skillPage=frame.getByRole('region',{name:'스킬 관리',exact:true});await skillPage.getByRole('heading',{name:'스킬',exact:true}).waitFor();assert.equal(await frame.getByRole('dialog').count(),0);assert.equal(await skillPage.locator('.nubi-skill-page-header').evaluate(e=>getComputedStyle(e).display),'flex');assert.equal(await skillPage.getByRole('button',{name:'설치한 스킬',exact:true}).count(),1);assert.equal(await skillPage.getByRole('button',{name:'스킬 찾기',exact:true}).count(),1);assert.equal(await skillPage.getByRole('searchbox',{name:'스킬 검색',exact:true}).count(),1);assert.equal(await page.locator('.part.editor').isVisible(),true);await page.screenshot({path:path.join(directory,'verification/design-native-skills.png')});checks.push('actual built webview opens the central skill page with search and installed/find views while preserving supporting editors');
    await skillPage.getByRole('button',{name:'대화로 돌아가기',exact:true}).click();await skillPage.waitFor({state:'hidden'});assert.equal(await frame.getByText('app.txt 첫 줄을 알려 주세요.',{exact:true}).first().isVisible(),true);await wait(()=>frame.evaluate(()=>document.activeElement?.getAttribute('aria-label')==='스킬'));checks.push('native skills back returns to the same conversation and restores the rail focus');

    await settings.update('colorTheme','Default Dark Modern',vscode.ConfigurationTarget.Global);await wait(()=>frame.locator('body').evaluate(e=>e.classList.contains('vscode-dark')));
    assert.equal(await frame.locator('.deck-ambient').isVisible(),false);const dark=await frame.locator('.nubi-workbench').evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundImage}));assert.equal(dark.background,'none');checks.push('explicit dark theme reaches the webview and removes decorative backgrounds');
    await page.screenshot({path:path.join(directory,'verification/design-native-dark.png')});
    await settings.update('colorTheme','Default High Contrast',vscode.ConfigurationTarget.Global);await wait(()=>frame.locator('body').evaluate(e=>e.classList.contains('vscode-high-contrast')));assert.equal(await frame.locator('.deck-ambient').isVisible(),false);checks.push('actual high-contrast theme reaches the webview and preserves named project controls');
    await page.screenshot({path:path.join(directory,'verification/design-native-contrast.png')});
    await writeFile(path.join(directory,'verification/workspace-design-host.json'),JSON.stringify({passed:true,platform:process.platform,version:vscode.version,originalChecks:14,checks,scope:'Actual macOS VS Code native views, themes and shared webview. No Windows release or real-model claim.'},null,2));console.log(JSON.stringify({designChecks:checks}));
  } catch(error) {
    await page.screenshot({path:path.join(directory,'verification/design-failure.png')});
    await writeFile(path.join(directory,'verification/design-failure.json'),JSON.stringify({error:error.message,checks,frames:page.frames().map(f=>f.url()),theme:settings.get('colorTheme')},null,2));throw error;
  } finally {await settings.update('colorTheme',original,vscode.ConfigurationTarget.Global);}
};
