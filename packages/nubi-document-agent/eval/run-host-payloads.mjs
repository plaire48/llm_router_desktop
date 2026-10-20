// Actual upstream engine execution; fixtures are new unencrypted synthetic decks.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import JSZip from 'jszip';
import {createGeneratedFileSession} from '../dist/file-operations.js';
import {createPowerPointDocument} from '../dist/powerpoint.js';
import {createNodeGenOfficeEngine} from '../scripts/genoffice-node-port.mjs';
const root=resolve(process.argv[2]),helperPath=resolve('artifacts/host-payload-helper/helper.cjs'),helper=createRequire(import.meta.url)(helperPath),slides=resolve('artifacts/hard-business-1/build/slides.cjs');
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:'/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',slideEnginePath:slides}),signal=new AbortController().signal,sha=b=>createHash('sha256').update(b).digest('hex');
const operations=['addMedia','addModel3d','pasteElements','setChart','pasteSlide','insertSlidePptx','setAnimations'];
const report={kind:'actual_host_bound_payload_execution',actualOffice2016:false,nascaVerified:false,modelMeasured:false,startedAt:new Date().toISOString(),sourceHashes:{},engineHashes:{slides:sha(await readFile(slides)),payloadHelper:sha(await readFile(helperPath))},trials:[]};
await mkdir(root,{recursive:true});for(const file of ['src/file-operations.ts','src/host-operation-catalogs.json','scripts/genoffice-node-port.mjs','eval/run-host-payloads.mjs','scripts/build-ppt-payload-helper.mjs'])report.sourceHashes[file]=sha(await readFile(new URL('../'+file,import.meta.url)));
const persist=()=>writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');
const rect={x:900000,y:3500000,cx:2000000,cy:900000};
const wav=()=>{const b=Buffer.alloc(244);b.write('RIFF');b.writeUInt32LE(236,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(200,40);return b;};
const glb=()=>{const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}]}).padEnd(76,' ')),b=Buffer.alloc(20+json.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);return b;};
for(let n=1;n<=3;n++)for(const operation of operations){const row={domain:'powerpoint',operation,repetition:n,status:'not_run'},dir=join(root,operation+'-'+n);report.trials.push(row);await mkdir(dir,{recursive:true});let session;
try{
 let bytes=new Uint8Array(await readFile(resolve(`artifacts/feature-wave-3/powerpoint-addElement-${n}/source.pptx`)));
 session=await createGeneratedFileSession({domain:'powerpoint',origin:'new_unencrypted_draft',bytes},engine);let state=await session.read(signal),input;
 if(operation==='setChart'){state=await session.apply([{op:'addChart',target:{slide:0},kind:'bar',offset:rect,categories:['A','B'],series:[{name:'Before',values:[1,2]}]}],state.revision,signal);bytes=session.snapshot().bytes;input={target:{slide:0,el:state.observation.pages[0].elements.find(x=>x.type==='chart').id},patch:{title:'Changed '+n,categories:['C','D'],series:[{name:'After',values:[30*n,40*n]}]}};}
 if(operation==='setAnimations')input={target:{slide:0},items:[{sourceId:state.observation.pages[0].elements[0].id,effect:'fade',trigger:'onClick',durationMs:700,delayMs:100}]};
 if(operation==='addMedia')input={target:{slide:0},kind:'audio',ext:'wav',bytes:'data:audio/wav;base64,'+wav().toString('base64'),offset:rect,name:'Audio '+n};
 if(operation==='addModel3d')input={target:{slide:0},ext:'glb',bytes:'data:model/gltf-binary;base64,'+glb().toString('base64'),offset:rect,name:'Model '+n};
 if(operation==='pasteElements'){const opened=await helper.openPptx(bytes),slide=opened.deck.slides[0];input={target:{slide:0},items:[helper.copyElementData(opened,slide,slide.elements[0])],dx:100000,dy:200000};}
 if(operation==='pasteSlide'){const opened=await helper.openPptx(bytes);input={afterIndex:0,mode:'source',bundle:helper.copySlide(opened,0)};}
 if(operation==='insertSlidePptx'){const other=(await createPowerPointDocument({title:'Imported '+n,slides:[{title:'Imported '+n,paragraphs:['New source '+n],table:null,notes:''}]},signal)).bytes,source=await helper.extractMergeSlideSource(other);assert.ok(source);input={at:1,source:JSON.parse(JSON.stringify(source,(_k,v)=>v instanceof Uint8Array?[...v]:v))};}
 session.dispose();const originalHash=sha(bytes),baseline=await JSZip.loadAsync(bytes),originalNote=await baseline.file('ppt/notesSlides/notesSlide2.xml').async('string');
 await writeFile(join(dir,'source.pptx'),bytes);await writeFile(join(dir,'bound-input.json'),JSON.stringify(input,null,2)+'\n');
 session=await createGeneratedFileSession({domain:'powerpoint',origin:'new_unencrypted_draft',bytes,payloads:[{id:'bound',operation,origin:'new_unencrypted_draft',revision:sha(bytes),description:'Synthetic '+operation,input}]},engine);
 state=await session.read(signal);const beforeCount=state.observation.pages[0].elements.length,beforeSlides=state.observation.pages.length;state=await session.apply([{op:'applyBoundPayload',payloadRef:'bound'}],state.revision,signal);const candidate=session.snapshot().bytes,z=await JSZip.loadAsync(candidate),xml=await z.file('ppt/slides/slide1.xml').async('string'),parts=Object.keys(z.files);
 await writeFile(join(dir,'candidate.pptx'),candidate);await writeFile(join(dir,'readback.json'),JSON.stringify(state.observation,null,2)+'\n');
 if(operation==='addMedia'){assert.ok(xml.includes('Audio '+n));const path=parts.find(x=>/\.wav$/.test(x));assert.ok(path);assert.deepEqual(Buffer.from(await z.file(path).async('uint8array')),wav());assert.ok((await z.file('ppt/slides/_rels/slide1.xml.rels').async('string')).includes('/audio'));}
 if(operation==='addModel3d'){assert.ok(xml.includes('aislides-3d:'));const path=parts.find(x=>/\.glb$/.test(x));assert.ok(path);assert.deepEqual(Buffer.from(await z.file(path).async('uint8array')),glb());row.limitation='GenOffice poster placeholder and embedded GLB; native Office 3D rendering is not implemented or verified.';}
 if(operation==='pasteElements')assert.equal(state.observation.pages[0].elements.length,beforeCount+1);
 if(operation==='setChart'){const path=parts.find(x=>/^ppt\/charts\/chart\d+\.xml$/.test(x)),chart=await z.file(path).async('string');assert.ok(chart.includes('Changed '+n));assert.ok(chart.includes(String(40*n)));assert.ok(chart.includes('After'));}
 if(operation==='setAnimations'){assert.ok(xml.includes('<p:timing'));assert.ok(xml.includes('dur="700"'));assert.ok(xml.includes('<p:spTgt'));}
 if(operation==='pasteSlide'){assert.equal(state.observation.pages.length,beforeSlides+1);assert.ok(await z.file('ppt/slides/slide3.xml').async('string'));}
 if(operation==='insertSlidePptx'){assert.equal(state.observation.pages.length,beforeSlides+1);assert.ok(JSON.stringify(state.observation.pages[1]).includes('Imported '+n));}
 assert.equal(await z.file('ppt/notesSlides/notesSlide2.xml').async('string'),originalNote);assert.equal(sha(bytes),originalHash);
 await writeFile(join(dir,'candidate.pptx'),candidate);await writeFile(join(dir,'readback.json'),JSON.stringify(state.observation,null,2)+'\n');row.status='passed';row.sourceHash=originalHash;row.candidateHash=sha(candidate);row.verified=['independent_feature_assertion','non_target_preservation','source_bytes_unchanged','engine_reopen_readback'];
}catch(e){row.status='failed';row.error=e.code??e.message;row.message=e.message;if(e.detail)row.detail=e.detail;}finally{session?.dispose();}await persist();console.log(JSON.stringify(row));}
report.finishedAt=new Date().toISOString();report.planned=21;report.passed=report.trials.filter(x=>x.status==='passed').length;report.failed=21-report.passed;await persist();
