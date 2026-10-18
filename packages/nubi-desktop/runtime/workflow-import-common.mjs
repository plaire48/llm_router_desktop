// Import identifiers are data, not executable expressions or prototype members.
const forbidden=new Set(['__proto__','constructor','prototype']);
export const importFail=code=>{throw Error(code);};
export const importRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function importField(name){if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)||forbidden.has(name))importFail('workflow_import_reference');return name;}
export function normalizeImportIds(nodes){
 const ids=new Map(),used=new Set();for(const [index,node] of nodes.entries()){
  if(!importRecord(node)||typeof node.id!=='string'||!node.id||ids.has(node.id))importFail('workflow_import_invalid');
  let base=node.id.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');if(!/^[a-z]/.test(base)||forbidden.has(base))base='step-'+(base||index+1);base=base.slice(0,32);
  let id=base,n=1;while(used.has(id))id=base+'-'+(++n);used.add(id);ids.set(node.id,id);
 }return ids;
}
