import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import './check-identity.mjs';
// Both standalone Wiki tests and the packaged host resolve the same locked
// framework copies. NODE_PATH alone would prefer an optional OpenWiki install.
const sharedRoot=path.resolve('../../extensions/aipro-chat');
const sharedLock=JSON.parse(await readFile(path.join(sharedRoot,'package-lock.json'),'utf8'));
const frameworkPattern=/^(?:deepagents|langchain|langsmith|zod|@langchain\/[^/]+)(?:\/|$)/;
const researchDependencies=[];
for(const [location,locked] of Object.entries(sharedLock.packages)){
  const name=location.replace(/^node_modules\//,'');
  if(location!==`node_modules/${name}`||!frameworkPattern.test(name)||name.replace(/^@[^/]+\//,'').includes('/'))continue;
  const installed=JSON.parse(await readFile(path.join(sharedRoot,location,'package.json'),'utf8'));
  if(installed.version!==locked.version)throw Error(`research_dependency_lock_mismatch:${name}`);
  researchDependencies.push({name,version:installed.version,license:installed.license});
}
const pinnedFramework={name:'nubi-pinned-research-framework',setup(builder){
  builder.onResolve({filter:frameworkPattern},async args=>{
    if(args.pluginData?.nubiPinnedFramework)return;
    const resolved=await builder.resolve(args.path,{resolveDir:sharedRoot,kind:args.kind,pluginData:{nubiPinnedFramework:true}});
    if(!resolved.errors.length&&!path.resolve(resolved.path).startsWith(path.join(sharedRoot,'node_modules')+path.sep))throw Error('research_dependency_scope');
    return resolved;
  });
}};
const assertFrameworkSources=metafile=>{
  for(const input of Object.keys(metafile.inputs)){
    const normalized=input.replaceAll('\\','/'),marker=normalized.lastIndexOf('/node_modules/');
    if(marker<0)continue;
    const bare=normalized.slice(marker+'/node_modules/'.length);
    if(frameworkPattern.test(bare)&&!path.resolve(input).startsWith(path.join(sharedRoot,'node_modules')+path.sep))throw Error('research_dependency_duplicate');
  }
};
const wikiBuild=await build({metafile:true,plugins:[pinnedFramework],entryPoints:['runtime/openwiki-source.ts'],outfile:'generated/openwiki.mjs',bundle:true,platform:'node',nodePaths:[path.resolve('node_modules')],format:'esm',target:'node24',external:['minisearch','yaml'],banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},legalComments:'eof'});
assertFrameworkSources(wikiBuild.metafile);
const wikiPackage=JSON.parse(await readFile('../openwiki/package.json','utf8'));
if(wikiPackage.name!=='openwiki-sds')throw Error('openwiki_sds_source_required');
const wikiSources=Object.keys(wikiBuild.metafile.inputs).filter(p=>!p.includes('node_modules')&&p.replaceAll('\\','/').startsWith('../openwiki/')).sort();
if(!wikiSources.length)throw Error('openwiki_sds_source_missing');
const wikiHash=createHash('sha256');for(const file of wikiSources){wikiHash.update(file.replaceAll('\\','/'));wikiHash.update(await readFile(file));}
await writeFile('generated/runtime-provenance.json',JSON.stringify({openwiki:{name:wikiPackage.name,version:wikiPackage.version,sourceSha256:wikiHash.digest('hex'),sourceFiles:wikiSources.length,scope:'Bundled retrieval, Claims, read-only document research, repository evidence and pairing. Not the full CLI.'},documentResearch:{dependencyLock:'extensions/aipro-chat/package-lock.json',dependencies:researchDependencies}},null,2)+'\n');
await mkdir('extension/lib/node',{recursive:true});
await copyFile('runtime/computer-pointer.ps1','extension/lib/node/computer-pointer.ps1');
for (const worker of ['schema-worker','database-worker','code-analysis-worker']) await build({entryPoints:[`runtime/${worker}.mjs`],outfile:`extension/lib/node/${worker}.mjs`,bundle:true,platform:'node',format:'esm',target:'node24',external:['knex','knex-schema-inspector','typescript','jsonc-parser'],banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
const sourceWiki={name:'nubi-source-wiki',setup(builder){builder.onResolve({filter:/openwiki\.mjs$/},args=>path.resolve(args.resolveDir,args.path)===path.resolve('generated/openwiki.mjs')?{path:path.resolve('runtime/openwiki-source.ts')}:undefined);}};
const runtimeBuild=await build({metafile:true,plugins:[pinnedFramework,sourceWiki],entryPoints:['runtime/service-entry.mjs'],outfile:'extension/lib/node/service-entry.mjs',bundle:true,platform:'node',nodePaths:[path.resolve('node_modules')],format:'esm',target:'node24',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},external:['jsonc-parser','@vscode/ripgrep','knex','knex-schema-inspector','@earendil-works/pi-agent-core','@earendil-works/pi-ai','playwright','pixelmatch','pngjs','minisearch'],legalComments:'eof'});
assertFrameworkSources(runtimeBuild.metafile);
if(Object.keys(runtimeBuild.metafile.inputs).some(file=>path.resolve(file)===path.resolve('generated/openwiki.mjs')))throw Error('research_prebundle_duplicate');
if(!Object.keys(runtimeBuild.metafile.inputs).some(file=>file.replaceAll('\\','/').endsWith('/openwiki/src/agent/wiki-question.ts')))throw Error('research_core_missing');
const uiBuild=await build({metafile:true,entryPoints:['ui/Workbench.jsx'],outfile:'extension/lib/browser/workbench.js',bundle:true,platform:'browser',nodePaths:[path.resolve('node_modules')],format:'cjs',target:'chrome110',external:['react','react-dom','react-dom/client','react/jsx-runtime'],alias:{'@e2e/cx-design-system':path.resolve('node_modules/@e2e/cx-design-system')},define:{__APP_VERSION__:JSON.stringify(JSON.parse(await readFile('package.json','utf8')).version)},legalComments:'eof'});
await mkdir('extension/lib/browser/style',{recursive:true});
await writeFile('extension/lib/browser/style/style.css',(await readFile('extension/src/browser/style.css','utf8'))+'\n'+await readFile('design/workspace-identity.css','utf8'));
await copyFile('../../extensions/aipro-chat/design/agent-deck.css','extension/lib/browser/style/agent-deck.css');
// Reuse the complete shared Nubi cascade, including mascot frames and motion.
const shared=await Promise.all(['app','surfaces','code','interaction-forms','approval','deck-surfaces'].map(name=>readFile('../../extensions/aipro-chat/src/'+name+'.css','utf8')));
await writeFile('extension/lib/browser/style/nubi-shared.css',shared.join('\n'));

for(const bundle of [runtimeBuild,uiBuild]){if(Object.keys(bundle.metafile.inputs).some(file=>/nubi-a2a\/(?!contract\.mjs)|@a2a-js\/sdk|runtime\/collaboration\.mjs|ui\/Collaboration\.jsx/.test(file.replaceAll('\\','/'))))throw Error('a2a_must_remain_deferred');}
// Release snapshots copy the actual shared source dependency closure rather
// than silently taking unrelated in-progress Office/browser changes.
await writeFile('generated/source-inputs.json',JSON.stringify([...new Set([wikiBuild,runtimeBuild,uiBuild].flatMap(bundle=>Object.keys(bundle.metafile.inputs)).filter(file=>!file.includes('node_modules')))].sort(),null,2)+'\n');
