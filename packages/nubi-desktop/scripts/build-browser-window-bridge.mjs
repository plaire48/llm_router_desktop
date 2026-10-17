import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.env.NUBI_DOTNET||'dotnet',['build','native/BrowserWindowBridge/BrowserWindowBridge.csproj','-c','Release','--ignore-failed-sources','-o','generated/browser-window-bridge'],{stdio:'inherit'});
if(result.error)throw result.error;if(result.status!==0)throw Error('browser_window_bridge_build_failed');
const file='Nubi.BrowserWindowBridge.exe',bytes=await readFile('generated/browser-window-bridge/'+file);
await writeFile('generated/browser-window-bridge/manifest.json',JSON.stringify({protocol:1,file,sha256:createHash('sha256').update(bytes).digest('hex')},null,2));
