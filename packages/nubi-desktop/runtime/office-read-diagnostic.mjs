// Bounded native facts only. Never transport exception messages or file paths.
const stages=new Set(['prepare','activate','configure','open','read','verify','close','restore','release']);
export function officeReadDiagnostic(value){
 if(!value||typeof value!=='object')return null;
 const result={};
 if(stages.has(value.stage))result.stage=value.stage;
 if(['word','excel','powerpoint'].includes(value.app))result.app=value.app;
 if(typeof value.officeVersion==='string'&&/^\d{1,2}(?:\.\d{1,6}){1,3}$/.test(value.officeVersion))result.officeVersion=value.officeVersion;
 if(typeof value.hresult==='string'&&/^0x[\da-f]{8}$/i.test(value.hresult))result.hresult='0x'+value.hresult.slice(2).toUpperCase();
 if(value.cleanupFailed===true)result.cleanupFailed=true;
 return Object.keys(result).length?result:null;
}
