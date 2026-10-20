import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('a separate TypeScript host can consume all optional authoring entrypoints without internal JSON files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nubi-word-types-'));
  try{
    const entry=fileURLToPath(new URL('../dist/types/src/word.js',import.meta.url));
    const excel=fileURLToPath(new URL('../dist/types/src/excel.js',import.meta.url));
    const powerpoint=fileURLToPath(new URL('../dist/types/src/powerpoint.js',import.meta.url));
    const model=fileURLToPath(new URL('../dist/types/src/host-model.js',import.meta.url));
    const source=`import {createWordDocument,wordDraftSchema,type WordDraft} from ${JSON.stringify(entry)};\nimport {prepareExcelDocument,excelDraftSchema,type ExcelDraft} from ${JSON.stringify(excel)};\nimport {preparePowerPointDocument,powerPointDraftSchema,type PowerPointDraft} from ${JSON.stringify(powerpoint)};\nconst draft:WordDraft={title:'Report',sections:[{heading:'Summary',paragraphs:[[{text:'Ready',bold:false}]],table:null}]};\nvoid createWordDocument(draft,new AbortController().signal);\nconst schemas:Record<string,unknown>[]=[wordDraftSchema,excelDraftSchema,powerPointDraftSchema];\nvoid schemas; void prepareExcelDocument; void preparePowerPointDocument;\nconst excelDraft:ExcelDraft={title:'Report',sheets:[]}; const deck:PowerPointDraft={title:'Report',slides:[]};void excelDraft;void deck;\n`;
    const operations=fileURLToPath(new URL('../dist/types/src/file-operations.js',import.meta.url));
    const nodeAdapter=fileURLToPath(new URL('../types/genoffice-node.js',import.meta.url));
    const composition=fileURLToPath(new URL('../dist/types/src/composition.js',import.meta.url));
    const quality=fileURLToPath(new URL('../dist/types/src/quality.js',import.meta.url));
    const native=fileURLToPath(new URL('../dist/types/src/index.js',import.meta.url));
    const nativeSource=`import {createNativeOfficeSkill,runNativeOfficeTask,type NativeOfficeWriteConnection,type NativeOfficeModelOutcome} from ${JSON.stringify(native)};
const nativeConnection:NativeOfficeWriteConnection={environment:'fixture',app:'word',scope:{projectId:'p',taskId:'t'},documentId:'doc',officeSessionId:'session',async call(){return {};}};
const nativeSession=createNativeOfficeSkill(nativeConnection);const nativeOutcome:NativeOfficeModelOutcome=nativeSession.outcome();void nativeOutcome;nativeSession.dispose();
const hostTransport=createHostModelTransport({id:'existing-model',async complete(){return {content:'',calls:[]};}});void runNativeOfficeTask({request:'Edit the observed document'},nativeConnection,hostTransport,new AbortController().signal);
`;
    const path=join(root,'host.mts');await writeFile(path,source+nativeSource+`import {runCompositionQuality,inspectCompositionQuality,type QualityReceipt} from ${JSON.stringify(quality)}; void runCompositionQuality;void inspectCompositionQuality;
import {prepareComposition,reviseComposition,composeWord,composeExcel,composePowerPoint,type CompositionPlan,type CompositionData} from ${JSON.stringify(composition)};\nvoid prepareComposition;void reviseComposition;void composeWord;void composeExcel;void composePowerPoint;const plan:CompositionPlan={};const data:CompositionData={};void plan;void data;\nimport {createHostModelTransport} from ${JSON.stringify(model)};\nvoid createHostModelTransport;\nimport {createGeneratedFileSession,prepareFileDocument,type FileEnginePort} from ${JSON.stringify(operations)};\nvoid createGeneratedFileSession; void prepareFileDocument; const port:FileEnginePort={async invoke(){return {observation:{}};}}; void port;\nimport {createNodeGenOfficeEngine} from ${JSON.stringify(nodeAdapter)}; void createNodeGenOfficeEngine;\n`);
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../node_modules/typescript/bin/tsc',import.meta.url)),'--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022',path],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }finally{await rm(root,{recursive:true,force:true});}
});
