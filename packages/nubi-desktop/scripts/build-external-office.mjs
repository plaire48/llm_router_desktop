import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Build time only. Runtime never searches another installation for executable
// code or loads a model-provided DLL path. The host is shipped with provenance.
const root=fileURLToPath(new URL('../',import.meta.url));
const nativeRoot=process.env.NUBI_OFFICE_X_NATIVE||path.join(root,'vendor/office-x-native');
if(!process.env.NUBI_OFFICE_X_NATIVE){const manifest=JSON.parse(await readFile(path.join(nativeRoot,'manifest.json'),'utf8'));for(const name of ['OfficeX.Core.dll','OfficeX.ExcelHost.dll','Newtonsoft.Json.dll']){const actual=createHash('sha256').update(await readFile(path.join(nativeRoot,name))).digest('hex');if(actual!==manifest.files[name])throw Error('office_native_input_hash_mismatch');}}
if(!nativeRoot||!path.isAbsolute(nativeRoot))throw Error('Set NUBI_OFFICE_X_NATIVE to the existing OfficeX Release/net472 directory.');
const dotnet=process.env.NUBI_DOTNET||'dotnet',out=path.join(root,'generated/external-office-native');
const result=spawnSync(dotnet,['build','native/OfficeBridge/OfficeBridge.csproj','-c','Release',`-p:OfficeXNativeDirectory=${nativeRoot}`,'--nologo'],{cwd:root,stdio:'inherit',shell:false});if(result.error)throw result.error;if(result.status!==0)throw Error('native_office_build_failed');
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const files={};await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const name of ['Nubi.OfficeBridge.exe','OfficeX.Core.dll','OfficeX.ExcelHost.dll','Newtonsoft.Json.dll']){
 const source=path.join(name==='Nubi.OfficeBridge.exe'?path.join(root,'native/OfficeBridge/bin/Release/net472'):nativeRoot,name);await copyFile(source,path.join(out,name));files[name]=await hash(source);
}
const sourceFiles={};for(const name of ['Program.cs','OpenDocuments.cs','CheckpointCatalog.cs','OfficeBridge.csproj'])sourceFiles['native/OfficeBridge/'+name]=await hash(path.join(root,'native/OfficeBridge',name));
await writeFile(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,files,sourceFiles,provenance:'Reuses OfficeX.Core OfficeAutomationSession and OfficeX.ExcelHost bound COM port/checkpoint/save. No Office model or WebView runtime started.',windowsRuntimeVerified:false,office2016Verified:false,nascaVerified:false},null,2)+'\n');
// Newtonsoft.Json is the only third-party DLL included by this bridge. The
// document-agent bundle retains its own existing open-source notices.
await writeFile(path.join(out,'THIRD-PARTY-NOTICES.txt'),'Newtonsoft.Json 13.0.3, MIT\nCopyright (c) 2007 James Newton-King\nhttps://github.com/JamesNK/Newtonsoft.Json/blob/13.0.3/LICENSE.md\n\n'+await readFile(path.join(root,'native/OfficeBridge/Newtonsoft-LICENSE.txt'),'utf8'));
console.log('Built external-office-native; Windows COM execution is not verified.');
