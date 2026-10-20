import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createWordDocument,inspectGeneratedWord} from '../dist/word.js';
import {evaluateWordCreate01} from '../eval/word-create-oracle.mjs';

const output=resolve(process.argv[2]??'artifacts/word-create-01');
const draft=JSON.parse(await readFile(new URL('../eval/WD-CREATE-01.reference-draft.json',import.meta.url),'utf8'));
const fontFamily=process.platform==='darwin'?'Apple SD Gothic Neo':'Malgun Gothic';
const result=await createWordDocument(draft,new AbortController().signal,{fontFamily}),inspection=await inspectGeneratedWord(result.bytes),evaluation=await evaluateWordCreate01(result.bytes);
if(!evaluation.passed)throw Error('word_example_requirements_failed');
await mkdir(output,{recursive:true});
await writeFile(join(output,'word-report.docx'),result.bytes,{flag:'wx'});
const report={source:'deterministic_reference_draft',modelMeasured:false,engine:result.engine,fontFamily,sha256:createHash('sha256').update(result.bytes).digest('hex'),paragraphs:inspection.paragraphs.length,tables:inspection.tables.length,evaluation};
await writeFile(join(output,'generation.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({output,passed:evaluation.passed,modelMeasured:false})+'\n');
