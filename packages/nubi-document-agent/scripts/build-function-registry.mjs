import {readFile,writeFile}from'node:fs/promises';
const root=new URL('../',import.meta.url),official=JSON.parse(await readFile(new URL('eval/capabilities/official-excel-functions.json',root))),previous=JSON.parse(await readFile(new URL('src/excel-function-registry.json',root)));
const output={source:official.source,office2016Candidates:official.functions.filter(x=>x.office2016Candidate).map(x=>x.name),introducedAfter2016:official.functions.filter(x=>!x.office2016Candidate).map(x=>x.name),requiresHostCapabilities:previous.requiresHostCapabilities};
await writeFile(new URL('src/excel-function-registry.json',root),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({candidates:output.office2016Candidates.length,later:output.introducedAfter2016.length}));
