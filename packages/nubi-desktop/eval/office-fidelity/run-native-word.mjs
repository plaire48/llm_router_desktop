// Windows acceptance only. Uses the existing selected-document stdio bridge;
// never launches Word, writes the source, or substitutes the file capture engine.
import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {openOfficeProcess} from '../../runtime/external-office-process.mjs';
import {validateCapture} from '../../runtime/office-capture.mjs';
import {gradeCapture} from './features.mjs';
const {values}=parseArgs({options:{exe:{type:'string'},source:{type:'string'},out:{type:'string'},window:{type:'string'},list:{type:'boolean'},'office-2016-confirmed':{type:'boolean'}}});
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32')throw Error('native_office_windows_required');
if(!values.exe||!path.isAbsolute(values.exe))throw Error('Pass --exe with the built Nubi.OfficeBridge.exe absolute path.');
const host=await openOfficeProcess({app:'word',executable:values.exe,timeoutMs:120000});
try{
 if(values.list){console.log(JSON.stringify({windows:host.documents?.map(({documentTitle,windowNumber})=>({documentTitle,windowNumber}))},null,2));}
 else{
  if(!values.source||!values.out||!values.window)throw Error('Pass --source, a NEW --out directory and --window from --list.');
  const source=await realpath(path.resolve(values.source)),out=path.resolve(values.out);
  if(path.basename(source)!=='synthetic-kitchen-sink.docx')throw Error('Use only the synthetic kitchen-sink Word fixture.');
  const checkedIn=await readFile(new URL('../../tests/fixtures/office-fidelity/synthetic-kitchen-sink.docx',import.meta.url));
  const before=await readFile(source);if(hash(before)!==hash(checkedIn))throw Error('Synthetic fixture bytes differ; do not substitute a company document.');
  const candidate=host.documents?.find(x=>x.windowNumber===Number(values.window)&&x.documentTitle===path.basename(source));
  if(!candidate)throw Error('native_office_selection_changed');
  await host.call('bind_document',{candidateId:candidate.candidateId});
  await mkdir(out);const assets=path.join(out,'assets');await mkdir(assets);
  const start=performance.now();let report;
  try{
   const result=await host.call('office_capture_template',{path:source,outDir:assets,maxAssets:200,renders:true});
   const capture=validateCapture(result.capture),grade=gradeCapture(capture);
   if(capture.engine!=='office'||capture.fidelity!=='office')throw Error('native_capture_required');
   if(capture.source.hash!==hash(before)||hash(await readFile(source))!==hash(before))throw Error('form_capture_source_changed');
   for(const asset of capture.assets){
    if(!asset.path||path.isAbsolute(asset.path)||asset.path.split(/[\\/]/).includes('..'))throw Error('form_capture_invalid');
    const file=path.resolve(assets,asset.path),info=await lstat(file);
    if(!file.startsWith(assets+path.sep)||info.isSymbolicLink()||!info.isFile()||!info.size)throw Error('form_capture_invalid');
   }
   const renders=capture.document.renders??[];
   if(!renders.length||renders.some((r,i)=>r.index!==i+1||!capture.assets.some(a=>a.id===r.asset&&a.kind==='render')))throw Error('form_capture_render_failed');
   await writeFile(path.join(out,'capture.json'),JSON.stringify(capture,null,2));
   const edition=values['office-2016-confirmed']===true;
   report={evidence:'Windows native Office bridge',sourceSha256:hash(before),sourceUnchanged:true,office:capture.office,office2016UserConfirmed:edition,durationMs:performance.now()-start,renderPages:renders.length,...grade,passed:edition&&/^16\./.test(capture.office.version)&&grade.total===38&&grade.captured===38};
   if(!report.passed)process.exitCode=1;
  }catch(error){report={passed:false,error:error.message,durationMs:performance.now()-start};process.exitCode=1;}
  await writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }
}finally{host.close();}
