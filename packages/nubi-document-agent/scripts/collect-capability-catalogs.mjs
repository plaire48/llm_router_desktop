// Development-only inventory. Never opens a document, Office, an auth store or a model.
import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {auditOperationCoverage} from '../eval/capability-coverage.mjs';
if(!process.argv[2])throw Error('source_root_required');
const source=resolve(process.argv[2]),output=resolve(process.argv[3]??'eval/capabilities');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const engine=join(source,'dist/cli/genoffice-engine.cjs'),vendor=join(source,'vendor/genoffice/packages');
const catalogs=[];
for(const domain of ['word','excel']){
  const result=spawnSync(process.execPath,[engine],{input:JSON.stringify({action:'catalog',domain}),encoding:'utf8',maxBuffer:16*1024*1024,timeout:60_000});
  const line=result.stdout?.split('\n').find(x=>x.startsWith('NUBI_ENGINE_RESULT:'));
  if(result.status!==0||!line)throw Error('catalog_collection_failed');
  const response=JSON.parse(line.slice('NUBI_ENGINE_RESULT:'.length));if(!response.ok)throw Error('catalog_collection_failed');
  catalogs.push(response.result.catalog??response.result);
}
// The same OP_DOCS/OP_GROUPS, filter and fingerprint implementation as CLI guide.ts.
// Only the documentation parser is bundled, not an editor or document executor.
const temporary=await mkdtemp(join(tmpdir(),'nubi-catalog-'));
try{
  const entry=`import {OP_DOCS,OP_GROUPS,OP_GUIDES} from ${JSON.stringify(join(vendor,'pptx-ops/src/op-docs.ts'))};
import {withFingerprint} from ${JSON.stringify(join(vendor,'cli/src/op-catalog.ts'))};
const ops=Object.entries(OP_DOCS).filter(([,d])=>d.aiCallable!==false&&!d.pending).map(([op,d])=>({op,group:d.group,signature:d.sig,doc:d.body,examples:d.examples}));
export default withFingerprint({domain:'slides',groups:OP_GROUPS.map(name=>({name,summary:OP_GUIDES[name].summary,ops:ops.filter(e=>e.group===name).map(e=>e.op)})),ops});`;
  const bundle=join(temporary,'slides.mjs');
  await build({stdin:{contents:entry,loader:'ts',resolveDir:source},outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'raw-catalog-guides',setup(b){b.onResolve({filter:/\?raw$/},a=>({path:resolve(a.resolveDir,a.path.slice(0,-4)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}}]});
  catalogs.push((await import(pathToFileURL(bundle).href)).default);
}finally{await rm(temporary,{recursive:true,force:true});}
const manifest=JSON.parse(await readFile(join(source,'vendor/genoffice-source.json'),'utf8'));
const provenance={collectedAt:new Date().toISOString(),upstreamRevision:manifest.commit,wordExcelRetrieval:'existing compiled catalog endpoint; compiled hash recorded separately from source',slidesRetrieval:'upstream documentation parser with CLI catalog projection',files:{}};
for(const path of ['dist/cli/genoffice-engine.cjs','tools-src/genoffice-engine.ts','runtime-src/feature-policy.ts','vendor/genoffice-source.json','vendor/genoffice/packages/cli/src/commands/guide.ts','vendor/genoffice/packages/cli/src/op-catalog.ts','vendor/genoffice/packages/cli/src/formats/docx.ts','vendor/genoffice/packages/cli/src/formats/xlsx-catalog.ts','vendor/genoffice/packages/pptx-ops/src/op-docs.ts',...['text','element','insert','table','slide','deck'].map(n=>`vendor/genoffice/packages/pptx-ops/src/prompts/ops/${n}.md`)]){
  const digest=hash(await readFile(join(source,path)));provenance.files[path]=digest;
  if(path.startsWith('vendor/genoffice/')&&manifest.files[path.slice('vendor/genoffice/'.length)]!==digest)throw Error('upstream_source_changed');
}
const report=auditOperationCoverage(catalogs);report.provenance=provenance;
await mkdir(output,{recursive:true});
for(const catalog of catalogs){const bytes=JSON.stringify(catalog,null,2)+'\n';await writeFile(join(output,`${catalog.domain}.json`),bytes);provenance.files[`${catalog.domain}.json`]=hash(bytes);}
await writeFile(join(output,'coverage.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.domains));
