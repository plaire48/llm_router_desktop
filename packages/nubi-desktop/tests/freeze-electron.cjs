// Test-only isolated Electron renderer; no production IPC or user storage.
const {app,BrowserWindow}=require('electron');
app.whenReady().then(()=>{const window=new BrowserWindow({width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});window.loadURL(process.argv.at(-1));});
app.on('window-all-closed',()=>app.quit());
