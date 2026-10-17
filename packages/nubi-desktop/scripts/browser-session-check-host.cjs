const {app,BrowserWindow}=require('electron');
const {BrowserHost}=require('../electron-app/browser-host.cjs');
app.setPath('userData',process.argv[2]);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false}),host=new BrowserHost(window,{partition:'persist:nubi-browser-workspace'});
 if(!host.session.isPersistent())throw Error('browser_session_not_persistent');
 if(process.argv[3]==='write'){await host.session.cookies.set({url:'http://127.0.0.1/',name:'nubi-fixture',value:'restart-proof',expirationDate:Date.now()/1000+600});await host.session.cookies.flushStore();}
 else{const cookies=await host.session.cookies.get({url:'http://127.0.0.1/',name:'nubi-fixture'});if(cookies.length!==1||cookies[0].value!=='restart-proof')throw Error('browser_session_restart_failed');await host.session.clearStorageData();}
 host.dispose();window.destroy();console.log('PASS: persistent browser session '+process.argv[3]);app.quit();
}).catch(error=>{console.error(error.message);app.exit(1);});
