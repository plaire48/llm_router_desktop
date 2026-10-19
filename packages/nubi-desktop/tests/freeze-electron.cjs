// Test-only isolated Electron renderer; no production IPC or user storage.
const {app,BrowserWindow}=require('electron');
const {prepareNativeInput}=require('../electron-app/native-input-preparation.cjs');
if(!process.env.NUBI_FREEZE_STORAGE)throw Error('test_storage_required');
app.setPath('userData',process.env.NUBI_FREEZE_STORAGE);
app.whenReady().then(()=>{const window=new BrowserWindow({width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});globalThis.__nubiFreezePrepareInput=()=>prepareNativeInput(window);window.loadURL(process.argv.at(-1));});
app.on('window-all-closed',()=>app.quit());
