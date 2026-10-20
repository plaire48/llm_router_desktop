import {readFile,writeFile} from 'node:fs/promises';
import {scoreTransfer} from '../evaluation/transfer-score.mjs';
if(!process.argv[2])throw Error('report_path_required');
const result=scoreTransfer(JSON.parse(await readFile(process.argv[2],'utf8')));
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));if(!result.scored)process.exitCode=1;
