import {CONTENT_OPERATIONS} from './office-capabilities.mjs';
import {modelJson} from './model-json.mjs';
import {toolArgumentIssues} from '../../../extensions/aipro-chat/tool-validation.js';

// Reuse the shared TypeBox interpreter and redacted JSON Pointer diagnostics.
// Only static schema metadata is returned; raw values/property names are not.
const string=(maxLength,nonblank=false,inline=false)=>({type:'string',maxLength,
  ...(nonblank?{minLength:1,allOf:[{pattern:'\\S'}]}:{}),
  ...(inline?{not:{pattern:'[\\r\\n\\u0000-\\u001f]'}}:nonblank?{not:{pattern:'[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]'}}:{})});
const singleLine=max=>({...string(max,true),not:{pattern:'[\\r\\n\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]'}});
const target=string(100,true),editedText=string(4000,false,true);
const slide={title:singleLine(160),bullets:{type:'array',maxItems:8,items:singleLine(350)},notes:string(4000)};
const fields={
  append_paragraph:{text:singleLine(4000),style:{type:'string',enum:['Normal','Title','Heading1','Heading2','Heading3']}},
  append_table:{rows:{type:'array',minItems:1,maxItems:30,items:{type:'array',minItems:1,maxItems:8,items:string(500,false,true)}}},
  replace_text:{targetId:target,text:editedText},fill_field:{targetId:target,text:editedText},
  add_slide:slide,set_slide_content:{targetId:target,...slide},duplicate_slide:{targetId:target}
};
const objectSchema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
function reject(code,issues,schema){
  throw Object.assign(new Error(code),{toolFailure:{error:code,stage:'operation_schema',tool:'apply_operation',argument:'plan',actionIssued:false,
    issues,expectedSchema:structuredClone(schema),instruction:'The operation was NOT sent to Office. Correct the listed JSON fields inside plan using expectedSchema. Keep the same requested work, observed target and valid content. Schema validity grants no native scope, approval or completion.'}});
}
export function validateContentOperation(host,input){
  const allowed=CONTENT_OPERATIONS[host]||[];
  const discriminator={type:'object',properties:{type:{type:'string',enum:allowed}},required:['type']};
  let operation;
  try{operation=typeof input==='string'?modelJson(input,'document_schema_invalid'):input;}
  catch{reject('document_schema_invalid',[{path:'',rule:'json'}],discriminator);}
  if(!operation||typeof operation!=='object'||Array.isArray(operation))reject('document_schema_invalid',[{path:'',rule:'type'}],discriminator);
  if(!allowed.includes(operation.type))reject('unsupported_operation',[{path:'/type',rule:'enum'}],discriminator);
  const schema=objectSchema({type:{type:'string',const:operation.type},...fields[operation.type]});
  const issues=toolArgumentIssues(schema,operation);
  if(issues)reject('document_schema_invalid',issues,schema);
  if(operation.type==='append_table'){
    const width=operation.rows[0].length,index=operation.rows.findIndex(row=>row.length!==width);
    if(index!==-1)reject('document_schema_invalid',[{path:`/rows/${index}`,rule:'equal_row_width',expected:width}],schema);
  }
  return operation;
}
