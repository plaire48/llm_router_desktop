// Source-only comparison. Never calls a model, native Office or a saved file.
// Pass a trusted released content-schema.mjs module with its relative imports.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {contentOperation} from '../worker/content-schema.mjs';

if(process.argv.length!==3)throw new Error('Usage: node eval/compare-operation-diagnostics.mjs <released-content-schema.mjs>');
const baselineUrl=pathToFileURL(resolve(process.argv[2]));
const baseline=(await import(baselineUrl.href)).contentOperation;
const casesText=await readFile(new URL('./operation-repair-cases.json',import.meta.url),'utf8');
const cases=JSON.parse(casesText),hash=value=>createHash('sha256').update(value).digest('hex');
const scope={created:true,items:[{id:'p1',kind:'paragraph',editable:true},{id:'s1',kind:'slide',editable:true},
  {id:'cc1',kind:'field',editable:true,controlType:1,mapped:false,locked:false,temporary:false,nested:false}]};
function measure(validate){
  let rejected=0,localized=0,unchanged=0;
  for(const [host,operation,path] of cases){
    const input=structuredClone(operation);
    try{validate(host,input,scope);}catch(error){
      rejected++;
      if(error.toolFailure?.actionIssued===false&&error.toolFailure?.issues?.some(issue=>issue.path===path)&&error.toolFailure.expectedSchema)localized++;
    }
    if(JSON.stringify(input)===JSON.stringify(operation))unchanged++;
  }
  return {cases:cases.length,rejected,localizedWithExpectedSchema:localized,inputUnchanged:unchanged};
}
console.log(JSON.stringify({kind:'source-only-invalid-operation-diagnostics',checkedAt:new Date().toISOString(),
  fixtureSha256:hash(casesText),baselineSourceSha256:hash(await readFile(baselineUrl)),
  currentValidatorSha256:hash(await readFile(new URL('../worker/content-operation-validation.mjs',import.meta.url))),
  baseline:measure(baseline),current:measure(contentOperation),
  limits:['Fixed invalid-input corpus, not a representative accuracy score','No model, COM, Windows installation or NASCA execution','End-to-end repair and approval are tested separately with scripted model/native fixtures']},null,2));
