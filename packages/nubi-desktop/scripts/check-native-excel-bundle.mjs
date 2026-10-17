import {mkdtemp,copyFile,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Run the distributed worker outside the checkout with no adjacent node_modules.
const source=path.resolve('electron-app/lib/backend/native-excel-calculator-worker.mjs');
const temporary=await mkdtemp(path.join(tmpdir(),'nubi-excel-bundle-'));
const output=path.resolve(process.env.NUBI_EXCEL_BUNDLE_OUTPUT||'../../artifacts/workspace-excel-edit-1/bundle.json');
const cell=(address,row,col,value,formula)=>({address,row,col,value,...(formula?{formula}:{})});
try{
 const isolated=path.join(temporary,'worker.mjs');await copyFile(source,isolated);
 const sheets=[{id:1,name:'Report',cells:[cell('A1',1,1,'a'),cell('B1',1,2,null,'=VLOOKUP(A1,Basis!A1:B2,2,FALSE)'),cell('C1',1,3,null,'=B1*2'),cell('D1',1,4,null,'=IFERROR(1/0,0)')]},{id:2,name:'Basis',cells:[cell('A1',1,1,'a'),cell('B1',1,2,25),cell('A2',2,1,'b'),cell('B2',2,2,40)]}];
 const message=await new Promise((resolve,reject)=>{
  const worker=new Worker(isolated,{workerData:{sheets},execArgv:[],stdout:true,stderr:true});worker.stdout.resume();worker.stderr.resume();
  const timer=setTimeout(()=>{worker.terminate();reject(Error('isolated_worker_timeout'));},12000);
  worker.once('message',value=>{clearTimeout(timer);worker.terminate();resolve(value);});worker.once('error',error=>{clearTimeout(timer);reject(error);});
 });
 assert.equal(message.error,undefined);assert.deepEqual(message.result.values.map(v=>v.value),[25,50,0]);assert.equal(message.result.officeVerified,false);
 const licenses=path.resolve('electron-app/lib/licenses/native-excel');const inventory=JSON.parse(await readFile(path.join(licenses,'index.json'),'utf8'));
 for(const file of inventory.coveredSources)assert((await readFile(path.join(licenses,'source',file))).length>0);
 const bytes=await readFile(source);await mkdir(path.dirname(output),{recursive:true});
 const result={isolated:true,nodeModulesRequired:false,workerSha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,calculated:[25,50,0],coveredSources:inventory.coveredSources.length,office2016Verified:false};
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await rm(temporary,{recursive:true,force:true});}
