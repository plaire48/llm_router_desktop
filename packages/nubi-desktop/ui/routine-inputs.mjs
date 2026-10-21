export function routineInputValues(schema={},draft={}){
 const values={};
 for(const [name,field] of Object.entries(schema)){
  if(!['string','number','integer','boolean'].includes(field.type))throw Error('workflow_inputs_invalid');
  const value=draft[name]??field.default;
  if(value===undefined||value===''){if(field.required)throw Error('workflow_inputs_invalid');continue;}
  let parsed=value;
  if(field.type==='boolean'){if(![true,false,'true','false'].includes(value))throw Error('workflow_inputs_invalid');parsed=value===true||value==='true';}
  if(['number','integer'].includes(field.type)){if(typeof value==='boolean'||!String(value).trim())throw Error('workflow_inputs_invalid');parsed=Number(value);if(!Number.isFinite(parsed)||field.type==='integer'&&!Number.isSafeInteger(parsed))throw Error('workflow_inputs_invalid');}
  if(field.type==='string'&&typeof value!=='string'||field.enum&&!field.enum.includes(parsed))throw Error('workflow_inputs_invalid');
  Object.defineProperty(values,name,{value:parsed,enumerable:true,writable:true,configurable:true});
 }
 return values;
}
