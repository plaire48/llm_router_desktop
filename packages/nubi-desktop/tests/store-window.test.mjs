import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
test('bounded history retains existing order, updates, prefixes, deletion and unlimited search',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-window-')),store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 for(let i=0;i<60;i++){store.set('task:'+i,{id:i,text:'original'});store.set('other:'+i,{id:i});}
 store.set('task:2',{id:2,text:'edited'});store.delete('task:58');
 const all=store.list('task:');assert.equal(all.length,59);assert.equal(all.find(x=>x.id===2).text,'edited');
 assert.deepEqual(store.list('task:',{limit:10}),all.slice(0,10));assert.deepEqual(store.list('task:',{limit:0}),[]);
 assert.deepEqual(store.list('TASK:',{limit:3}),all.slice(0,3),'existing LIKE semantics retained');
 for(const limit of [-1,1.1,Infinity,'5'])assert.throws(()=>store.list('task:',{limit}),/store_list_limit/);
 store.close();const reopened=new Store(dir);try{assert.deepEqual(reopened.list('task:',{limit:10}),all.slice(0,10));}finally{reopened.close();}
});
test('display keeps a selected old conversation and full-text search still reaches older answers',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-old-conversation-')),root=path.join(dir,'project');await mkdir(root);
 const service=new ProjectService({storageRoot:path.join(dir,'state')});t.after(async()=>{service.dispose();service.store?.close();});removeLater(dir);await service.open(root,{initializeWiki:false});
 for(let i=0;i<70;i++)service.store.set('task:t'+i,{id:'t'+i,state:'done',request:'Request '+i,createdAt:new Date(1700000000000+i).toISOString(),messages:[{role:'assistant',content:i===0?'Unique oldest answer breadfruit':'Answer '+i}]});
 const rows=service.displayTasks('t0');assert.equal(rows.length,51);assert.equal(rows.at(-1).id,'t0');assert.equal(service.displayTasks('t69').length,50);
 const history=service.conversationHistory({query:'breadfruit'});assert(JSON.stringify(history).includes('t0'));
});
