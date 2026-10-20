import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {createGeneratedFileSession} from '../dist/file-operations.js';import {createNodeGenOfficeEngine} from '../scripts/genoffice-node-port.mjs';
const wave=resolve(process.argv[2]??'artifacts/feature-wave-2'),engine=createNodeGenOfficeEngine({wordExcelEnginePath:'/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',slideEnginePath:join(wave,'engine/slides.cjs')}),signal=new AbortController().signal;
const sha=b=>createHash('sha256').update(b).digest('hex'),rows=[];
for(const [domain,operation,ops]of [
 ['word','setFont',[{op:'setFont',target:{blockIndexes:[2]},italic:true},{op:'insertTableRow',target:{blockIndexes:[4]},row:999}]],
 ['excel','format_range',[{op:'format_range',sheet:'데이터',range:'B2:B4',format:{bold:true}},{op:'add_defined_name',name:'Bad-Name',ref:"'데이터'!A1"}]],
 ['powerpoint','addElement',[{op:'setNotes',target:{slide:0},text:'적용되면 안 되는 노트'},{op:'setTransform',target:{slide:0,el:'e_missing'},box:{x:0,y:0,cx:1,cy:1}}]]
]){
 const ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[domain],bytes=new Uint8Array(await readFile(join(wave,`${domain}-${operation}-1/source.${ext}`))),session=await createGeneratedFileSession({domain,origin:'new_unencrypted_draft',bytes},engine),before=sha(bytes),read=await session.read(signal);let rejected=false,error;
 try{await session.apply(ops,read.revision,signal);}catch(e){rejected=true;error=e.code??e.message;}
 const after=await session.read(signal),preserved=sha(session.snapshot().bytes)===before&&after.revision===read.revision;
 rows.push({domain,case:'mixed_batch_rejected_without_commit',passed:rejected&&preserved,rejected,preserved,error});session.dispose();
}
const report={kind:'real_engine_negative_cases',actualOffice2016:false,nascaVerified:false,planned:rows.length,passed:rows.filter(r=>r.passed).length,checks:rows};await writeFile(join(wave,'negative-results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
