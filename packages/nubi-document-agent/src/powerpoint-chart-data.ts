import {XMLParser} from 'fast-xml-parser';import {inspectPackage} from './generated-package.js';import {fail} from './contracts.js';import {createExcelDocument} from './excel.js';
type Node=Record<string,any>;const array=(x:any):Node[]=>x===undefined?[]:Array.isArray(x)?x:[x];
/** Attach real embedded data to new GenOffice bar charts that only supplied Sheet1 references/caches. */
export async function attachGeneratedPowerPointChartWorkbooks(bytes:Uint8Array,signal:AbortSignal,options:{fontFamily?:string}={}){
 if(signal.aborted)fail('operation_cancelled');const pkg=await inspectPackage(bytes,'powerpoint');if(pkg.hasMacros||pkg.hasExternalRelationships)fail('file_active_content_unsupported');
 const paths=Object.keys(pkg.zip.files).filter(p=>/^ppt\/charts\/chart[1-9]\d{0,2}\.xml$/.test(p));if(paths.length>20)fail('chart_binding_invalid');const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false});
 for(const path of paths){
  let xml=await pkg.zip.file(path)!.async('string');if(/<c:externalData\b/.test(xml))fail('chart_workbook_already_bound');
  const chart=parser.parse(xml)['c:chartSpace']['c:chart'],series=array((chart['c:plotArea']?.['c:barChart']??chart['c:plotArea']?.['c:lineChart'])?.['c:ser']);if(!series.length)fail('chart_binding_unsupported');
  const points=(cache:Node)=>array(cache?.['c:pt']).map((p,i)=>{if(Number(p['@_idx'])!==i)fail('chart_binding_invalid');return String(p['c:v']);});
  const categories=points(series[0]['c:cat']?.['c:strRef']?.['c:strCache']);if(!categories.length||categories.length>399)fail('chart_binding_invalid');
  const names:string[]=[],columns:number[][]=[];
  for(const [i,s]of series.entries()){
   const col=String.fromCharCode(66+i),tx=s['c:tx']?.['c:strRef'],cat=s['c:cat']?.['c:strRef'],val=s['c:val']?.['c:numRef'];
   if(i>=19||tx?.['c:f']!==`Sheet1!$${col}$1`||cat?.['c:f']!==`Sheet1!$A$2:$A$${categories.length+1}`||val?.['c:f']!==`Sheet1!$${col}$2:$${col}$${categories.length+1}`)fail('chart_binding_unsupported');
   const name=points(tx['c:strCache'])[0];if(!name)fail('chart_binding_invalid');names.push(name);
   if(JSON.stringify(points(cat['c:strCache']))!==JSON.stringify(categories))fail('chart_binding_invalid');
   const numbers=points(val['c:numCache']).map(Number);if(numbers.length!==categories.length||numbers.some(v=>!Number.isFinite(v)))fail('chart_binding_invalid');columns.push(numbers);
  }
  const cell=(value:string|number,role:'header'|'body')=>({value,formula:null,format:'general' as const,role});
  const rows=[['구분',...names].map(v=>cell(v,'header')),...categories.map((v,i)=>[cell(v,'body'),...columns.map(c=>cell(c[i]!,'body'))])];
  const workbook=await createExcelDocument({title:'Chart data',sheets:[{name:'Sheet1',columnWidths:Array(names.length+1).fill(18),rows}]},signal,options);
  const number=path.match(/chart(\d+)/)![1],embedding=`ppt/embeddings/NubiChartData${number}.xlsx`,relpath=`ppt/charts/_rels/chart${number}.xml.rels`;if(pkg.zip.file(embedding)||pkg.zip.file(relpath))fail('chart_binding_invalid');
  // A nonnegative bar chart must have a zero baseline; an automatic truncated axis exaggerates differences.
  if(chart['c:plotArea']?.['c:barChart']&&columns.flat().every(v=>v>=0))xml=xml.replace(/(<c:valAx\b[^>]*>[\s\S]*?<c:scaling>)([\s\S]*?)(<\/c:scaling>)/g,(_all,a,b,c)=>a+b.replace(/<c:min\b[^>]*\/>/g,'')+'<c:min val="0"/>'+c);
  // LibreOffice renders negative cached bars above zero when this default is
  // implicit. Pin the normal fill policy without changing signed chart data.
  if(chart['c:plotArea']?.['c:barChart'])xml=xml.replace(/<c:ser\b[^>]*>[\s\S]*?<\/c:ser>/g,ser=>{
   if(/<c:invertIfNegative\b/.test(ser))return ser;
   const flag='<c:invertIfNegative val="0"/>';
   if(/<c:spPr\b/.test(ser))return ser.replace(/(<c:spPr\b[^>]*\/>|<c:spPr\b[^>]*>[\s\S]*?<\/c:spPr>)/,part=>part+flag);
   return ser.replace(/<(c:cat|c:val)\b/,flag+'<$1');
  });
  // Keep category names away from negative bars crossing the zero axis.
  if(chart['c:plotArea']?.['c:barChart']&&columns.flat().some(v=>v<0))xml=xml.replace(/<c:catAx\b[^>]*>[\s\S]*?<\/c:catAx>/g,axis=>/<c:tickLblPos\b/.test(axis)?axis:axis.replace(/<(c:crossAx|c:crosses|c:crossesAt)\b|<\/c:catAx>/,tag=>'<c:tickLblPos val="low"/>'+tag));
  pkg.zip.file(embedding,workbook.bytes);pkg.zip.file(relpath,`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdNubiData" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/NubiChartData${number}.xlsx"/></Relationships>`);
  const font=options.fontFamily??'Malgun Gothic',fontXml=font.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  xml=xml.replace('</c:chartSpace>',`<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"><a:latin typeface="${fontXml}"/><a:ea typeface="${fontXml}"/></a:defRPr></a:pPr><a:endParaRPr lang="ko-KR"/></a:p></c:txPr><c:externalData r:id="rIdNubiData"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`);pkg.zip.file(path,xml);
 }
 let types=await pkg.zip.file('[Content_Types].xml')!.async('string');if(paths.length&&!/Extension="xlsx"/.test(types))types=types.replace('</Types>','<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/></Types>');pkg.zip.file('[Content_Types].xml',types);
 const result=await pkg.zip.generateAsync({type:'uint8array',compression:'DEFLATE'});if(signal.aborted)fail('operation_cancelled');return result;
}
