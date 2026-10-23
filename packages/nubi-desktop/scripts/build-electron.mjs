import {copyReleaseTree} from './release-paths.mjs';
import './build-obsidian-connector.mjs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {mkdir,copyFile,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {prepareAppIcon} from './prepare-app-icon.mjs';
import {buildBrowserConnector} from './build-browser-connector.mjs';
// npm tar extraction may strip the macOS PTY helper executable bit.
if(process.platform==='darwin'){const require=createRequire(import.meta.url);const entry=require.resolve('node-pty');await chmod(path.resolve(path.dirname(entry),'../prebuilds',process.platform+'-'+process.arch,'spawn-helper'),0o755);}
const out='electron-app/lib';await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await copyFile(await prepareAppIcon(),out+'/nubi-icon.png');
await buildBrowserConnector(out+'/browser-connector');
await mkdir(out+'/obsidian-connector',{recursive:true});for(const name of ['manifest.json','main.js'])await copyFile('../nubi-document-agent/connectors/obsidian/'+name,out+'/obsidian-connector/'+name);
// A clean Windows package must explicitly build this helper first.
try{await copyReleaseTree('generated/browser-window-bridge',out+'/browser-window-bridge',{recursive:true,filter:file=>!file.endsWith('.pdb')});}catch(error){if(process.platform==='win32')throw error;}

await build({entryPoints:['electron-app/main.cjs'],outfile:out+'/main.cjs',platform:'node',bundle:true,format:'cjs',target:'node24',external:['electron','node-pty'],legalComments:'eof',minify:process.env.NUBI_MINIFY!=='0',keepNames:true});
await build({entryPoints:['electron-app/terminal-worker.cjs'],outfile:out+'/terminal-worker.cjs',platform:'node',bundle:true,format:'cjs',target:'node24',external:['node-pty'],minify:true});
await copyReleaseTree('extension/lib/node',out+'/backend',{recursive:true,filter:file=>!file.endsWith('.js')&&!file.endsWith('.cjs')&&!file.endsWith('.map')&&!file.endsWith('.d.ts')});await copyFile('electron-app/preload.cjs',out+'/preload.cjs');await copyFile('extension/src/node/git-askpass.cjs',out+'/git-askpass.cjs');
await build({...rendererBundleOptions(),outdir:out+'/frontend',minify:true}).then(async result=>{if(Object.keys(result.metafile.inputs).some(p=>p.includes('node_modules/@theia/')))throw Error('theia_in_active_bundle');await writeFile('generated/electron-bundle.json',JSON.stringify(result.metafile,null,2));});
await build({entryPoints:['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],outfile:out+'/frontend/chunks/editor.worker.js',bundle:true,format:'esm',platform:'browser',target:'chrome146',minify:true});
await build({entryPoints:['ui/wiki-layout-worker.mjs'],outfile:out+'/frontend/chunks/wiki-layout-worker.js',bundle:true,format:'esm',platform:'browser',target:'chrome146',minify:true});
const packageVersion=JSON.parse(await readFile('package.json','utf8')).version;
let html=(await readFile('electron-app/index.html','utf8')).replace('<title>누비 Workspace</title>',`<title>누비 Workspace ${packageVersion}</title>`);
for(const asset of ['renderer.js','renderer.css']){
  const hash=createHash('sha256').update(await readFile(out+'/frontend/'+asset)).digest('hex').slice(0,16);
  html=html.replace(`./${asset}`,`./${asset}?v=${hash}`);
}
await writeFile(out+'/frontend/index.html',html);

await copyReleaseTree('../../extensions/aipro-chat/public/icons',out+'/frontend/icons',{recursive:true});
// Desktop branding overlays the shared mascot frames without changing other hosts.
await copyReleaseTree('design/brand/calm-liquid/icons',out+'/frontend/icons',{recursive:true});
await copyReleaseTree('vendor/licenses',out+'/licenses',{recursive:true});

await copyFile('../../extensions/aipro-chat/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',out+'/frontend/chunks/pdf.worker.mjs');
