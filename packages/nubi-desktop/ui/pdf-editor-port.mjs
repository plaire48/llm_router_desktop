// A PDF form is a live buffer, never an arbitrary JSON-to-PDF converter.
// IDs, names, pages, field order and all non-target values stay immutable.
export function createPdfEditorPort({binding,endpoint,isCurrent,dirty}) {
 const session=endpoint().session;
 const rows=()=>session.fields.map(f=>({id:f.id,name:f.name,page:f.page,value:session.value(f.id)}));
 const check=signal=>{signal.throwIfAborted();if(!isCurrent()||endpoint()?.session!==session)throw Error('editor_disconnected');};
 const inspect=()=>({binding:{...binding},revision:String(session.revision),text:JSON.stringify(rows(),null,2),selection:{start:0,end:0},readOnly:!!endpoint()?.isBusy(),dirty:dirty()});
 return {
  async inspect(signal){check(signal);return inspect();},
  async replaceIfCurrent(before,patch,signal){
   check(signal);const current=inspect();
   if(current.readOnly||JSON.stringify(current.binding)!==JSON.stringify(before.binding)||current.revision!==before.revision||current.text!==before.text)throw Error('editor_changed');
   if(!Number.isSafeInteger(patch.start)||!Number.isSafeInteger(patch.end)||patch.start<0||patch.end<patch.start||patch.end>current.text.length||typeof patch.newText!=='string'||current.text.slice(patch.start,patch.end)!==patch.oldText)throw Error('editor_patch_invalid');
   let next;try{next=JSON.parse(current.text.slice(0,patch.start)+patch.newText+current.text.slice(patch.end));}catch{throw Error('editor_pdf_fields_invalid');}
   const original=rows();if(!Array.isArray(next)||next.length!==original.length)throw Error('editor_pdf_fields_invalid');
   const changed=[];
   for(let i=0;i<original.length;i++){
    const a=original[i],b=next[i],field=session.fields[i];
    if(!b||Object.keys(b).sort().join()!=='id,name,page,value'||b.id!==a.id||b.name!==a.name||b.page!==a.page||typeof b.value!=='string'||b.value.length>field.maxLength||b.value.includes('\0')||!field.multiline&&/[\r\n]/.test(b.value))throw Error('editor_pdf_fields_invalid');
    if(a.value!==b.value)changed.push(b);
   }
   // One field per approved replacement: one undo and an exact readback projection.
   if(changed.length!==1||JSON.stringify(next,null,2)!==current.text.slice(0,patch.start)+patch.newText+current.text.slice(patch.end))throw Error('editor_pdf_one_field_required');
   session.edit(changed[0].id,changed[0].value);endpoint().changed();
   return {status:'confirmed',receiptId:crypto.randomUUID()};
  }
 };
}
