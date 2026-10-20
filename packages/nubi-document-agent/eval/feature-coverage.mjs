import {auditOperationCoverage} from './capability-coverage.mjs';
export function buildFeatureCoverage(catalogs,connected,report){
 const audit=auditOperationCoverage(catalogs),domains={word:'docs',excel:'sheets',powerpoint:'slides'},required=['independent_feature_readback','non_target_preservation','source_bytes_unchanged','reopen_readback'];
 const real=report?.kind==='real_file_feature_execution'&&report.finishedAt&&['wordExcel','slides'].every(k=>/^[a-f0-9]{64}$/.test(report.engineHashes?.[k]??''));
 for(const [domain,names]of Object.entries(connected))for(const op of names){
  const row=audit.operations.find(r=>r.domain===domains[domain]&&r.op===op);if(!row||row.availability==='headless_unavailable')throw Error('coverage_contract_invalid');
  const trials=(report?.trials??[]).filter(t=>t.domain===domain&&t.operation===op);
  row.connection='connected_file_engine';row.scope='new_unencrypted_draft';row.parameterCoverage='tested_cases_only';row.trials=trials.map(t=>({index:t.index,status:t.status}));
  const passed=real&&trials.length===3&&[1,2,3].every(i=>trials.some(t=>t.index===i&&t.status==='passed'&&t.operations?.includes(op)&&required.every(key=>t.verified?.includes(key))));
  row.evaluation=passed?'real_file_passed_3_of_3':real?'real_file_failed_or_incomplete':'not_evaluated';
 }
 return {...audit,kind:'module_file_operation_coverage',connectedCount:audit.operations.filter(o=>o.connection==='connected_file_engine').length,verifiedOperationCount:audit.operations.filter(o=>o.evaluation==='real_file_passed_3_of_3').length,actualOffice2016:false,nascaVerified:false};
}
