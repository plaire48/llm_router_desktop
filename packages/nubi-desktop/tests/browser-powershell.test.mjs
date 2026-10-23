import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {samsungInstallation}=createRequire(import.meta.url)('../electron-app/samsung-browser-discovery.cjs');
const metadata={executable:'C:\\Samsung\\Application\\browser.exe',userDataDir:'C:\\Users\\한글 사용자\\Samsung\\User Data'};
const frame=value=>'NUBI_BROWSER_DISCOVERY:'+JSON.stringify(value)+'\r\n';
const progress='#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress"><MS><PR><AV>모듈 준비</AV></PR></MS></Obj></Objs>';
test('browser discovery requests explicit UTF-8 text and accepts one framed result alongside stderr progress',async()=>{
 let launch,calls=0;const result=await samsungInstallation({env:{SystemRoot:'C:\\Windows'},execute:(file,args,options,done)=>{calls++;launch={file,args,options};done(null,'진행 알림\r\n'+frame(metadata),progress);}});
 assert.deepEqual(result,metadata);assert.equal(calls,1);assert.equal(launch.file,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.equal(launch.options.shell,false);assert.equal(launch.options.encoding,'utf8');
 const args=launch.args;assert.equal(args[args.indexOf('-InputFormat')+1],'Text');assert.equal(args[args.indexOf('-OutputFormat')+1],'Text');assert(args.includes('-NonInteractive'));
 const script=Buffer.from(args[args.indexOf('-EncodedCommand')+1],'base64').toString('utf16le');assert.match(script,/\[Console\]::OutputEncoding/);assert.match(script,/NUBI_BROWSER_DISCOVERY:/);assert.match(script,/\$ProgressPreference='SilentlyContinue'/);assert.doesNotMatch(script,/ExecutionPolicy|Set-ItemProperty|Set-Acl|Stop-Process/);
});
test('a real discovery failure keeps its exit status and is never converted to success by stdout or CLIXML',async()=>{
 const original=Object.assign(Error('Command failed\n'+progress),{code:1,stderr:progress});let calls=0;
 await assert.rejects(samsungInstallation({execute:(_file,_args,_options,done)=>{calls++;done(original,frame(metadata),progress);}}),error=>{assert.equal(error.message,'browser_samsung_discovery_failed');assert.equal(error.exitCode,1);assert.equal(error.cause,original);assert.equal(error.actionIssued,false);assert.equal(error.stage,'browser_discovery');return true;});assert.equal(calls,1);
});
test('discovery timeout is distinct from a missing browser and does not replay the subprocess',async()=>{
 let calls=0;const original=Object.assign(Error('killed'),{killed:true,signal:'SIGTERM'});
 await assert.rejects(samsungInstallation({execute:(_file,_args,_options,done)=>{calls++;done(original,'','');}}),error=>error.message==='browser_samsung_discovery_timeout'&&error.cause===original);assert.equal(calls,1);
});
test('an output buffer overflow is a protocol failure rather than a timeout',async()=>{
 const original=Object.assign(Error('buffer exceeded'),{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',killed:true,signal:'SIGTERM'});await assert.rejects(samsungInstallation({execute:(_file,_args,_options,done)=>done(original,'','')}),error=>error.message==='browser_samsung_discovery_protocol'&&error.cause===original);
});
test('serialized, ambiguous or malformed metadata is not promoted into an executable path',async()=>{
 const serialized='#< CLIXML\r\n<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04"><S>'+JSON.stringify(metadata)+'</S></Objs>\r\n';
 for(const stdout of [JSON.stringify(metadata),serialized,frame(metadata)+frame(metadata),frame({executable:'relative.exe',userDataDir:null}),frame({executable:3,userDataDir:null}),'NUBI_BROWSER_DISCOVERY:{broken}\n'])await assert.rejects(samsungInstallation({execute:(_file,_args,_options,done)=>done(null,stdout,'')}),/browser_samsung_discovery_protocol/);
 assert.deepEqual(await samsungInstallation({execute:(_file,_args,_options,done)=>done(null,'\uFEFF'+frame({executable:null,userDataDir:null}),progress)}),{executable:null,userDataDir:null});
});
test('Windows PowerShell executes the actual fixed discovery script without requiring Samsung installation',{skip:process.platform!=='win32'},async()=>{
 const result=await samsungInstallation();for(const key of ['executable','userDataDir'])assert(result[key]===null||typeof result[key]==='string');
});
test('running Samsung discovery accepts only bounded loopback listener metadata from its fixed helper',async()=>{
 const {samsungRunningBrowser}=createRequire(import.meta.url)('../electron-app/samsung-browser-discovery.cjs');
 const value={running:true,userDataDir:null,listeners:[{address:'127.0.0.1',port:9222},{address:'::1',port:9333}]};
 const result=await samsungRunningBrowser({execute:(_file,_args,_options,done)=>done(null,frame(value),progress)});assert.deepEqual(result,value);
 for(const listeners of [[{address:'0.0.0.0',port:9222}],[{address:'evil.test',port:9222}],[{address:'127.0.0.1',port:0}],Array.from({length:9},()=>({address:'127.0.0.1',port:9222}))])await assert.rejects(()=>samsungRunningBrowser({execute:(_file,_args,_options,done)=>done(null,frame({...value,listeners}),'')}),/browser_samsung_discovery_protocol/);
});
test('Windows PowerShell inspects existing Samsung listeners without changing the browser',{skip:process.platform!=='win32'},async()=>{
 const {samsungRunningBrowser}=createRequire(import.meta.url)('../electron-app/samsung-browser-discovery.cjs');
 const value=await samsungRunningBrowser();assert.equal(typeof value.running,'boolean');assert(Array.isArray(value.listeners));
});
test('existing-browser executable selection is literal helper input and cannot be inherited from the parent environment',async()=>{
 const {samsungRunningBrowser}=createRequire(import.meta.url)('../electron-app/samsung-browser-discovery.cjs'),seen=[];
 const execute=(_file,_args,options,done)=>{seen.push(options.env.NUBI_BROWSER_EXECUTABLE);done(null,frame({running:false,userDataDir:null,listeners:[]}),'');};
 const env={NUBI_BROWSER_EXECUTABLE:'C:\\Other\\browser.exe'};await samsungRunningBrowser({env,execute});
 await samsungRunningBrowser({env,execute,executable:'C:\\Selected Samsung\\browser.exe'});assert.deepEqual(seen,['','C:\\Selected Samsung\\browser.exe']);
 await assert.rejects(()=>samsungRunningBrowser({execute,executable:'relative.exe'}),/external_browser_executable_invalid/);assert.equal(seen.length,2);
});
