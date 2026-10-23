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
 if(['idle','overall'].includes(value.timeoutKind))result.timeoutKind=value.timeoutKind;
 if(Number.isSafeInteger(value.elapsedMs)&&value.elapsedMs>=0&&value.elapsedMs<=86400000)result.elapsedMs=value.elapsedMs;
 if(['cells','slides','characters'].includes(value.unit)&&Number.isSafeInteger(value.completed)&&Number.isSafeInteger(value.total)&&value.completed>=0&&value.total>0&&value.completed<=value.total&&value.total<=8000000){result.unit=value.unit;result.completed=value.completed;result.total=value.total;}
 if(Number.isSafeInteger(value.sheetIndex)&&Number.isSafeInteger(value.sheetCount)&&value.sheetIndex>0&&value.sheetIndex<=value.sheetCount&&value.sheetCount<=200){result.sheetIndex=value.sheetIndex;result.sheetCount=value.sheetCount;}
 return Object.keys(result).length?result:null;
}
