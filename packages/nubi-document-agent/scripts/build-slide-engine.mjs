import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
if(!process.argv[2]||!process.argv[3])throw Error('source_and_output_required');
const source=resolve(process.argv[2]),output=resolve(process.argv[3]),entry=join(source,'vendor/genoffice/packages/cli/src/formats/pptx.ts');
const contents=`import {readFileSync,writeFileSync} from 'node:fs';
import {openDeck,saveDeck,applyOps,describeDeck} from ${JSON.stringify(entry)};
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{input+=c;if(input.length>200000)process.exit(2)});process.stdin.on('end',async()=>{try{const r=JSON.parse(input),d=await openDeck(new Uint8Array(readFileSync(r.path)));let result;if(r.action==='apply'){result=applyOps(d,r.ops,{isolation:'atomic'});if(!result.applied||result.failures?.length){process.stdout.write('NUBI_ENGINE_RESULT:'+JSON.stringify({ok:false,failures:result.failures})+'\\n');return;}writeFileSync(r.output,await saveDeck(d));}else if(r.action!=='read')throw Error('action');process.stdout.write('NUBI_ENGINE_RESULT:'+JSON.stringify({ok:true,result:r.action==='read'?describeDeck(d,undefined,true,4000):{result,readback:describeDeck(d,undefined,true,4000)}})+'\\n');}catch{process.stdout.write('NUBI_ENGINE_RESULT:{"ok":false}\\n');process.exitCode=1;}});`;
await mkdir(dirname(output),{recursive:true});
const result=await build({stdin:{contents,loader:'ts',resolveDir:source},outfile:output,bundle:true,platform:'node',target:'node22',format:'cjs',metafile:true,external:['jsdom','electron','mermaid'],define:{'import.meta.url':'__engineModuleUrl'},banner:{js:'const __engineModuleUrl=require("node:url").pathToFileURL(__filename).href;'},loader:{'.css':'empty','.md':'text'},plugins:[{name:'raw-guides',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}}]});
const inputs={};for(const path of Object.keys(result.metafile.inputs)){if(path.startsWith('<')||path==='stdin.ts')continue;const absolute=path.startsWith('raw:')?path.slice(4):resolve(path);inputs[absolute]=createHash('sha256').update(await readFile(absolute)).digest('hex');}
await writeFile(output+'.provenance.json',JSON.stringify({upstreamRevision:'438d9c65709952490c970beaa2599ef45e74431f',entry,inputs,outputSha256:createHash('sha256').update(await readFile(output)).digest('hex')},null,2)+'\n');
console.log(JSON.stringify({built:true,inputs:Object.keys(inputs).length}));
