import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {browserTasks30} from '../evaluation/browser-30.mjs';
import {mergeBrowserRuns} from '../evaluation/merge-browser-runs.mjs';
const [output,...paths]=process.argv.slice(2);
if(!output||!paths.length)throw Error('Usage: node scripts/merge-browser-runs.mjs OUTPUT.json REPORT.json...');
const sources=[];
for(const path of paths){const bytes=await readFile(path);sources.push({path:resolve(path),sha256:createHash('sha256').update(bytes).digest('hex'),report:JSON.parse(bytes)});}
const report=mergeBrowserRuns(browserTasks30,sources,{technicalRetries:process.env.NUBI_EVAL_TECHNICAL_RETRIES?.split(',').filter(Boolean)||[]});
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(output);
