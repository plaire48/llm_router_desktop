import { readFile, readdir, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';

const root=new URL('../',import.meta.url), at=name=>new URL(name,root), stage=at('dist/windows-package/');
await rm(stage,{recursive:true,force:true});
await mkdir(stage,{recursive:true});
const source=JSON.parse(await readFile(at('package.json'),'utf8'));
const manifest={name:source.name,version:source.version,private:true,engines:source.engines,scripts:{start:source.scripts.start,stop:source.scripts.stop,'dev-server':source.scripts['dev-server']},dependencies:{...source.dependencies,'office-addin-debugging':source.devDependencies['office-addin-debugging']}};
await writeFile(new URL('package.json',stage),JSON.stringify(manifest,null,2)+'\n');
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],{cwd:fileURLToPath(stage),stdio:'inherit',shell:process.platform==='win32'});
for(const name of ['manifest.xml','README.md','Start-Excel-AIPro.cmd','Stop-Excel-AIPro.cmd']) await cp(at(name),new URL(name,stage));
await mkdir(new URL('dist',stage),{recursive:true});
await cp(at('dist/server.mjs'),new URL('dist/server.mjs',stage)); await cp(at('dist/web'),new URL('dist/web',stage),{recursive:true});
await cp(at('verification'),new URL('verification',stage),{recursive:true});
const files={};
async function add(folder,prefix='') {for(const entry of await readdir(folder,{withFileTypes:true})) { const path=new URL(entry.name+(entry.isDirectory()?'/':''),folder); if(entry.isDirectory()) await add(path,prefix+entry.name+'/'); else files[prefix+entry.name]=new Uint8Array(await readFile(path)); }}
await add(stage); const archive=zipSync(files,{level:6}), unpacked=unzipSync(archive);
for(const required of ['manifest.xml','package-lock.json','dist/server.mjs','dist/web/app.js','Start-Excel-AIPro.cmd']) if(!unpacked[required]) throw new Error(`Missing ${required}`);
if(Object.keys(unpacked).some(name=>/node_modules|\.env|auth\.json/.test(name))) throw new Error('Unexpected private or dependency file in archive.');
await mkdir(at('releases'),{recursive:true}); const destination=at(`releases/nubi-excel-2016-windows-${source.version}.zip`); await writeFile(destination,archive);
console.log(`Created ${fileURLToPath(destination)} (${archive.length} bytes). Windows installation and live AI Pro remain unverified.`);
