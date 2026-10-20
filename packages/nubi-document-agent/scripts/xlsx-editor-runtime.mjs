// Host engine boundary for NEW plaintext drafts. The original package is always copied.
import {readFile,writeFile} from 'node:fs/promises';import {resolve,dirname,relative} from 'node:path';
import JSZip from 'jszip';import ExcelJS from 'exceljs';
import {trackFormulaErrors} from './univer-formula-results.mjs';
import {existingFunctionAliases,currencyStringFunction} from './univer-function-extensions.mjs';
import {type as osType,release as osRelease} from 'node:os';
import {normalizeExcelFormula} from './excel-formula-prefix.mjs';
import {etsFunctions} from './univer-ets-functions.mjs';
import {missingFunctions} from './univer-missing-functions.mjs';
import {pivotLookupFunction} from './univer-pivot-function.mjs';
const editorOps=new Set(['refresh_pivot','add_table_row','add_table_column','delete_table_row','delete_table_column','delete_table','edit_shape','delete_visual','convert_to_values']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),formula=normalizeExcelFormula,scalar=c=>c?.value??null;
export async function runEditorRequest(request,api){
 const allowed=process.env.GENOFFICE_ALLOWED_ROOTS,inside=p=>typeof p==='string'&&allowed&&!relative(resolve(allowed),resolve(p)).startsWith('..')&&dirname(resolve(p))===resolve(allowed);
 if(request.domain!=='excel'||!['read','apply','calculate'].includes(request.action)||!inside(request.path)||!inside(request.output)||!process.env.XLSX_SIDECAR_PATH)throw Error('editor_request_invalid');
 if(!Array.isArray(request.ops??[])||(request.ops??[]).length>100||(request.ops??[]).some(o=>!editorOps.has(o.op)))throw Error('editor_operation_unsupported');
 if((request.ops??[]).length>1)throw Error('editor_separate_batch_required');
 const bytes=await readFile(request.path),native=new api.XlsxSidecarClient(process.env.XLSX_SIDECAR_PATH);let u,typed;
 try{
  const metadata=await native.open(request.path,'en');
  // The sidecar initially publishes partial row indexes. Missing protection is
  // authoritative only after the whole worksheet has finished indexing.
  const protectionBySheet=new Map();for(const sheet of metadata.sheets){let range,deadline=performance.now()+10000;do{range=await native.readRange({sessionId:metadata.sessionId,sheetId:sheet.id,range:{startRow:0,endRow:0,startColumn:0,endColumn:0}});if(range.indexingComplete)break;await new Promise(r=>setTimeout(r,20));}while(performance.now()<deadline);if(!range.indexingComplete)throw Error('editor_indexing_timeout');protectionBySheet.set(sheet.id,range.sheetProtection??null);}
  if(request.action==='read')return{features:{sheets:metadata.sheets.map(s=>({id:s.id,name:s.name,tables:s.tables??[],pivotTables:s.pivotTables??[],sheetProtection:protectionBySheet.get(s.id)})),visuals:metadata.visuals}};
  const imported=await api.gateway.readBasicWorkbook(bytes),formats=new ExcelJS.Workbook();await formats.xlsx.load(bytes);
  const archive=await JSZip.loadAsync(bytes),pivots=[];for(const sheet of metadata.sheets)for(const p of sheet.pivotTables??[]){if(!p.cachePath)throw Error('editor_pivot_cache_missing');pivots.push({sheetId:sheet.id,path:p.path,area:api.parseRange(p.outputRef),definition:api.parsePivotDefinition(await archive.file(p.path).async('string'),await archive.file(p.cachePath).async('string'))});}
  let workbook;const {core}=api;u=new core.Univer({locale:core.LocaleType.EN_US,locales:{},logLevel:core.LogLevel.ERROR});u.registerPlugin(api.UniverFormulaEnginePlugin,{function:[...existingFunctionAliases(api.ALL_IMPLEMENTED_FUNCTIONS),...etsFunctions(api),...missingFunctions(api,{directory:dirname(request.path),numfile:imported.snapshot.sheets.length,origin:'$A:$A$1',osversion:osType()+' '+osRelease(),recalc:'Automatic',release:'Univer headless',system:process.platform==='darwin'?'mac':process.platform==='win32'?'pcdos':process.platform}),[currencyStringFunction(api),'DOLLAR'],[pivotLookupFunction(api,pivots,()=>workbook),'GETPIVOTDATA']]});u.registerPlugin(api.UniverSheetsPlugin);u.registerPlugin(api.UniverSheetsFormulaPlugin);
  const sheets={},sheetOrder=[];for(const sheet of imported.snapshot.sheets){sheetOrder.push(sheet.id);const cellData={};for(const [address,c]of Object.entries(sheet.cells)){const p=api.parseAddress(address);cellData[p.row]??={};cellData[p.row][p.column]=c.formula?{f:'='+formula(c.formula)}:{v:scalar(c)};}
   sheets[sheet.id]={id:sheet.id,name:sheet.name,rowCount:400,columnCount:20,cellData};}
  workbook=u.createUnit(core.UniverInstanceType.UNIVER_SHEET,{id:'draft',name:'Private draft',sheetOrder,sheets,styles:{}});const facade=api.FUniver.newAPI(u).getActiveWorkbook();
  typed=trackFormulaErrors(u.__getInjector().get(api.IFormulaRuntimeService));
  const settle=async()=>{const deadline=performance.now()+10000;while(performance.now()<deadline){let pending=false;for(const id of sheetOrder){const s=workbook.getSheetBySheetId(id);s.getCellMatrix().forValue((_r,_c,cell)=>{if(cell?.f&&cell.v===undefined)pending=true;});}if(!pending)return;await new Promise(r=>setTimeout(r,30));}throw Error('editor_calculation_timeout');};await settle();
  // The pivot helper reads actual calculated values; display formats come from
  // the same source XLSX, without relying on a viewport or DOM formatter.
  const sheetView=id=>{const s=facade.getSheetBySheetId(id);if(!s)return null;return new Proxy(s,{get(target,key){if(key!=='getRange')return typeof target[key]==='function'?target[key].bind(target):target[key];return(...args)=>{const range=target.getRange(...args);return new Proxy(range,{get(r,k){if(k==='getNumberFormats')return()=>Array.from({length:r.getHeight()},(_,ri)=>Array.from({length:r.getWidth()},(_,ci)=>formats.getWorksheet(target.getSheetName())?.getCell(r.getRow()+ri+1,r.getColumn()+ci+1).numFmt??''));return typeof r[k]==='function'?r[k].bind(r):r[k];}});};}});};
  const live={getSheetBySheetId:sheetView,getSheets:()=>sheetOrder.map(sheetView)},runtime={univerAPI:{getActiveWorkbook:()=>live}},journal=api.journal.createEditJournal(),state={file:{...metadata,date1904:formats.properties.date1904===true},editJournal:journal,pivotDefinitions:new Map(),formulaMode:true,flags:{preloadComplete:true}};
  const beforeTables=[];for(const s of metadata.sheets)for(const t of s.tables??[]){const table={sheetId:s.id,name:t.name,area:{...(typeof t.range==='object'?t.range:api.parseRange(t.range??t.ref))},columnNames:t.columns.map(c=>typeof c==='string'?c:c.name),style:t.style,bandedRows:t.showRowStripes??true};journal.tableAdds.push(table);beforeTables.push(structuredClone(table));}
  journal.visualAdds.push(...metadata.visuals.filter(v=>v.kind==='shape').map(v=>structuredClone(v)));const beforeVisuals=metadata.visuals.map(v=>structuredClone(v));
  for(const p of pivots)state.pivotDefinitions.set(p.path,p.definition);
  const structural=[],tableNames=new Set(),visualChanges=[],converted=[];
  for(const op of request.ops??[]){const sheet=metadata.sheets.find(s=>s.name===(op.sheet??metadata.sheets[0].name));if(!sheet)throw Error('editor_sheet_missing');const {sheet:ignoredSheet,...fields}=op;let input;try{input=api.parseWorkbookCommandBatch({dslVersion:1,transactionId:'private-editor',baseRevision:0,summary:'Private draft edit',operations:[{...fields,sheetId:sheet.id}]}).operations[0];}catch{throw Error('editor_operation_invalid');}
   if(protectionBySheet.get(sheet.id)?.protected)throw Error('editor_sheet_protected');
   const table=journal.tableAdds.find(t=>t.sheetId===sheet.id&&t.name.toLowerCase()===String(op.tableName).toLowerCase());
   if(op.op.includes('table')){
    if(!table)throw Error('editor_table_missing');const rowMode=op.op.includes('_row'),columnMode=op.op.includes('_column'),count=op.count??1,position=rowMode?op.row??table.area.endRow-table.area.startRow+1:op.column??table.columnNames.length+1,size=rowMode?table.area.endRow-table.area.startRow:table.columnNames.length,deleting=op.op.startsWith('delete_');
    if((rowMode||columnMode)&&(!Number.isInteger(count)||count<1||!Number.isInteger(position)||position<1||position>(deleting?size-count+1:size+1)||deleting&&size-count<1))throw Error('editor_table_bounds');
    if(op.op==='add_table_column'&&(typeof op.columnName!=='string'||!op.columnName.trim()||Array.from({length:count},(_,i)=>i?op.columnName+(i+1):op.columnName).some(n=>table.columnNames.some(v=>v.toLowerCase()===n.toLowerCase()))))throw Error('editor_table_column_duplicate');
    tableNames.add(sheet.id+':'+table.name);
    if(rowMode||columnMode){const index=rowMode?table.area.startRow+position:table.area.startColumn+position-1;if(rowMode&&metadata.sheets.find(s=>s.id===sheet.id)?.rowCount+count>400)throw Error('editor_bounds');structural.push({sheetName:sheet.name,ops:[{kind:(deleting?'remove-':'insert-')+(rowMode?'rows':'cols'),index,count}]});}
    if(columnMode&&!deleting&&sheet.columnCount+count>20)throw Error('editor_bounds');
    if(op.op==='add_table_row')api.applyAiTableRowAdd(runtime,state,input);else if(op.op==='delete_table_row')api.applyAiTableRowDelete(runtime,state,input);else if(op.op==='add_table_column')api.applyAiTableColumnAdd(runtime,state,input);else if(op.op==='delete_table_column')api.applyAiTableColumnDelete(runtime,state,input);else if(op.op==='delete_table')api.journal.removeTableAdd(journal,sheet.id,op.tableName);
   }else if(op.op==='refresh_pivot')api.refreshPivotTables({lazyWorkbookRef:{current:state},univerRef:{current:runtime},setPendingEdits(){}},sheet.id);
   else if(op.op==='edit_shape'){const before=journal.visualAdds.find(v=>v.id===op.visualId);if(!before)throw Error('editor_shape_missing');api.applyAiShapeEdit({},runtime,state,input);visualChanges.push({before,after:journal.visualAdds.find(v=>v.id===op.visualId),retext:op.text!==undefined});}
   else if(op.op==='delete_visual'){const before=beforeVisuals.find(v=>v.id===op.visualId||v.chartPath===op.visualId);if(!before)throw Error('editor_visual_missing');visualChanges.push({before,after:null});}
   else if(op.op==='convert_to_values'){const bounds=api.parseRange(op.range),s=workbook.getSheetBySheetId(sheet.id);for(let r=bounds.startRow;r<=bounds.endRow;r++)for(let c=bounds.startColumn;c<=bounds.endColumn;c++){const cell=s.getCellRaw(r,c);if(cell?.f){if(typed.errors.has(`${sheet.id}:${r}:${c}`))throw Error('editor_calculation_error');converted.push({sheetName:sheet.name,row:r,column:c,writeValue:true,cell:{value:cell.t===core.CellValueType.BOOLEAN?Boolean(cell.v):cell.v??null}});}}}
  }
  // Pivot lookups depend on the visible pivot body, beyond their anchor-cell
  // argument. Refresh the original layout binding and await applied results,
  // rather than treating the old non-null cache as a completed calculation.
  for(const p of pivots){p.definition=state.pivotDefinitions.get(p.path)??p.definition;p.area=api.parseRange(p.definition.outputRef);}
  if((request.ops??[]).length&&imported.snapshot.sheets.some(s=>Object.values(s.cells).some(c=>c.formula))){const formulaApi=api.FUniver.newAPI(u).getFormula();await new Promise((resolve,reject)=>{const subscription=formulaApi.calculationResultApplied(()=>{clearTimeout(timer);subscription.dispose();resolve();}),timer=setTimeout(()=>{subscription.dispose();reject(Error('editor_calculation_timeout'));},10000);formulaApi.executeCalculation();});}
  await settle();
  const tableEdits=beforeTables.filter(t=>tableNames.has(t.sheetId+':'+t.name)).map(t=>{const next=journal.tableAdds.find(v=>v.sheetId===t.sheetId&&v.name===t.name);return{sheetName:metadata.sheets.find(s=>s.id===t.sheetId).name,tableName:t.name,...(next?{area:next.area,columnNames:next.columnNames}:{remove:true})};});
  // First use the original structural saver; diff values against these final
  // coordinates so formulas/styles outside the target are not rewritten.
  const stage=await api.gateway.assembleWithJsZip(bytes,await api.gateway.planCellEditsToXlsx(await api.gateway.createBufferEntrySource(bytes),[],structural));const old=await api.gateway.readBasicWorkbook(stage.buffer),edits=[];
  for(const s of old.snapshot.sheets){const target=workbook.getSheetBySheetId(s.id);for(let r=0;r<400;r++)for(let c=0;c<20;c++){const actual=target.getCellRaw(r,c),prior=s.cells[String.fromCharCode(65+c)+(r+1)],af=formula(actual?.f),pf=formula(prior?.formula);if(af===pf&&(af||same(actual?.v??null,scalar(prior))))continue;edits.push({sheetName:s.name,row:r,column:c,writeValue:true,cell:{value:actual?.v??null,...(af?{formula:af}:{})}});}}
  const cached=sheetOrder.map(id=>{const s=workbook.getSheetBySheetId(id),cells=[];s.getCellMatrix().forValue((row,column,cell)=>{if(cell?.f){const error=typed.errors.get(`${id}:${row}:${column}`);cells.push({row,column,value:error?{error}:cell.t===core.CellValueType.BOOLEAN?Boolean(cell.v):cell.v??null});}});return{sheetName:s.getName(),cells};});
  const visualEdits=visualChanges.map(({before,after})=>({drawingPath:before.drawingPath,drawingIndex:before.drawingIndex,...(after?{anchor:after.anchor,fillColor:after.fillColor}:{remove:true})})),visualAdds=[];
  // The upstream planner loads sheet XML from edit targets; a cache-only
  // request needs a content-preserving touch to include each formula sheet.
  const cacheTouches=cached.filter(s=>s.cells.length).map(s=>({sheetName:s.sheetName,row:s.cells[0].row,column:s.cells[0].column,writeValue:false,cell:{value:null}}));
  const args=[await api.gateway.createBufferEntrySource(stage.buffer),[...cacheTouches,...edits,...converted],[],[],undefined,[],[],[],[],[],null,visualAdds,[],[],[],[],[...journal.pivotCacheRefresh],[...journal.pivotRefreshUpdates].map(([cachePath,v])=>({cachePath,sheetName:metadata.sheets.find(s=>s.id===v.sheetId).name,newOutputRef:v.newOutputRef})),visualEdits,[],cached,null,null,[],[],[],tableEdits];const plan=await api.gateway.planCellEditsToXlsx(...args),result=await api.gateway.assembleWithJsZip(stage.buffer,plan);let output=result.buffer;
  if(visualChanges.some(v=>v.after&&v.retext)){
   const zip=await JSZip.loadAsync(output),anchors=/<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
   for(const {before,after}of visualChanges.filter(v=>v.after&&v.retext)){
    const original=await archive.file(before.drawingPath).async('string'),slice=[...original.matchAll(anchors)][before.drawingIndex]?.[0],id=Number(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/.exec(slice??'')?.[1]);if(!id)throw Error('editor_shape_identity_missing');
    const body=/<xdr:txBody>[\s\S]*?<\/xdr:txBody>/.exec(api.shapeXml(id,{shapeType:after.shapeType,text:after.text??''},undefined))?.[0];if(!body)throw Error('editor_shape_body_missing');let changed=false;
    const xml=(await zip.file(before.drawingPath).async('string')).replace(anchors,part=>{if(!new RegExp('<xdr:cNvPr\\b[^>]*\\bid="'+id+'"').test(part))return part;changed=true;return /<xdr:txBody>/.test(part)?part.replace(/<xdr:txBody>[\s\S]*?<\/xdr:txBody>/,()=>body):part.replace('</xdr:sp>',body+'</xdr:sp>');});if(!changed)throw Error('editor_shape_identity_missing');zip.file(before.drawingPath,xml);
   }output=await zip.generateAsync({type:'nodebuffer'});
  }
  await writeFile(request.output,output,{mode:0o600});return{readback:{editorOperations:(request.ops??[]).map(o=>o.op),calculator:'Univer',formulaCells:cached.reduce((n,s)=>n+s.cells.length,0)},touchedEntries:[...stage.touchedEntries,...result.touchedEntries]};
 }finally{typed?.dispose();u?.dispose();native.stop();}
}
