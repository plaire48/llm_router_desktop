import test from 'node:test';import assert from 'node:assert/strict';
import * as pdfjs from '../../../extensions/aipro-chat/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import {formPdf} from './helpers-form-pdf.mjs';import {createPdfFormSession} from '../ui/pdf-form-session.mjs';
const reopen=bytes=>pdfjs.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true}).promise;
test('real PDF.js modifies a form, preserves readonly field and reopens serialized bytes',async()=>{
 const doc=await reopen(formPdf());try{const session=await createPdfFormSession(doc,{reopen});assert.equal(session.fields.length,1);const f=session.fields[0];assert.equal(f.name,'Name');session.edit(f.id,'After');const result=await session.export();assert(result.verified);const copy=await reopen(result.bytes.slice());try{const fields=await copy.getFieldObjects();assert.equal(fields.get('Name')[0].value,'After');assert.equal(fields.get('Reference')[0].value,'Keep');assert.equal(copy.numPages,1);}finally{await copy.loadingTask.destroy();}assert(session.undo());assert.equal(session.value(f.id),'Before');assert.equal(session.dirty(),false);session.close();assert.throws(()=>session.edit(f.id,'bad'),/closed/);}finally{await doc.loadingTask.destroy();}
});
test('scripted, readonly, password and signed PDF fields are not writable',async()=>{
 const base={id:'f',type:'text',editable:true,page:0,value:'Original'};
 for(const changes of [{readonly:true},{password:true},{actions:{Keystroke:['script']}},{hidden:true},{type:'signature'}]){const result=await createPdfFormSession({getFieldObjects:async()=>({Name:[{...base,...changes}]}),getPermissions:async()=>null},{reopen});assert.equal(result.fields.length,0);}
 const restricted=await createPdfFormSession({getFieldObjects:async()=>({Name:[base]}),getPermissions:async()=>[4]},{reopen});assert.equal(restricted.reason,'protected');
});
test('late exports and failed independent verification cannot produce a verified copy',async()=>{
 const doc=await reopen(formPdf());try{let release;const held=new Promise(r=>release=r),session=await createPdfFormSession(doc,{reopen:async bytes=>{await held;return reopen(bytes);}}),id=session.fields[0].id;session.edit(id,'First');const pending=session.export();session.edit(id,'Second');release();await assert.rejects(pending,/changed/);
 const invalid=await createPdfFormSession(doc,{reopen:async()=>({numPages:3,getFieldObjects:async()=>({}),loadingTask:{destroy:async()=>{}}})});invalid.edit(id,'Third');await assert.rejects(invalid.export(),/verification_failed/);
 }finally{await doc.loadingTask.destroy();}
});
