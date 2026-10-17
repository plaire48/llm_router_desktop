// PDF.js owns parsing and incremental serialization. No PDF JavaScript is run.
// Only ordinary text fields are editable; scripts, signatures and XFA fail closed.
export async function createPdfFormSession(doc,{reopen}){
 const [objects,permissions]=await Promise.all([doc.getFieldObjects(),doc.getPermissions()]);
 if(doc.isPureXfa||permissions&&!permissions.includes(256)&&!permissions.includes(32))return {fields:[],reason:'protected'};
 const rows=objects instanceof Map?[...objects]:Object.entries(objects||{});if(rows.length>200)return {fields:[],reason:'limit'};
 if(rows.some(([,widgets])=>widgets.some(w=>w.type==='signature')))return {fields:[],reason:'signature'};
 const fields=rows.flatMap(([name,widgets])=>{
  if(!name||name.length>240||!widgets.length||widgets.some(w=>w.type!=='text'||w.editable!==true||w.readonly||w.password||w.hidden||w.actions&&Object.keys(w.actions).length||w.page<0||typeof w.value!=='string'||w.value.length>12000))return [];
  if(new Set(widgets.map(w=>w.value)).size!==1||widgets.some(w=>typeof w.id!=='string'))return [];
  const maxLength=Math.min(12000,...widgets.map(w=>Number.isSafeInteger(w.charLimit)&&w.charLimit>0?w.charLimit:12000));
  return [{id:widgets[0].id,name,page:widgets[0].page+1,value:widgets[0].value,maxLength,multiline:!!widgets[0].multiline,widgets:widgets.map(w=>w.id)}];
 });
 const values=new Map(fields.map(f=>[f.id,f.value])),history=[];let revision=0,closed=false;
 const active=()=>{if(closed)throw Error('pdf_form_closed');};
 const dirty=()=>fields.some(f=>values.get(f.id)!==f.value);
 return {fields,get revision(){return revision;},reason:fields.length?'ready':'no_fields',dirty,
  value(id){active();if(!values.has(id))throw Error('pdf_field_missing');return values.get(id);},
  edit(id,value){active();const f=fields.find(f=>f.id===id);if(!f||typeof value!=='string'||value.length>f.maxLength||value.includes('\0')||!f.multiline&&/[\r\n]/.test(value))throw Error('pdf_field_invalid');if(value===values.get(id))return;history.push([id,values.get(id)]);if(history.length>100)history.shift();values.set(id,value);for(const key of f.widgets)doc.annotationStorage.setValue(key,{value});revision++;},
  undo(){active();const last=history.pop();if(!last)return false;const [id,value]=last;values.set(id,value);for(const key of fields.find(f=>f.id===id).widgets)doc.annotationStorage.setValue(key,{value});revision++;return true;},
  canUndo:()=>history.length>0,
  async export(){active();const version=revision,expected=new Map(values),bytes=await doc.saveDocument();active();if(version!==revision)throw Error('pdf_form_changed');
   const copy=await reopen(bytes.slice());try{const raw=await copy.getFieldObjects(),actual=raw instanceof Map?raw:new Map(Object.entries(raw||{}));if(copy.numPages!==doc.numPages||JSON.stringify([...actual.keys()].sort())!==JSON.stringify(rows.map(([name])=>name).sort()))throw Error('pdf_form_verification_failed');
    for(const [name,widgets] of rows){const next=actual.get(name);if(!next||next.length!==widgets.length)throw Error('pdf_form_verification_failed');const field=fields.find(f=>f.name===name),value=field?expected.get(field.id):null;for(let i=0;i<widgets.length;i++)if(JSON.stringify(next[i].value)!==JSON.stringify(field?value:widgets[i].value)||next[i].type!==widgets[i].type)throw Error('pdf_form_verification_failed');}
   }finally{await copy.loadingTask.destroy();}active();if(version!==revision)throw Error('pdf_form_changed');return {bytes,verified:true,revision:version};
  },close(){closed=true;history.length=0;values.clear();}
 };
}
