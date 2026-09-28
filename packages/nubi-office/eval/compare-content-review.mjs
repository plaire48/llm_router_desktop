// Uses a trusted, locally extracted version of our own released module only.
// This measures source coverage and payload size, never model accuracy.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {contentReviewBatches} from '../worker/content-context.mjs';
if(process.argv.length!==3)throw new Error('Usage: node eval/compare-content-review.mjs <trusted-released-content-context.mjs>');
const baselineUrl=pathToFileURL(resolve(process.argv[2])),baseline=await import(baselineUrl.href);
const items=Array.from({length:200},(_,i)=>({id:`p-${i}`,kind:'paragraph',text:`보고 항목 ${i}: `+'실제 본문 '.repeat(200),editable:false}));
const pages=new Map(Array.from({length:5},(_,i)=>{const offset=i*40;return[offset,{host:'word',scopeId:'source',documentId:'document',fingerprint:'fixture-1',offset,total:200,nextOffset:offset<160?offset+40:null,items:items.slice(offset,offset+40)}];}));
let oldResult;
try{baseline.contentEvidence(pages,true);oldResult={accepted:true};}catch(error){oldResult={accepted:false,error:error.message};}
const batches=contentReviewBatches(pages,true),reconstructed=batches.flatMap(batch=>batch.items.flatMap(entry=>entry.value.items));
const hash=value=>createHash('sha256').update(value).digest('hex');
console.log(JSON.stringify({kind:'source-only-review-partition-coverage',checkedAt:new Date().toISOString(),
  fixtureSha256:hash(JSON.stringify([...pages])),baselineSourceSha256:hash(await readFile(baselineUrl)),
  currentSourceSha256:hash(await readFile(new URL('../worker/content-context.mjs',import.meta.url))),
  input:{items:items.length,serializedPagesChars:JSON.stringify([...pages.values()]).length},baseline:oldResult,
  current:{partitions:batches.length,coveredItems:reconstructed.length,exactItemReconstruction:JSON.stringify(reconstructed)===JSON.stringify(items),maxPartitionEvidenceChars:Math.max(...batches.map(batch=>JSON.stringify(batch.items).length))},
  limits:['Deterministic source fixture, no model calls or quality score','Partition evidence size excludes instructions and task context; the existing whole-request budget still applies','Windows Office 2016, Qwen and NASCA were not executed']},null,2));
