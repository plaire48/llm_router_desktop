/** Catalog inventory only. A draft field or a source export is not an executed named operation. */
export function auditOperationCoverage(catalogs){
  const bad=()=>{throw Error('catalog_invalid');},seen=new Set(),operations=[],domains=[];
  if(!Array.isArray(catalogs)||!catalogs.length)bad();
  for(const catalog of catalogs){
    if(!['docs','sheets','slides'].includes(catalog?.domain)||seen.has(catalog.domain)||typeof catalog.fingerprint!=='string'||!Array.isArray(catalog.ops)||!Array.isArray(catalog.groups))bad();
    seen.add(catalog.domain);const names=new Set(),membership=new Map(),groups=new Set();
    for(const group of catalog.groups){
      if(typeof group.name!=='string'||groups.has(group.name)||!Array.isArray(group.ops))bad();groups.add(group.name);
      for(const name of group.ops){if(typeof name!=='string'||membership.has(name))bad();membership.set(name,group.name);}
    }
    for(const op of catalog.ops){
      if(typeof op.op!=='string'||names.has(op.op)||membership.get(op.op)!==op.group)bad();names.add(op.op);
      operations.push({domain:catalog.domain,op:op.op,group:op.group,availability:op.available===false?'headless_unavailable':'advertised_by_upstream',connection:'not_connected_as_named_operation',evaluation:'not_evaluated',nativeVerified:false});
    }
    if(membership.size!==names.size)bad();
    domains.push({domain:catalog.domain,fingerprint:catalog.fingerprint,operationCount:names.size,headlessUnavailable:catalog.ops.filter(op=>op.available===false).length,groups:catalog.groups.map(g=>({name:g.name,count:g.ops.length}))});
  }
  return {schemaVersion:1,kind:'upstream_operation_inventory',generalOfficeQualityMeasured:false,claim:'Upstream operation names only; not Microsoft Office API coverage, module feature coverage, host-enabled operations or execution results.',domains,operations};
}
