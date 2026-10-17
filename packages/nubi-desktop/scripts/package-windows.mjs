import {spawn} from 'node:child_process';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
const require=createRequire(import.meta.url);
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 build host required');
if(DESKTOP_FEATURES.computerUse)throw Error('windows_driver_packaging_requires_review');
const run=(file,args,cwd=process.cwd())=>new Promise((resolve,reject)=>{const p=spawn(file,args,{cwd,stdio:'inherit',shell:false});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error('build_exit_'+c)));});
await run(process.execPath,['scripts/check-office-reader.mjs']);
await run(process.execPath,['scripts/prepare-bundled-git.mjs']);
await run(process.execPath,['scripts/build-external-office.mjs']);
await run(process.execPath,['scripts/build-process-host.mjs']);
await run(process.execPath,['scripts/build-runtime.mjs']);
await run(process.execPath,['scripts/build-browser-window-bridge.mjs']);
await run(process.execPath,['scripts/build-electron.mjs']);
// Exercise the compiled editor before the expensive installer compression.
await run(process.execPath,['scripts/check-electron-pdf-chat.mjs']);
await run(process.execPath,['scripts/check-command-terminal.mjs']);
await run(process.execPath,['scripts/prepare-installer-ui.mjs']);
await run(process.execPath,['scripts/prepare-installer-brand.mjs']);
// build-electron prepares the approved bird master for both the window and NSIS.
await run(process.execPath,[require.resolve('electron-builder/cli.js'),'--projectDir','electron-app','--win','--x64','--publish','never']);

// fs.cp needs physical OpenWiki skill directories; never ship only ASAR entries.
const bundledSkills=path.resolve('../openwiki/skills');
const installedSkills=path.resolve('release/windows/win-unpacked/resources/app.asar.unpacked/lib/backend/openwiki-update/openwiki/skills');
const checkedSkills=[];
for(const entry of await readdir(bundledSkills,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const rel=path.join(entry.name,'SKILL.md'),expected=await readFile(path.join(bundledSkills,rel)),actual=await readFile(path.join(installedSkills,rel));
  if(!expected.equals(actual))throw Error('wiki_skill_package_mismatch');
  checkedSkills.push({name:entry.name,sha256:createHash('sha256').update(actual).digest('hex')});
}
if(!checkedSkills.length)throw Error('wiki_skill_package_missing');
await mkdir('verification',{recursive:true});
await writeFile('verification/windows-wiki-assets.json',JSON.stringify({scope:'Windows installer packaging integrity, not live Wiki generation',unpacked:true,skills:checkedSkills},null,2));
console.log('Physical OpenWiki preparation assets packaged:',checkedSkills.length);
