import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installProjectBrowser} from '../runtime/project-browser.mjs';
class Project{ready(){} async target(){return this.root;}}
installProjectBrowser(Project);
test('directory-only validation retains project, private-path and symlink boundaries',async t=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-directory-location-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'work'));await writeFile(path.join(root,'work','one.txt'),'one');await symlink(os.tmpdir(),path.join(root,'outside'));
 const service=Object.assign(new Project(),{root,projectId:'current'});
 assert.deepEqual(await service.browseDirectory({projectId:'current',path:'work',includeEntries:false}),{relative:'work',absolute:path.join(root,'work')});
 assert.equal((await service.browseDirectory({projectId:'current',path:'work'})).entries[0].name,'one.txt');
 await assert.rejects(service.browseDirectory({projectId:'other',includeEntries:false}),/project_changed/);
 for(const input of ['../','outside','.nubi'])await assert.rejects(service.browseDirectory({projectId:'current',path:input,includeEntries:false}));
});
