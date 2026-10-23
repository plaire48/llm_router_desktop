import {serialize} from 'node:v8';
let busy=false;
process.on('disconnect',()=>process.exit(0));
process.on('message',async message=>{
 const {id,task,input}=message||{};if(!Number.isSafeInteger(id)||busy)return;
 busy=true;process.send?.({id,type:'started'});
 try{
  let result;
  if(task==='code-analysis'){const {analyzeCode}=await import('./code-analysis-core.mjs');result=analyzeCode(input);}
  else if(task==='code-map'){
   const {codeMap}=await import('./code-map-core.mjs');result=await codeMap(input.root,input.files,input.options);
   if(input.projection==='navigation')result={summary:result.summary,entrypoints:result.entrypoints,ranking:result.ranking,files:Object.fromEntries(result.ranking.slice(0,200).map(row=>[row.path,{definitions:result.files[row.path].definitions.slice(0,8)}])),projection:{kind:'navigation',contextFiles:200,definitionsPerFile:8}};
  }
  else throw Error('read_task_invalid');
  if(serialize(result).byteLength>64*1024*1024)throw Error('read_task_limit');
  if(process.connected)process.send?.({id,type:'result',result,rssBytes:process.memoryUsage().rss});
 }catch(error){if(process.connected)process.send?.({id,type:'error',error:/^[a-z_]{3,80}$/.test(error.message)?error.message:'read_task_failed'});}
 finally{busy=false;}
});
