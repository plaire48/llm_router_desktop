const {Worker}=require('node:worker_threads');
const {existsSync}=require('node:fs');
const path=require('node:path');
const DOCUMENT_FILE=/\.(pdf|docx|docm|dotx|dotm|pptx|pptm|ppsx|ppsm|potx|potm|xlsx|xlsm|xltx|xltm)$/i;
let activeReaders=0;
function readFileDocument(bytes,filename,{workerPath}={}){
 if(activeReaders>=2)return Promise.reject(Error('document_reader_busy'));
 if(bytes.length>64*1024*1024)return Promise.reject(Error('document_limit'));
 workerPath ||= existsSync(path.join(__dirname,'backend/mail-attachment-worker.mjs'))?path.join(__dirname,'backend/mail-attachment-worker.mjs'):path.join(__dirname,'../runtime/mail-attachment-worker.mjs');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(workerPath,{workerData:{bytes,filename},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256},stdout:true,stderr:true});activeReaders++;worker.stdout.resume();worker.stderr.resume();let done=false;
  const finish=(error,result)=>{if(done)return;done=true;activeReaders--;clearTimeout(timer);void worker.terminate();error?reject(Error(error)):resolve({...result,...(/\.pdf$/i.test(filename)?{pdf:bytes.toString('base64')}:{}),title:filename});};
  const timer=setTimeout(()=>finish('document_timeout'),60000);
  worker.once('message',value=>{if(value.error==='document_empty'&&/\.pdf$/i.test(filename))finish(null,{text:'',segments:[],coverage:'이미지 PDF 미리보기. 이미지의 텍스트는 아직 읽지 않았어요.'});else finish(value.error,value.document);});worker.once('error',()=>finish('document_read_failed'));worker.once('exit',()=>finish('document_read_failed'));
 });
}
module.exports={DOCUMENT_FILE,readFileDocument};
