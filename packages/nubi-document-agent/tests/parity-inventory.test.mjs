import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
const read=async name=>JSON.parse(await readFile(new URL('../eval/capabilities/'+name,import.meta.url)));
test('the full GenOffice target retains every public operation and hidden host-payload operations',async()=>{
 const inventory=await read('genoffice-parity-target.json');
 for(const [domain,name]of [['word','docs'],['excel','sheets'],['powerpoint','slides']])for(const op of(await read(name+'.json')).ops)assert.ok(inventory.operations.some(r=>r.domain===domain&&r.operation===op.op),domain+':'+op.op);
 for(const op of ['addPicture','replacePicture','addMedia','addModel3d','pasteElements','setImageFill'])assert.ok(inventory.operations.some(r=>r.domain==='powerpoint'&&r.operation===op&&r.upstream==='host_payload_required'),op);
 assert.equal(inventory.operations.find(r=>r.domain==='excel'&&r.operation==='refresh_pivot').upstream,'editor_required');
 assert.ok(inventory.operations.every(r=>r.office2016!=='verified'));
});
test('the official candidate registry retains version evidence and cannot include newer functions as Office 2016',async()=>{
 const official=await read('official-excel-functions.json'),rows=official.functions;
 for(const name of ['SUM','SUMPRODUCT','STDEV.S','NORM.DIST','IFNA','VLOOKUP','GETPIVOTDATA'])assert.equal(rows.find(r=>r.name===name).office2016Candidate,true,name);
 for(const name of ['XLOOKUP','FILTER','LET','STOCKHISTORY'])assert.equal(rows.find(r=>r.name===name).office2016Candidate,false,name);
 assert.ok(rows.every(r=>r.source.startsWith('https://support.microsoft.com/')&&r.nativeVerified===false));
 const registry=JSON.parse(await readFile(new URL('../src/excel-function-registry.json',import.meta.url)));
 assert.deepEqual(registry.office2016Candidates,rows.filter(r=>r.office2016Candidate).map(r=>r.name));assert.ok(registry.requiresHostCapabilities.includes('CUBEVALUE'));
});
test('execution evidence covers all native operations while retaining optional host boundaries',async()=>{
 const report=await read('genoffice-execution-coverage.json'),ids=report.operations.map(r=>r.domain+':'+r.operation);
 assert.equal(ids.length,172);assert.equal(new Set(ids).size,172);assert.equal(report.operations.filter(r=>r.evidence.length).length,172);
 assert.equal(report.operations.reduce((n,r)=>n+r.evidence.length,0),519);
 const editor=report.operations.filter(r=>r.connection==='host_editor_adapter_connected');assert.equal(editor.length,8);assert.ok(editor.every(r=>r.domain==='excel'&&r.hostInjectionRequired&&r.nativeOfficeVerified===false));
 const watermark=report.operations.find(r=>r.domain==='word'&&r.operation==='set_watermark');assert.equal(watermark.evidence.length,6);
 for(const row of report.operations){for(const variant of new Set(row.evidence.map(x=>x.variant)))assert.deepEqual(row.evidence.filter(x=>x.variant===variant).map(x=>x.repetition).sort(),[1,2,3]);assert.equal(row.nativeOfficeVerified,false);}
 assert.equal(report.operations.find(r=>r.operation==='addModel3d').limitation.includes('poster placeholder'),true);
 const pointer=await read('connected-coverage.json');assert.equal(pointer.current,'genoffice-execution-coverage.json');
});
