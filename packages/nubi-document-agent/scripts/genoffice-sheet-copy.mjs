import JSZip from'jszip';import{XMLParser}from'fast-xml-parser';
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false}),arr=x=>x===undefined?[]:Array.isArray(x)?x:[x],esc=x=>String(x).replaceAll('&','&amp;').replaceAll("'",'&apos;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
/** Extend the existing writer's simple-sheet duplication for its generated print names only.
 * Drawings/tables/pivots and user-defined local names still use the engine's own refusal.
 * The original bytes never change; restore both source and cloned print scopes before readback.
 */
export async function preparePrintNameCopy(bytes,ops){
 const unchanged={bytes,restore:async output=>output};if(ops?.length!==1||ops[0].op!=='duplicate_sheet')return unchanged;
 const z=await JSZip.loadAsync(bytes),xml=await z.file('xl/workbook.xml').async('string'),sheets=arr(parser.parse(xml).workbook.sheets.sheet),source=String(ops[0].sheet??sheets[0]?.['@_name']),index=sheets.findIndex(s=>s['@_name']===source);if(index<0)return unchanged;
 const names=[...xml.matchAll(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g)].filter(m=>new RegExp('\\blocalSheetId="'+index+'"').test(m[0])).map(m=>m[0]);
 if(!names.length||names.some(x=>!/^_xlnm\.Print_(Area|Titles)$/.test(parser.parse(x).definedName['@_name'])))return unchanged;
 let stripped=xml;for(const name of names)stripped=stripped.replace(name,'');z.file('xl/workbook.xml',stripped);
 return{bytes:new Uint8Array(await z.generateAsync({type:'uint8array'})),async restore(output){
  const result=await JSZip.loadAsync(output),workbook=await result.file('xl/workbook.xml').async('string'),after=arr(parser.parse(workbook).workbook.sheets.sheet),clone=ops[0].name??after.find(s=>!sheets.some(old=>old['@_name']===s['@_name']))?.['@_name'];if(!clone)throw Error('file_copy_scope_missing');
  const sourceIndex=after.findIndex(s=>s['@_name']===source),copyIndex=after.findIndex(s=>s['@_name']===clone);if(sourceIndex<0||copyIndex<0)throw Error('file_copy_scope_missing');
  const quoted=name=>esc("'"+name.replaceAll("'","''")+"'!");
  const sourceNames=names.map(x=>x.replace(/localSheetId="\d+"/,'localSheetId="'+sourceIndex+'"'));
  const copyNames=names.map(x=>x.replace(/localSheetId="\d+"/,'localSheetId="'+copyIndex+'"').replaceAll(quoted(source),quoted(clone)).replaceAll("'"+esc(source).replaceAll("'","''")+"'!","'"+esc(clone).replaceAll("'","''")+"'!"));
  const insert=sourceNames.join('')+copyNames.join('');result.file('xl/workbook.xml',workbook.includes('</definedNames>')?workbook.replace('</definedNames>',insert+'</definedNames>'):workbook.replace('</workbook>','<definedNames>'+insert+'</definedNames></workbook>'));return new Uint8Array(await result.generateAsync({type:'uint8array'}));
 }};
}
