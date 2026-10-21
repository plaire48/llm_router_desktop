// Prints the fidelity checklist for the file engine on the kitchen-sink fixtures (or a capture JSON from the Office host).
// Usage: node eval/office-fidelity/report.mjs [capture.json ...]
import {readFile} from 'node:fs/promises';
import {gradeCapture} from './features.mjs';
const files=process.argv.slice(2);
const captures=files.length?await Promise.all(files.map(async f=>JSON.parse(await readFile(f,'utf8')))):await (async()=>{
  const {captureOfficeFile}=await import('../../runtime/office-file-capture.mjs');
  return Promise.all(['docx','xlsx','pptx'].map(async ext=>captureOfficeFile(await readFile(new URL(`../../tests/fixtures/office-fidelity/synthetic-kitchen-sink.${ext}`,import.meta.url)),{name:`synthetic-kitchen-sink.${ext}`})));
})();
for(const capture of captures){const result=gradeCapture(capture);console.log(`${result.app} (${result.engine}): ${result.captured}/${result.total}`);for(const row of result.rows)if(!row.ok)console.log(`  - 빠짐 ${row.id}: ${row.label}`);}
