// Synthetic wire-size fixture only. This is not a live-model accuracy benchmark.
import {compactMessages} from '../worker/model-context.mjs';
export function contextFixture(){
 const grid=v=>Array.from({length:60},()=>Array.from({length:10},()=>structuredClone(v)));
 return{documentId:'fixture',worksheet:'Sheet1',address:'A1:J60',fingerprint:'fixture-only',values:grid(null),formulas:grid(null),errors:grid(false),formats:{fontName:grid('맑은 고딕'),fontSize:grid(11),fontColor:grid('#000000'),fillColor:grid(null),bold:grid(false),italic:grid(false),wrapText:grid(false),horizontalAlignment:grid('general'),verticalAlignment:grid('bottom'),numberFormat:grid('General')},properties:{locked:grid(true),mergedAddress:grid(null),arrayFormula:grid(false),validation:grid(null),rowHeight:grid(18),columnWidth:grid(12),hiddenRow:grid(false),hiddenColumn:grid(false)}};
}
export function contextMeasurement(){
 const messages=[{role:'system',content:'Inspect Excel observations.'},{role:'user',content:JSON.stringify({snapshot:contextFixture()})}],metrics={};compactMessages(messages,metrics);
 const {originalChars,sentChars}=metrics.modelContext;return{unit:'JSON characters',cells:600,originalChars,sentChars,savedPercent:Math.round(10000*(1-sentChars/originalChars))/100};
}
