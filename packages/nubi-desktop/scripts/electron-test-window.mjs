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
