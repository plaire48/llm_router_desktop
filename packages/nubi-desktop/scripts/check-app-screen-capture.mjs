// Native Windows acceptance on a disposable WPF window. No company application.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {AppScreenCapture} from '../runtime/app-screen-capture.mjs';
import {POWERSHELL_TEXT_ARGS,POWERSHELL_UTF8_PREFIX} from '../runtime/powershell-encoding.mjs';
if(process.platform!=='win32'){console.log('SKIP Windows UIA/PrintWindow acceptance requires Windows');process.exit(0);}
const root=await mkdtemp(path.join(os.tmpdir(),'nubi-capture-native-')),out=path.resolve('verification/app-screen-capture-2026-10-23/windows'),title='Nubi Capture Fixture '+crypto.randomUUID();
await mkdir(out,{recursive:true});
const script=POWERSHELL_UTF8_PREFIX+`
Add-Type -AssemblyName PresentationFramework
$window = New-Object System.Windows.Window
$window.Title = '${title}'; $window.Width = 640; $window.Height = 420; $window.ShowActivated = $false
$stack = New-Object System.Windows.Controls.StackPanel; $stack.Margin = '24'
$text = New-Object System.Windows.Controls.TextBlock; $text.Text = 'Synthetic error message'; $text.FontSize = 24
[System.Windows.Automation.AutomationProperties]::SetName($text, 'Nubi Capture Error')
$stack.Children.Add($text) | Out-Null
$password = New-Object System.Windows.Controls.PasswordBox; $password.Password = 'FIXTURE ONLY'; $password.Height = 32
$stack.Children.Add($password) | Out-Null
$window.Content = $stack
$window.Add_ContentRendered({ [Console]::Out.WriteLine('READY') })
$window.ShowDialog() | Out-Null
`;
const binary=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const child=spawn(binary,[...POWERSHELL_TEXT_ARGS,'-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:['ignore','pipe','pipe'],windowsHide:false});
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture_timeout')),20000);let text='';child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('fixture_exit_'+code));});child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('READY')){clearTimeout(timer);resolve();}});child.stderr.resume();});
 const capture=new AppScreenCapture(),found=await capture.find({windowQuery:title,controlQuery:'Nubi Capture Error'});
 assert.equal(found.windows.length,1);const selected=found.windows[0];assert.equal(selected.elements.length,1);
 const whole=await capture.capture({windowId:selected.windowId}),region=await capture.capture({windowId:selected.windowId,elementId:selected.elements[0].elementId});
 assert.equal(whole.passwordsMasked,true);assert.equal(region.passwordsMasked,true);assert(region.width<whole.width);assert(region.height<whole.height);
 await writeFile(path.join(out,'window.png'),Buffer.from(whole.image,'base64'));await writeFile(path.join(out,'element.png'),Buffer.from(region.image,'base64'));
 child.kill();await new Promise(resolve=>child.exitCode===null?child.once('exit',resolve):resolve());
 await assert.rejects(capture.capture({windowId:selected.windowId}),/app_capture_(changed|unavailable)/);
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['UIA window discovery','UIA control discovery','PrintWindow PNG','control crop','password masking metadata','closed-window rejection'],scope:'Owned synthetic WPF fixture on Windows only. Not company apps, all DPI/multi-monitor configurations or a live model.'},null,2));
 console.log('PASS Windows UIA screen capture fixture');
}finally{child.kill();await rm(root,{recursive:true,force:true});}
