import {writeFile} from 'node:fs/promises';

// Fixed Mac reference for the exact versioned synthetic task below. Updated
// only by recording a new local reference, never from the CI being judged.
export const ADMISSION_REFERENCE={
  "version": 1,
  "platform": "darwin",
  "arch": "arm64",
  "browser": "155.0.8059.85",
  "measuredAt": "2026-10-20T02:57:27.712Z",
  "measurements": {
    "440": {
      "durationMs": 15.299999952316284,
      "layoutMs": 13.5,
      "rows": 100,
      "cells": 700,
      "width": 440,
      "height": 5353
    },
    "1280": {
      "durationMs": 34.700000047683716,
      "layoutMs": 30.100000023841858,
      "rows": 100,
      "cells": 700,
      "width": 1280,
      "height": 5353
    }
  }
};

export function admissionBudget({measuredMs,referenceMs}){
 if(!Number.isFinite(measuredMs)||measuredMs<=0||!Number.isFinite(referenceMs)||referenceMs<=0)throw Error('admission_calibration_invalid');
 const ratio=measuredMs/referenceMs,scale=Math.max(1,Math.min(2,ratio));
 return {contractMs:300,measuredMs,referenceMs,ratio,scale,budgetMs:300*scale,status:ratio>2?'environment_unstable':'stable',exitCode:ratio>2?2:0};
}

export async function measureAdmissionReference(browser,width){
 const page=await browser.newPage({viewport:{width,height:900}});
 try{
  await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px system-ui,sans-serif}table{width:100%;table-layout:fixed;border-collapse:collapse}td,th{height:36px;padding:8px 12px;border-bottom:1px solid #eee;text-align:left;overflow:hidden;white-space:nowrap}</style><main id="shell"></main>');
  await page.evaluate(()=>document.fonts.ready);
  // Prepare an empty renderer, then render ONE identical 100-row table.
  // Include layout and the next presentation opportunity; retain all samples.
  return await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const start=performance.now(),table=document.createElement('table');
    const head=table.createTHead().insertRow();for(const text of ['선택','제목','보낸 사람','분류','받은 시각','첨부','상태']){const cell=document.createElement('th');cell.textContent=text;head.append(cell);}
    const body=table.createTBody();
    for(let row=0;row<100;row++){const line=body.insertRow();for(const text of ['□','합성 업무 '+row,'합성 보낸 사람 '+row,'업무','오늘 10:24','1개','확인 전'])line.insertCell().textContent=text;}
    document.querySelector('#shell').append(table);const bounds=table.getBoundingClientRect(),layoutMs=performance.now()-start;
    requestAnimationFrame(()=>resolve({durationMs:performance.now()-start,layoutMs,rows:body.rows.length,cells:body.querySelectorAll('td').length,width:bounds.width,height:bounds.height}));
  }))));
 }finally{await page.close();}
}

export async function calibrateAdmission(browser,{width,directory,name}){
 const measurement=await measureAdmissionReference(browser,width);
 if(measurement.rows!==100||measurement.cells!==700)throw Error('admission_reference_incomplete');
 const reference=ADMISSION_REFERENCE.measurements[width];
 const budget=admissionBudget({measuredMs:measurement.durationMs,referenceMs:reference?.durationMs});
 const result={...budget,width,name,measurement,reference:{...reference,version:ADMISSION_REFERENCE.version,platform:ADMISSION_REFERENCE.platform,measuredAt:ADMISSION_REFERENCE.measuredAt},browser:browser.version(),recordedAt:new Date().toISOString()};
 await writeFile(directory+'/calibration-'+width+'.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({scene:'admission-calibration',...result}));
 if(result.exitCode===2)throw Object.assign(Error('environment_unstable'),{code:'environment_unstable',calibration:result});
 return result;
}

export function admissionEnvironmentFailure(error){
 if(error?.code!=='environment_unstable')return false;
 process.exitCode=2;console.error('environment_unstable: synthetic reference exceeds 2x the fixed Mac baseline');return true;
}

export async function observeHistoryAdmission(page){
 await page.addInitScript(()=>{
  window.historyAdmission={records:[],firstAt:null,completeAt:null};
  document.addEventListener('DOMContentLoaded',()=>{
   const observer=new MutationObserver(()=>{
    const state=window.historyAdmission;if(state.completeAt!==null)return;
    const nodes=document.querySelectorAll('.nubi-message[data-message-key^="perf-"]');if(!nodes.length)return;
    const region=nodes[0].closest('.nubi-conversation-scroll');if(!region)return;
    const at=performance.now();state.firstAt??=at;state.records.push({at,count:nodes.length,busy:region.getAttribute('aria-busy')});
    if(nodes.length===40&&region.getAttribute('aria-busy')!=='true'){state.completeAt=at;observer.disconnect();}
   });observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-busy','data-admission']});
  });
 });
}
