import {execFileSync} from 'node:child_process';
// Portal authentication also owns hidden BrowserWindows. Select the packaged
// workspace explicitly and give cold Windows startup its own readiness budget.
export async function desktopTestWindow(app, {timeout = 60000} = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = app.windows().find(candidate => candidate.url() === 'app://bundle/index.html');
    if (page) {
      await page.waitForLoadState('domcontentloaded', {timeout: Math.max(1, deadline - Date.now())});
      await (await app.browserWindow(page)).evaluate(window => { window.show(); window.focus(); });
      await page.bringToFront();
      return page;
    }
    if (app.process().exitCode !== null) throw new Error('Desktop process exited before its main window opened');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Desktop main window did not open: ' + app.windows().map(page => page.url()).join(', '));
}

// Ends a launched Electron and everything it started. On Windows a killed process leaves its children running (the
// app behind a launcher, its worker, its window helper); a relaunch then met the single-instance lock and the check
// waited for ever (Windows gates 2026-10-21). taskkill /T ends the whole tree there.
export function killProcessTree(child){
  if(!child?.pid)return;
  if(process.platform==='win32'){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{}return;}
  try{child.kill('SIGKILL');}catch{}
}
