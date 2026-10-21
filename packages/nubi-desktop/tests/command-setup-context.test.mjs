import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {commandSetupContext} from '../runtime/command-setup-context.mjs';
import {hash} from '../runtime/files.mjs';
import {SourceObservations} from '../runtime/source-edits.mjs';

async function sample(t){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-setup-context-')));
 removeLater(root);
 const content='Read only. Preserve the original files.';
 await writeFile(path.join(root,'README.md'),content);
 return {root,content,ref:{path:'README.md',hash:hash(content)}};
}
test('successful continuation freshly observes setup references without granting edit observations',async t=>{
 const {root,content,ref}=await sample(t),observations=new SourceObservations();
 const rows=await commandSetupContext({workspace:root,references:[ref],resumed:true,observations});
 assert.equal(rows[0].content,content);assert.equal(rows[0].editObservation,false);
 assert.deepEqual(observations.environment.get(ref.path),{hash:ref.hash});
 assert.equal(observations.files.size,0);
 assert.throws(()=>observations.require(rows[0]),/source_read_required/);
});
test('changed, missing, private and oversized prerequisites are not carried into setup authority',async t=>{
 const {root,ref}=await sample(t),observations={files:new Map()};
 await writeFile(path.join(root,'README.md'),'changed');
 const long='x'.repeat(8001);await writeFile(path.join(root,'large.txt'),long);
 const rows=await commandSetupContext({workspace:root,resumed:true,observations,references:[ref,{path:'missing.txt',hash:'missing'},{path:'.env',hash:'private'},{path:'large.txt',hash:hash(long)}]});
 assert.deepEqual(rows,[]);assert.equal(observations.environment?.size||0,0);
});
test('failed continuation reads nothing and cancellation does not restore observations',async t=>{
 const {root,ref}=await sample(t),observations={files:new Map()};
 assert.deepEqual(await commandSetupContext({workspace:root,references:[ref],resumed:false,observations}),[]);
 assert.equal(observations.environment,undefined);
 const controller=new AbortController();controller.abort();
 await assert.rejects(commandSetupContext({workspace:root,references:[ref],resumed:true,observations,signal:controller.signal}),{name:'AbortError'});
 assert.equal(observations.environment,undefined);
});
