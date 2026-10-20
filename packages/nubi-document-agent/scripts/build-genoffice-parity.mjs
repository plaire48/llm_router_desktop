// Full upstream scope, including host-only operations. Never equate visibility with support.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {generatedAssetOperationMap} from '../dist/file-operations.js';
const root=resolve(import.meta.dirname,'..'),source=resolve(process.argv[2]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile(join(source,'vendor/genoffice-source.json')));
if(manifest.commit!=='438d9c65709952490c970beaa2599ef45e74431f')throw Error('upstream_revision_mismatch');
const rows=[],sourceHashes={},hostContracts=JSON.parse(await readFile(join(root,'src/host-operation-catalogs.json')));
const implementation=await readFile(join(root,'src/file-operations.ts'),'utf8');
const connected={};for(const domain of ['word','excel','powerpoint']){
 const match=new RegExp('  '+domain+':\\[([^\\]]+)\\]').exec(implementation);if(!match)throw Error('connected_contract_not_found');
 connected[domain]=[...match[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
}
for(const [domain,file]of [['word','docs'],['excel','sheets']]){
 const bytes=await readFile(join(root,`eval/capabilities/${file}.json`)),catalog=JSON.parse(bytes);sourceHashes[file+'.json']=sha(bytes);
 for(const op of catalog.ops){const assetVariants=Object.entries(generatedAssetOperationMap[domain]).filter(([,native])=>native===op.op).map(([custom])=>custom);rows.push({domain,operation:op.op,group:op.group,upstream:op.available===false?'editor_required':'advertised',signature:op.signature,headless:op.available!==false,connection:connected[domain].includes(op.op)?'connected':assetVariants.length?'host_asset_adapter_connected':'pending',assetVariants,verification:'see_execution_evidence_not_inferred_from_connection',office2016:'native_verification_required'});}
}
for(const group of ['text','element','insert','table','slide','deck']){
 const file=`packages/pptx-ops/src/prompts/ops/${group}.md`,bytes=await readFile(join(source,'vendor/genoffice',file)),text=bytes.toString();sourceHashes[file]=sha(bytes);if(manifest.files[file]!==sourceHashes[file])throw Error('upstream_source_mismatch');
 for(const match of text.matchAll(/^### (\w+)([^\n]*)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)){
  const [,operation,flags,body]=match,signature=/`([^`]+)`/.exec(body)?.[1]??'';
  const assetVariants=Object.entries(generatedAssetOperationMap.powerpoint).filter(([,native])=>native===operation).map(([custom])=>custom);
  rows.push({domain:'powerpoint',operation,group,upstream:flags.includes('pending')?'pending_upstream':flags.includes('not-ai-callable')?'host_payload_required':'advertised',signature,headless:!flags.includes('pending'),connection:connected.powerpoint.includes(operation)?'connected':assetVariants.length?'host_asset_adapter_connected':'pending',assetVariants,verification:'see_execution_evidence_not_inferred_from_connection',office2016:operation==='addModel3d'?'version_gap_requires_confirmation':'native_verification_required'});
 }
}
const ids=new Set();for(const row of rows){const id=row.domain+':'+row.operation;if(ids.has(id))throw Error('duplicate_operation');ids.add(id);}
for(const row of rows){const host=hostContracts.find(h=>h.domain===row.domain&&h.op===row.operation);if(host){row.hostContract=host.requiredHost;row.connection=host.requiredHost==='bound_payload'?'host_payload_adapter_connected':'host_editor_adapter_connected';row.hostInjectionRequired=true;}}
const ppt=JSON.parse(await readFile(join(root,'eval/capabilities/slides.json')));for(const op of ppt.ops)if(!ids.has('powerpoint:'+op.op))throw Error('advertised_operation_missing');
const report={kind:'genoffice_full_operation_target',upstreamRevision:'438d9c65709952490c970beaa2599ef45e74431f',target:'Connect and verify all implemented GenOffice operations; retain editor/host and Office 2016 version gaps as explicit work items',claim:'Scope inventory only. Connected is not execution verified; not full Microsoft Office coverage.',sourceHashes,currentAdapterSha256:sha(implementation),summary:['word','excel','powerpoint'].map(domain=>({domain,total:rows.filter(r=>r.domain===domain).length,connected:rows.filter(r=>r.domain===domain&&r.connection==='connected').length,hostAdapterConnected:rows.filter(r=>r.domain===domain&&r.connection==='host_asset_adapter_connected').length,hostPayloadAdapterConnected:rows.filter(r=>r.domain===domain&&r.connection==='host_payload_adapter_connected').length,editorAdapterConnected:rows.filter(r=>r.domain===domain&&r.connection==='host_editor_adapter_connected').length,editorRequired:rows.filter(r=>r.domain===domain&&r.upstream==='editor_required').length,upstreamPending:rows.filter(r=>r.domain===domain&&r.upstream==='pending_upstream').length})),operations:rows};
await writeFile(join(root,'eval/capabilities/genoffice-parity-target.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
