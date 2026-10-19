// Isolated fixture: production preload and native visibility publisher. The
// product request IPC has no handlers; fixture business APIs remain synthetic.
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
const {watchMotionVisibility}=require('../electron-app/motion-visibility.cjs');
if(!process.env.NUBI_FREEZE_STORAGE)throw Error('test_storage_required');
app.setPath('userData',process.env.NUBI_FREEZE_STORAGE);
app.whenReady().then(()=>{const window=new BrowserWindow({width:1280,height:900,webPreferences:{preload:path.resolve(__dirname,'../electron-app/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});watchMotionVisibility(window);window.loadURL(process.argv.at(-1));});
app.on('window-all-closed',()=>app.quit());
