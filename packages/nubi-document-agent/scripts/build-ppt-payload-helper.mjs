// Development-only reuse of the pinned engine's own clipboard/source extractors.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const source=resolve(process.argv[2]),output=resolve(process.argv[3]);
const manifest=JSON.parse(await readFile(join(source,'vendor/genoffice-source.json')));
if(manifest.commit!=='438d9c65709952490c970beaa2599ef45e74431f')throw Error('revision_mismatch');
await mkdir(dirname(output),{recursive:true});
const entry=join(source,'vendor/genoffice/packages/pptx-engine/src/index.ts');
const result=await build({stdin:{contents:`export {openPptx,copySlide,copyElementData,extractMergeSlideSource} from ${JSON.stringify(entry)}`,resolveDir:source,loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',target:'node22',metafile:true,external:['jsdom','electron','mermaid'],loader:{'.css':'empty'}});
const inputs={};for(const file of Object.keys(result.metafile.inputs)){if(file.startsWith('<'))continue;const absolute=resolve(file),bytes=await readFile(absolute),hash=createHash('sha256').update(bytes).digest('hex'),rel=relative(join(source,'vendor/genoffice'),absolute);if(!rel.startsWith('..')&&manifest.files[rel]!==hash)throw Error('upstream_source_mismatch:'+rel);inputs[absolute]=hash;}
await writeFile(output+'.provenance.json',JSON.stringify({upstreamRevision:manifest.commit,inputs,outputSha256:createHash('sha256').update(await readFile(output)).digest('hex')},null,2)+'\n');
