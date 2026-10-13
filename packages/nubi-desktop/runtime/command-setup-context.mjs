import {readSource} from './files.mjs';
// A successful matching continuation may re-observe small setup prerequisites.
// These facts authorize setup references only, never a source edit or execution.
export async function commandSetupContext({workspace,references=[],resumed,observations,signal}){
 if(!resumed)return [];
 const rows=[];let bytes=0;
 for(const ref of references.slice(0,10)){
  signal?.throwIfAborted();
  let file;try{file=await readSource(workspace,ref.path);}catch{continue;}
  signal?.throwIfAborted();
  if(file.hash!==ref.hash||file.content.length>8000||bytes+file.content.length>16000)continue;
  bytes+=file.content.length;rows.push({...file,authority:'setup_reference_only',editObservation:false});
  observations.environment ||=new Map();observations.environment.set(file.path,{hash:file.hash});
 }
 return rows;
}
