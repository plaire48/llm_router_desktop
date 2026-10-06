import {build} from 'esbuild';
import {mkdir,cp,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const out='electron-app/lib';await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await build({entryPoints:['electron-app/main.cjs'],outfile:out+'/main.cjs',platform:'node',bundle:true,format:'cjs',target:'node24',external:['electron'],legalComments:'eof'});
await cp('extension/lib/node',out+'/backend',{recursive:true,filter:file=>!file.endsWith('.js')&&!file.endsWith('.cjs')&&!file.endsWith('.map')&&!file.endsWith('.d.ts')});await copyFile('electron-app/preload.cjs',out+'/preload.cjs');await copyFile('extension/src/node/git-askpass.cjs',out+'/git-askpass.cjs');
await build({entryPoints:['electron-app/renderer.jsx'],outdir:out+'/frontend',entryNames:'renderer',chunkNames:'chunks/[name]-[hash]',bundle:true,splitting:true,format:'esm',platform:'browser',target:'chrome146',minify:true,nodePaths:[path.resolve('node_modules')],loader:{'.png':'dataurl','.woff2':'file','.woff':'file','.ttf':'file','.svg':'dataurl','.gif':'dataurl'},alias:{'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css'),'react':path.resolve('node_modules/react'),'react-dom':path.resolve('node_modules/react-dom'),'@e2e/cx-design-system':path.resolve('node_modules/@e2e/cx-design-system')},define:{'process.env.NODE_ENV':'"production"',__APP_VERSION__:'"Beta"'},legalComments:'eof',metafile:true}).then(async result=>{if(Object.keys(result.metafile.inputs).some(p=>p.includes('node_modules/@theia/')))throw Error('theia_in_active_bundle');await writeFile('generated/electron-bundle.json',JSON.stringify(result.metafile,null,2));});
await build({entryPoints:['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],outfile:out+'/frontend/chunks/editor.worker.js',bundle:true,format:'esm',platform:'browser',target:'chrome146',minify:true});
let html=await readFile('electron-app/index.html','utf8');
for(const asset of ['renderer.js','renderer.css']){
  const hash=createHash('sha256').update(await readFile(out+'/frontend/'+asset)).digest('hex').slice(0,16);
  html=html.replace(`./${asset}`,`./${asset}?v=${hash}`);
}
await writeFile(out+'/frontend/index.html',html);

await cp('../../extensions/aipro-chat/public/icons',out+'/frontend/icons',{recursive:true});
await cp('vendor/licenses',out+'/licenses',{recursive:true});
