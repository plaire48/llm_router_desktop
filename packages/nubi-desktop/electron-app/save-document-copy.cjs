const {open,readFile}=require('node:fs/promises');
const {createHash}=require('node:crypto');
const path=require('node:path');
// Called only by a trusted renderer's explicit save action. Never overwrite a source.
async function saveDocumentCopy(args,{choose,current=()=>true}){
 if(!['pdf','txt'].includes(args.kind)||typeof args.data!=='string'||args.data.length>90000000)throw Error('document_copy_invalid');
 const bytes=Buffer.from(args.data,'base64');if(!bytes.length||bytes.length>64*1024*1024||bytes.toString('base64')!==args.data||args.kind==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw Error('document_copy_invalid');
 const filename=path.basename(String(args.filename||'document')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120).replace(/\.[^.]+$/,'')+'-copy.'+args.kind;
 const selected=await choose(filename,args.kind);if(selected.canceled)return {cancelled:true};if(!current())throw Error('project_changed');
 const target=selected.filePath;if(!path.isAbsolute(target)||path.extname(target).toLowerCase()!=='.'+args.kind)throw Error('document_copy_extension');
 let file;try{file=await open(target,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('document_copy_exists');throw e;}
 try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 const actual=await readFile(target);if(createHash('sha256').update(actual).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw Error('document_copy_unconfirmed');
 return {saved:true,filename:path.basename(target),bytes:actual.length};
}
module.exports={saveDocumentCopy};
