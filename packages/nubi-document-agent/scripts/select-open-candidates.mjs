import{readFile,writeFile,mkdir,copyFile}from'node:fs/promises';import{resolve,join}from'node:path';
const parent=resolve('artifacts'),root=resolve(process.argv[2]??'artifacts/open-composition-selected-1'),initial=join(parent,'open-composition-1'),original=JSON.parse(await readFile(join(initial,'model-results.json'),'utf8'));
const select={
 'procurement-word':'open-composition-repair-1',
 'procurement-excel':'open-composition-procurement-print',
 'training-excel':'open-composition-training-print',
 'migration-excel':'open-composition-migration-print',
 'migration-word':'open-composition-recovery-1'
};
await mkdir(root,{recursive:true});const report={kind:'selected_open_composition_candidates',initialRun:initial,tasks:[],nativeOfficeVerified:false};
for(const task of original.tasks){const source=select[task.id]?join(parent,select[task.id]):initial,dir=join(root,task.id),ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[task.domain];await mkdir(dir,{recursive:true});for(const file of ['composition.json','requirements.json','candidate.'+ext])await copyFile(join(source,task.id,file),join(dir,file));report.tasks.push({...task,initialStatus:task.status,selectedFrom:source,status:'created_pending_independent_checks',file:task.id+'/candidate.'+ext});}
await writeFile(join(root,'model-results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({selected:report.tasks.length}));
