import ExcelJS from 'exceljs';
import {inspectPackage} from './generated-package.js';import {fail} from './contracts.js';
export interface GeneratedChartBinding {chartPart:string;sheet:string;categoryRange:string;series:Array<{name:string;range:string}>}
/** Correct explicit column bindings on an existing native chart in a NEW plaintext draft.
 * Cached values must come from a real calculation engine; this helper never calculates or invents them.
 */
export async function bindGeneratedExcelChart(bytes:Uint8Array,binding:GeneratedChartBinding,signal:AbortSignal){
 if(signal.aborted)fail('operation_cancelled');
 if(!binding||!/^xl\/charts\/chart[1-9]\d{0,2}\.xml$/.test(binding.chartPart)||typeof binding.sheet!=='string'||/[\[\]'!]/.test(binding.sheet)||!Array.isArray(binding.series)||!binding.series.length||binding.series.length>20)fail('chart_binding_invalid');
 const pkg=await inspectPackage(bytes,'excel');if(pkg.hasMacros||pkg.hasExternalRelationships)fail('file_active_content_unsupported');
 const part=pkg.zip.file(binding.chartPart);if(!part)fail('chart_binding_invalid');
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);const sheet=book.getWorksheet(binding.sheet);if(!sheet)fail('chart_binding_invalid');
 const xml=(v:unknown)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const values=(range:string)=>{const m=/^([A-T])([1-9]\d{0,2}):\1([1-9]\d{0,2})$/.exec(range);if(!m)fail('chart_binding_invalid');const from=Number(m![2]),to=Number(m![3]);if(to<from||to>400||to-from>399)fail('chart_binding_invalid');const out=[];
  for(let r=from;r<=to;r++){const cell=sheet!.getCell(m![1]+r),v=cell.formula?cell.result:cell.value;if(v===null||v===undefined||typeof v!=='string'&&typeof v!=='number'||typeof v==='number'&&!Number.isFinite(v))fail('chart_calculation_required');out.push(v);}return out;};
 const formula=(range:string)=>xml(`'${binding.sheet}'!`+range.replace(/([A-T])(\d+)/g,'$$$1$$$2'));
 const categories=values(binding.categoryRange),points=(items:unknown[])=>`<c:ptCount val="${items.length}"/>`+items.map((v,i)=>`<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join('');
 const colors=['3182F6','72B8B5','E9B65D'];
 const series=binding.series.map((spec,i)=>{if(typeof spec.name!=='string'||!spec.name.length||spec.name.length>100)fail('chart_binding_invalid');const data=values(spec.range);if(data.length!==categories.length||data.some(v=>typeof v!=='number'))fail('chart_binding_invalid');
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xml(spec.name)}</c:v></c:tx><c:spPr><a:solidFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="${colors[i%colors.length]}"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>${formula(binding.categoryRange)}</c:f><c:strCache>${points(categories)}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${formula(spec.range)}</c:f><c:numCache><c:formatCode>#,##0.00</c:formatCode>${points(data)}</c:numCache></c:numRef></c:val></c:ser>`;}).join('');
 const source=await part.async('string');if(!/<c:barChart\b/.test(source)||!/<c:ser>/.test(source)||/<c:(?:lineChart|pieChart|scatterChart)\b/.test(source))fail('chart_binding_unsupported');
 let first=true;pkg.zip.file(binding.chartPart,source.replace(/<c:ser>[\s\S]*?<\/c:ser>/g,()=>{if(!first)return '';first=false;return series;}));
 const result=await pkg.zip.generateAsync({type:'uint8array',compression:'DEFLATE'});if(signal.aborted)fail('operation_cancelled');return result;
}
