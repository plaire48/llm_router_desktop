import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {codingMapContext} from '../runtime/coding-map.mjs';
installAgent(ProjectService);

async function sources(root){
 await mkdir(path.join(root,'src'),{recursive:true});
 await writeFile(path.join(root,'src','index.js'),"import {a} from './a.js';\nimport {b} from './b.js';\nexport const run=()=>a()+b();\n");
 await writeFile(path.join(root,'src','a.js'),"import {b} from './b.js';\nexport function a(){return b();}\n");
 await writeFile(path.join(root,'src','b.js'),"export function b(){return 1;}\n");
 await writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture',main:'src/index.js'}));
}

test('a coding run gets the import-graph code map of its project, ranked from its entry points',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'버그 수정'});await sources(root);
 const text=await codingMapContext(service,task.id);
 assert.match(text,/^Code map \(deterministic/);
 const lines=text.split('\n').slice(1);
 const b=lines.indexOf('- src/b.js: imported by 2; defines b'),a=lines.indexOf('- src/a.js: imported by 1; defines a');
 assert.ok(b>=0&&a>b,text);
 assert.ok(lines.some(line=>line.startsWith('- src/index.js (entry)')),text);
});

test('the map is reused until the project files change, and bounded in size',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'버그 수정'});await sources(root);
 let computed=0;const count=async(...args)=>{computed++;const {codeMap}=await import('../runtime/code-map.mjs');return codeMap(...args);};
 await codingMapContext(service,task.id,{compute:count});await codingMapContext(service,task.id,{compute:count});
 assert.equal(computed,1);
 await writeFile(path.join(root,'src','c.js'),"import {b} from './b.js';\nexport const c=b;\n");
 await codingMapContext(service,task.id,{compute:count});assert.equal(computed,2);
 assert.ok(Buffer.byteLength(await codingMapContext(service,task.id,{maxBytes:120}))<=120);
});

test('no map when the project has more source files than the bound or none at all',async t=>{
 const {service,root}=await fixture(t),task=await service.createTask({request:'버그 수정'});
 assert.equal(await codingMapContext(service,task.id),null,'app.txt and a wiki page are not source files');
 await sources(root);
 assert.equal(await codingMapContext(service,task.id,{maxFiles:2}),null);
});

test('a development request carries the code map into the model context',async t=>{
 const {service,root}=await fixture(t);await sources(root);
 const task=await service.createTask({request:'src/a.js 버그를 수정해 주세요'});let seen='';
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){seen=JSON.stringify(messages);return {content:'확인했습니다.',calls:[]};}};
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.match(seen,/Code map \(deterministic/);assert.match(seen,/src\/b\.js: imported by 2/);
});
