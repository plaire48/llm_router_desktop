import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,isAbsolute} from 'node:path';
import {preparePrintNameCopy} from './genoffice-sheet-copy.mjs';
const engineError=value=>{const error=Error('file_engine_rejected'),f=value?.detail?.failures?.[0]??value?.result?.result?.failures?.[0];if(f&&Number.isInteger(f.index)&&f.index>=0&&f.index<100&&/^[A-Za-z_]{1,60}$/.test(f.op??'')&&/^[a-z_]{1,50}$/.test(f.reason??'')){error.detail={index:f.index,operation:f.op,reason:f.reason,fields:[...new Set([...String(f.error??'').matchAll(/operations\.\d+\.([A-Za-z_]{1,60})\b/g)].map(m=>m[1]))].slice(0,10)};}if(/^editor_[a-z_]{1,60}$/.test(value?.code??''))error.code=value.code;return error;};
/** Optional host-side adapter around the existing engines. No paths are accepted from model tool input. */
const editorOperations=['refresh_pivot','add_table_row','add_table_column','delete_table_row','delete_table_column','delete_table','edit_shape','delete_visual'];
export function createNodeGenOfficeEngine({wordExcelEnginePath,slideEnginePath,nodePath=process.execPath,xlsxSidecarPath,xlsxEditorEnginePath}){
  if(![wordExcelEnginePath,slideEnginePath,nodePath].every(isAbsolute)||xlsxSidecarPath!==undefined&&!isAbsolute(xlsxSidecarPath))throw Error('engine_path_invalid');
  if(xlsxEditorEnginePath!==undefined&&(!isAbsolute(xlsxEditorEnginePath)||!xlsxSidecarPath))throw Error('engine_path_invalid');
  const port= {async invoke({domain,action,bytes,ops,assets=[],readScope},signal){
    if(signal.aborted)throw Error('operation_cancelled');
    const root=await mkdtemp(join(tmpdir(),'nubi-file-engine-')),ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[domain];
    try{
      const copy=domain==='excel'&&action==='apply'?await preparePrintNameCopy(bytes,ops):{bytes,restore:async value=>value};
      const path=join(root,'source.'+ext),output=join(root,'candidate.'+ext);await writeFile(path,copy.bytes,{mode:0o600,flag:'wx'});
      const useEditor=domain==='excel'&&xlsxEditorEnginePath&&action==='apply'&&ops?.some(o=>editorOperations.includes(o.op)||o.op==='convert_to_values');
      if(useEditor&&ops.some(o=>!editorOperations.includes(o.op)&&o.op!=='convert_to_values'))throw Error('engine_editor_separate_batch_required');
      const engine=useEditor?xlsxEditorEnginePath:domain==='powerpoint'?slideEnginePath:wordExcelEnginePath;
      const bound=new Map();for(const a of assets){if(!/^[A-Za-z0-9_-]{1,80}$/.test(a.id)||bound.has(a.id)||a.mime!=='image/png'||!(a.bytes instanceof Uint8Array)||a.bytes.length>90000)throw Error('engine_asset_invalid');const file=join(root,'asset-'+a.id+'.png');await writeFile(file,a.bytes,{mode:0o600,flag:'wx'});bound.set(a.id,file);}
      const mapped=ops?.map(op=>{if(op.assetPathRef===undefined)return op;if(domain!=='excel'||op.op!=='add_image'||!bound.has(op.assetPathRef))throw Error('engine_asset_invalid');const{assetPathRef,...rest}=op;return{...rest,path:bound.get(assetPathRef)};});
      const input={domain,action,path,output,ops:mapped,range:domain==='word'?[0,100]:readScope?.range??'A1:T100',...(domain==='excel'&&readScope?.sheet?{sheet:readScope.sheet}:{}),maxChars:4000};
      const response=await new Promise((resolve,reject)=>{
        const child=spawn(nodePath,[engine],{cwd:root,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH??'',SYSTEMROOT:process.env.SYSTEMROOT??'',GENOFFICE_ALLOWED_ROOTS:root,NODE_PATH:join(dirname(wordExcelEnginePath),'node_modules'),...(xlsxSidecarPath?{XLSX_SIDECAR_PATH:xlsxSidecarPath}:{})}});
        let stdout='',overflow=false,aborted=false;const abort=()=>{aborted=true;child.kill();};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        const timer=setTimeout(()=>{overflow=true;child.kill();},45_000);
        child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>12_000_000){overflow=true;child.kill();}});child.stderr.on('data',()=>{});
        child.once('error',()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(Error('file_engine_unavailable'));});
        child.once('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',abort);if(aborted){reject(Error('operation_cancelled'));return;}if(overflow){reject(engineError());return;}let value;try{const line=stdout.split('\n').find(x=>x.startsWith('NUBI_ENGINE_RESULT:'));value=JSON.parse(line.slice(19));}catch{reject(engineError());return;}if(code!==0||!value.ok||value.result?.result?.failures?.length){reject(engineError(value));return;}resolve(value.result);});
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
      });
      if(action==='apply'&&domain==='excel'&&xlsxEditorEnginePath&&!useEditor){
        const source=new Uint8Array(await readFile(output)),calculated=await port.hostEditor.calculate(source,signal);return{bytes:await copy.restore(calculated),observation:response.readback};
      }
      if(action==='read'&&domain==='excel'&&xlsxEditorEnginePath){const inspector=createNodeGenOfficeEngine({wordExcelEnginePath:xlsxEditorEnginePath,slideEnginePath,nodePath,xlsxSidecarPath});const extra=await inspector.invoke({domain,action,bytes,readScope},signal);return{observation:{...response,...extra.observation}};}
      return action==='apply'?{bytes:await copy.restore(new Uint8Array(await readFile(output))),observation:response.readback}:{observation:response};
    }finally{await rm(root,{recursive:true,force:true});}
  }};
  if(xlsxEditorEnginePath){port.hostEditor={operations:{excel:editorOperations},maxOperationsPerBatch:1,invoke:async(request,signal)=>{if(request.domain!=='excel'||request.action!=='apply'||!request.ops?.every(o=>editorOperations.includes(o.op)))throw Error('engine_editor_operation_invalid');return port.invoke(request,signal);},calculate:async(bytes,signal)=>{
    // Reuse the same private process boundary. A dedicated internal marker is
    // never part of a model operation or public catalog.
    const calculator=createNodeGenOfficeEngine({wordExcelEnginePath:xlsxEditorEnginePath,slideEnginePath,nodePath,xlsxSidecarPath});return(await calculator.invoke({domain:'excel',action:'apply',bytes,ops:[]},signal)).bytes;
  }};}
  return port;
}

