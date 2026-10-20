import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runEditorRequest} from '../scripts/xlsx-editor-runtime.mjs';
test('editor observation waits for complete protection metadata and exposes observed feature identities',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nubi-editor-read-')),oldRoot=process.env.GENOFFICE_ALLOWED_ROOTS,oldSidecar=process.env.XLSX_SIDECAR_PATH;let reads=0,stopped=false;
 process.env.GENOFFICE_ALLOWED_ROOTS=root;process.env.XLSX_SIDECAR_PATH='/host/sidecar';
 try{const path=join(root,'source.xlsx');await writeFile(path,'private');class Client{async open(){return{sessionId:'PRIVATE',name:'PRIVATE',sheets:[{id:'sheet-1',name:'Data',tables:[{name:'Rows'}],pivotTables:[]}],visuals:[{id:'shape-7',kind:'shape',sheetId:'sheet-1'}]};}async readRange(){return ++reads===1?{indexingComplete:false,sheetProtection:null}:{indexingComplete:true,sheetProtection:{protected:true}};}stop(){stopped=true;}}
 const result=await runEditorRequest({domain:'excel',action:'read',path,output:join(root,'out.xlsx')},{XlsxSidecarClient:Client});
 assert.equal(reads,2);assert.equal(result.features.sheets[0].sheetProtection.protected,true);assert.equal(result.features.visuals[0].id,'shape-7');assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(stopped,true);
 }finally{if(oldRoot===undefined)delete process.env.GENOFFICE_ALLOWED_ROOTS;else process.env.GENOFFICE_ALLOWED_ROOTS=oldRoot;if(oldSidecar===undefined)delete process.env.XLSX_SIDECAR_PATH;else process.env.XLSX_SIDECAR_PATH=oldSidecar;await rm(root,{recursive:true,force:true});}
});
