import {readFile,readdir,mkdir,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const requiredSources=[
 'ui/NativeDocumentPreview.jsx','ui/NativeExcelPreview.jsx','ui/QuestionDecision.jsx',
 'runtime/native-document-preview.mjs','runtime/native-excel-preview.mjs','runtime/native-office-host.mjs',
 'runtime/native-office-draft.mjs','runtime/native-excel-draft.mjs','runtime/native-excel-calculation.mjs',
 'ui/PdfPreview.jsx','ui/PdfFormEditor.jsx','ui/pdf-editor-port.mjs','ui/DocumentPreview.jsx',
 'ui/EditorConnection.jsx','runtime/live-editor-host.mjs','runtime/document-consistency.mjs',
 'ui/DocumentWorkStatus.jsx','runtime/browser-agent-host.mjs','ui/viewTransition.js',
 'ui/native-document-preview.css','ui/native-excel-preview.css'
];
const inputs=JSON.parse(await readFile('generated/source-inputs.json','utf8'));
for(const removed of ['runtime/external-text-editor.mjs','runtime/text-editor-process.mjs'])assert(!inputs.includes(removed),'Retired external PDF connector still bundled: '+removed);
for(const source of requiredSources)assert(inputs.includes(source),'Feature omitted from build: '+source);
const lib=path.resolve('electron-app/lib'),resources=path.resolve('release/windows/win-unpacked/resources');
const requiredFiles=['backend/process-host/Nubi.ProcessHost.exe','backend/process-host/manifest.json','backend/external-office-native/Nubi.OfficeBridge.exe','backend/external-office-native/OfficeX.Core.dll','backend/external-office-native/OfficeX.ExcelHost.dll','backend/external-office-native/Newtonsoft.Json.dll','backend/native-excel-calculator-worker.mjs','backend/office-document.ps1','backend/pdf.worker.mjs','frontend/chunks/pdf.worker.mjs','obsidian-connector/main.js','obsidian-connector/manifest.json','browser-connector/manifest.json','browser-connector/background.js','browser-window-bridge/Nubi.BrowserWindowBridge.exe','licenses/native-excel/index.json'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),files=[];
for(const file of requiredFiles){const data=await readFile(path.join(lib,file));assert(data.length>0,file);files.push({path:file,bytes:data.length,sha256:hash(data)});}
await assert.rejects(access(path.join(lib,'backend/text-editor-bridge')),error=>error.code==='ENOENT','Retired PDF app bridge must not ship');
let packagedFiles=0;const excludedDebugSymbols=[],packageErrors=[];
if(process.argv.includes('--packaged')){
 const asar=createRequire(import.meta.url)('@electron/asar'),archive=path.join(resources,'app.asar');
 async function walk(relative='') {
  for(const entry of await readdir(path.join(lib,relative),{withFileTypes:true})){
   const rel=path.posix.join(relative,entry.name);
   if(entry.isDirectory())await walk(rel);
   else if(entry.isFile()){
    // electron-builder intentionally excludes PDBs unless includePdb is enabled.
    // They are compiler debugging symbols, never required executable resources.
    if(/\.pdb$/i.test(entry.name)){excludedDebugSymbols.push(rel);continue;}
    try{const expected=await readFile(path.join(lib,rel)),actual=asar.extractFile(archive,path.join('lib',rel));assert.equal(hash(actual),hash(expected),'Packaged library mismatch');packagedFiles++;}
    catch(error){packageErrors.push({file:rel,error:error.message});}
   }
  }
 }
 await walk();
 assert.equal(packageErrors.length,0,JSON.stringify({packageErrors,excludedDebugSymbols}));
 for(const directory of ['obsidian-connector','browser-connector','browser-window-bridge']){
  for(const entry of await readdir(path.join(lib,directory),{withFileTypes:true})){if(!entry.isFile())continue;assert.equal(hash(await readFile(path.join(resources,directory,entry.name))),hash(await readFile(path.join(lib,directory,entry.name))),'External connector mismatch: '+directory+'/'+entry.name);}
 }
}
await mkdir('verification',{recursive:true});await writeFile('verification/distribution-capabilities.json',JSON.stringify({version:JSON.parse(await readFile('package.json','utf8')).version,requiredSources,files,externalPdfAppRemoved:true,packagedFiles,excludedDebugSymbols,scope:'Build inclusion and exact packaged bytes; not native Office, login, model or Windows 11 business verification.'},null,2));
console.log(JSON.stringify({sourceFeatures:requiredSources.length,requiredFiles:files.length,packagedFiles}));
