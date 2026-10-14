import test from 'node:test';import assert from 'node:assert/strict';
import {build} from 'esbuild';import {readFile} from 'node:fs/promises';
import {rendererBundleOptions} from '../scripts/renderer-bundle.mjs';

test('startup defers embedded Workspace screens and emits the unchanged brand image once',async()=>{
 const result=await build({...rendererBundleOptions(),outdir:'verification/bundle-probe',write:false,minify:true,logLevel:'silent'}),outputs=result.metafile.outputs,initial=new Set();
 const visit=file=>{if(initial.has(file)||!outputs[file])return;initial.add(file);for(const entry of outputs[file].imports||[])if(entry.kind!=='dynamic-import')visit(entry.path);};visit('verification/bundle-probe/renderer.js');
 const sources=new Set([...initial].flatMap(file=>Object.keys(outputs[file].inputs)));
 for(const deferred of ['ui/WikiBrowser.jsx','ui/MailHistory.jsx','ui/SkillManager.jsx','ui/MailLibrary.jsx','ui/McpPanel.jsx','ui/SkillRegistration.jsx','ui/AiWorkspaceEmbed.jsx','ui/ai-workspace/ServiceDesk.jsx','ui/ai-workspace/workspace/LinkWorkspace.jsx'])assert(!sources.has(deferred),deferred+' must wait for its screen');
 const artwork=result.outputFiles.filter(file=>/team-workspace-[^/]+\.png$/.test(file.path));assert.equal(artwork.length,1);
 const source=await readFile('ui/TeamWorkspaceMark.js','utf8'),encoded=source.match(/base64,([^']+)/)[1];
 assert.deepEqual(Buffer.from(artwork[0].contents),Buffer.from(encoded,'base64'));
 for(const file of result.outputFiles.filter(file=>file.path.endsWith('.js')))assert(!file.text.includes(encoded.slice(0,1000)),'artwork is a file, not JavaScript payload');
});
