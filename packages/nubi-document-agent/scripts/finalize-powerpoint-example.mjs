import {mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
// Local example QA only, not a package runtime dependency or Office validation.
const root=resolve(process.argv[2]??'artifacts/office-create-01');
const skill='/Users/ganadi/.codex/plugins/cache/openai-primary-runtime/presentations/26.1009.11318/skills/presentations';
const runtime='/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=join(runtime,'node/node_modules');
const {finalizePresentation}=await import(pathToFileURL(join(skill,'container_tools/artifact_tool_utils.mjs')));
await mkdir(join(root,'outputs'),{recursive:true});await mkdir(join(root,'qa'),{recursive:true});
const metadata=JSON.parse(await readFile(join(root,'generation.json'),'utf8'));
await finalizePresentation({workspaceDir:root,candidatePath:join(root,'drafts/powerpoint-report.pptx'),finalPath:join(root,'outputs/powerpoint-report.pptx'),pythonExecutable:join(runtime,'python/bin/python3'),integrityValidatorPath:join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','2','--require-native-table-slide','3'],explicitTotalSlideCount:3,requiredNativeTableOwnerSlides:[2,3],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[metadata.fontFamily]},verifyArtifactToolImport:true,receiptPath:join(root,'qa/powerpoint.validation.json')});
console.log(JSON.stringify({finalized:true,slides:3,actualPowerPoint:false}));
