import {listPackage} from '@electron/asar';
import {readdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.argv[2],archive=path.join(root,'resources/app.asar');
const files=listPackage(archive).map(file=>file.replaceAll('\\','/'));
// Attachment reading is on since 1.2.1 (user decision 2026-10-14): its readers must ship; while it was off they had to be absent.
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
const attachmentFiles=['document-extract.mjs','mail-attachment-worker.mjs','pdf.worker.mjs','office-document.ps1'];
for(const file of attachmentFiles){const present=files.some(item=>item.endsWith('/'+file));if(DESKTOP_FEATURES.mailAttachmentReading&&!present)throw Error('attachment_reader_missing:'+file);if(!DESKTOP_FEATURES.mailAttachmentReading&&present)throw Error('deferred_attachment_packaged:'+file);}
let count=0,bytes=0;async function walk(directory){for(const item of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await walk(file);else{count++;bytes+=(await stat(file)).size;}}}await walk(root);
if(!files.some(file=>file.endsWith('/ripgrep-win32-x64/bin/rg.exe')))throw Error('native_search_missing');
await stat(path.join(root,'resources/app.asar.unpacked/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe'));
await stat(path.join(root,'resources/git/cmd/git.exe'));await stat(path.join(root,'resources/git/LICENSE.txt'));
await writeFile('verification/windows-package.json',JSON.stringify({asar:true,bundledGit:true,archiveEntries:files.length,physicalFiles:count,bytes,attachmentReaders:DESKTOP_FEATURES.mailAttachmentReading?'packaged':'absent',nativeSearchUnpacked:true},null,2));
