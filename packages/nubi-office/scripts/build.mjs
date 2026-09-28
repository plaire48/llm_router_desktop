import {build} from 'esbuild';
import {mkdir, readFile, writeFile, cp, rm, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, relative} from 'node:path';
import {createHash} from 'node:crypto';
const root = new URL('../', import.meta.url), at = name => new URL(name, root);
process.chdir(fileURLToPath(root));
await mkdir(at('dist/web'), {recursive:true}); await mkdir(at('dist/worker'), {recursive:true});
const pkg = JSON.parse(await readFile(at('package.json'),'utf8'));
const aliases = Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,fileURLToPath(at(`node_modules/${name}`))]));
const uiBuild = await build({entryPoints:['src/main.jsx'],bundle:true,format:'esm',platform:'browser',target:'chrome110',outfile:'dist/web/app.js',legalComments:'eof',minify:true,metafile:true,alias:aliases,define:{'process.env.NODE_ENV':'"production"',__APP_VERSION__:JSON.stringify(pkg.version)}});
await build({entryPoints:['worker/main.mjs'],bundle:true,format:'esm',platform:'node',target:'node22',outfile:'dist/worker/main.mjs',external:['@earendil-works/pi-agent-core','@earendil-works/pi-ai','@earendil-works/pi-coding-agent','exceljs','proper-lockfile'],legalComments:'eof'});
const scriptPackages=['quickjs-emscripten-core','@jitl/quickjs-wasmfile-release-sync'];
const scriptEvalDependencies={name:'script-evaluation-dependencies',setup(builder){builder.onResolve({filter:/^(quickjs-emscripten-core|@jitl\/quickjs-wasmfile-release-sync)$/},({path})=>({path:`../dist/node_modules/${path}/dist/index.mjs`,external:true}));}};
for(const output of ['dist/worker/script-thread.mjs','eval/script-thread.mjs'])await build({entryPoints:['worker/script-thread.mjs'],bundle:true,format:'esm',platform:'node',target:'node22',outfile:output,external:output.startsWith('eval/')?[]:scriptPackages,plugins:output.startsWith('eval/')?[scriptEvalDependencies]:[],legalComments:'eof'});
for(const target of ['dist/worker/skills','eval/skills'])await cp(at('worker/skills'),at(target),{recursive:true});
// Evaluation tools in the review ZIP must not import the parent repository.
const evalDependencies = {name:'bundled-evaluation-dependencies',setup(builder){builder.onResolve({filter:/^proper-lockfile$/},()=>({path:'../dist/node_modules/proper-lockfile/index.js',external:true}));builder.onResolve({filter:/^exceljs$/},()=>({path:'../dist/node_modules/exceljs/excel.js',external:true}));builder.onResolve({filter:/^@earendil-works\//},({path})=>{
  const [,name,...rest]=path.split('/');return{path:`../dist/node_modules/@earendil-works/${name}/dist/${rest.length?rest.join('/'):'index'}.js`,external:true};
});}};
for(const [input,output] of [['eval/run.mjs','eval/run-bundled.mjs'],['eval/promptfoo-provider.mjs','eval/promptfoo-provider-bundled.mjs']]) await build({entryPoints:[input],bundle:true,format:'esm',platform:'node',target:'node22',outfile:output,plugins:[evalDependencies],legalComments:'eof'});
const nubi = new URL('../../extensions/aipro-chat/',root), cx = new URL('node_modules/@e2e/cx-design-system/',nubi);
await cp(new URL('dist/styles.css',cx),at('dist/web/cx.css')); await cp(new URL('dist/fonts',cx),at('dist/web/fonts'),{recursive:true});
// Keep the complete Nubi cascade in source order. No sliced theme or legacy skin.
const styles = await Promise.all(['design/agent-deck.css','src/app.css','src/surfaces.css','src/code.css','src/interaction-forms.css','src/approval.css','src/deck-surfaces.css'].map(name=>readFile(new URL(name,nubi),'utf8')));
await writeFile(at('dist/web/app.css'),styles.join('\n')+'\n'+await readFile(at('src/office.css'),'utf8'));
await cp(at('src/taskpane.html'),at('dist/web/taskpane.html'));
await rm(at('dist/web/icons'),{recursive:true,force:true});
await cp(new URL('public/icons',nubi),at('dist/web/icons'),{recursive:true});
await cp(at('../nubi-a2a/licenses'),at('dist/licenses/a2a'),{recursive:true});
await cp(at('licenses'),at('dist/licenses'),{recursive:true}); await cp(at('../office-legacy-aipro/licenses/noto-sans-kr-OFL.txt'),at('dist/licenses/noto-sans-kr-OFL.txt'));
await cp(at('vendor/office-ai-agent/LICENSE'),at('dist/licenses/office-ai-agent-Apache-2.0.txt'));
// Preserve licenses for the packages actually included in the frontend bundle.
const packageRoots = new Set();
for (const input of Object.keys(uiBuild.metafile.inputs).filter(name=>name.includes('node_modules/'))) {
  let dir = dirname(resolve(input));
  while (dir !== dirname(dir)) {
    try {const metadata=JSON.parse(await readFile(resolve(dir,'package.json'),'utf8'));if(metadata.name) {packageRoots.add(dir);break;}} catch {}
    dir=dirname(dir);
  }
}
for (const dir of packageRoots) {
  const metadata=JSON.parse(await readFile(resolve(dir,'package.json'),'utf8'));
  const target=at(`dist/licenses/ui/${metadata.name.replaceAll('/','_')}`);await mkdir(target,{recursive:true});
  for(const name of await readdir(dir)) if (/^(licen[sc]e|copying|notice)(\.|$)/i.test(name)) await cp(resolve(dir,name),new URL(name,target.href+'/'),{recursive:true});
}
const sharedInputs=Object.keys(uiBuild.metafile.inputs).filter(name=>name.startsWith('../../extensions/aipro-chat/src/') && !name.includes('node_modules'));
const sources=[...new Set([...sharedInputs,...['design/agent-deck.css','src/app.css','src/surfaces.css','src/code.css','src/interaction-forms.css','src/approval.css','src/deck-surfaces.css'].map(name=>fileURLToPath(new URL(name,nubi)))])];
await mkdir(at('verification'),{recursive:true});
await writeFile(at('verification/ui-reuse.json'),JSON.stringify({version:pkg.version,sharedSources:await Promise.all(sources.map(async name=>({path:relative(resolve('../..'),resolve(name)),sha256:createHash('sha256').update(await readFile(name)).digest('hex')}))),fullStyleCascade:true,reactVersion:JSON.parse(await readFile(at('node_modules/react/package.json'),'utf8')).version},null,2)+'\n');
await writeFile(at('dist/package.json'),JSON.stringify(pkg,null,2)+'\n');
await cp(at('package-lock.json'),at('dist/package-lock.json'));
console.log('Built Nubi Office WebView2 UI and shared-provider worker. Windows host installation is a separate check.');
