// Simulated replacement for native/Nubi.Office.EvalHost and the template parts
// of Nubi.Office.Host, for running the real worker with a real model where no
// Windows Excel exists. Payloads the MODEL can see match the native shapes; the
// simulation is declared only in init().host. Nothing here is Excel 2016, COM,
// NASCA or file I/O evidence.
import {basename} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createWorkbook,area} from './workbook.mjs';
import {createEngine,describe,validateTarget,fingerprint} from './engine.mjs';
import {OfficeFault,fault} from './fault.mjs';

const TEMPLATE_NAMESPACE='urn:nubi:office:template:1',PAGE=20;
const HOST={evaluationProtocol:4,platform:'simulated',simulated:true,calculator:'@ironcalc/nodejs',excel2016EditionVerified:false,note:'Simulated host: no Excel COM, rendering, file I/O or NASCA.'};
const clone=structuredClone;
const required=value=>typeof value==='string'&&value?value:fault('invalid_request');

// Port of ExcelTemplateStore.ValidateTemplateRecord.
function validateRecord(record){
  if(!record||typeof record!=='object'||Array.isArray(record))fault('template_record_invalid');
  if(record.schemaVersion!==1||!/^[a-f0-9-]{36}$/.test(record.id??'')||JSON.stringify(record).length>30000)fault('template_record_invalid');
  const profile=record.profile;if(!profile||typeof profile!=='object'||Array.isArray(profile))fault('template_record_invalid');
  const range=area(profile.address??'');
  if(range.rows*range.columns>1000||typeof profile.worksheet!=='string'||!profile.worksheet.trim()||!Array.isArray(profile.fields)||profile.fields.length<1||profile.fields.length>30)fault('template_record_invalid');
}

export function createSimHost(){
  const books=new Map(),discovered=new Map(),templates=new Map(),catalog=new Map(),savedPaths=new Set();
  let engine=null,active=null,activeSheet='',selected=null,selectionRange='A1:B2',auditRange='A1:F10',sources=[],copies=0;
  const open=book=>{books.set(book.documentId,book);return book;};
  const bookOf=state=>books.get(state.documentId)??fault('document_closed');
  const sheetNamed=(book,name)=>book.sheets.find(sheet=>sheet.name===name)??fault('document_closed');
  const select=(book,sheet,address)=>{selected={documentId:book.documentId,sheetId:sheetNamed(book,sheet).id,address};};
  const ready=()=>engine??fault('scope_expired');
  const checkOffset=offset=>{if(!Number.isInteger(offset)||offset<0||offset>100000)fault('invalid_request');};
  const page=(all,offset)=>{const items=all.slice(offset,offset+PAGE);return{items,offset,total:all.length,nextOffset:offset+items.length<all.length?offset+items.length:null};};
  function readSheet(anchor,sheetId){
    const book=bookOf(anchor);
    // Only sheets returned by a catalog read of THIS workbook may be read.
    if(discovered.get(sheetId)!==book.documentId)fault('out_of_scope');
    return{book,sheet:book.sheets.find(sheet=>sheet.id===sheetId)??fault('document_closed')};
  }
  const port={
    captureSelection(){if(!selected)fault('select_cells');return bookOf(selected).read(selected.sheetId,selected.address);},
    read:state=>bookOf(state).read(state.sheetId,state.address),
    write(state,patches){
      const book=bookOf(state),live=book.read(state.sheetId,state.address),origin=area(state.address);
      if(live.readOnly||live.protected)fault('workbook_not_writable');
      // Recheck live target metadata, including merge anchors, before mutation.
      for(const patch of patches)validateTarget(live,origin.row+patch.row,origin.column+patch.column,patch.field);
      book.write(state.sheetId,state.address,patches);
    },
    listSheets(anchor,offset){
      checkOffset(offset);const book=bookOf(anchor);
      for(const sheet of book.sheets)discovered.set(sheet.id,book.documentId);
      return{...page(book.sheets.map(sheet=>({sheetId:sheet.id,name:sheet.name,visibility:sheet.visibility,protected:sheet.protected})),offset),
        kind:'worksheet_catalog',documentId:anchor.documentId,workbook:book.name,readOnly:book.readOnly,date1904:book.date1904,calculationState:'xlDone'};
    },
    inspectSheet(anchor,sheetId,part,offset){
      checkOffset(offset);const {book,sheet}=readSheet(anchor,sheetId);
      const parts={tables:()=>sheet.tables.map(({name,address,showHeaders=true,showTotals=false})=>({name,address,showHeaders,showTotals})),charts:()=>[],pivots:()=>[],names:()=>[],
        layout:()=>[{usedRangeHint:book.usedRange(sheet.id),printArea:'',orientation:'xlPortrait',autoFilterMode:false,filterMode:false,hint:'UsedRange may include formatted empty cells. Read explicit bounded ranges; this is not a full cell scan.'}]};
      if(!Object.hasOwn(parts,part))fault('unsupported_operation');
      return{...page(parts[part](),offset),kind:'worksheet_structure',documentId:anchor.documentId,sheetId,worksheet:sheet.name,part};
    },
    readRange(anchor,sheetId,address){
      const range=area(address);if(range.rows*range.columns>1000)fault('range_limit');
      const {book}=readSheet(anchor,sheetId);
      return{...book.read(sheetId,address),documentId:anchor.documentId,workbook:anchor.workbook};
    }
  };
  function auditSources(){
    const snapshots=sources.map(source=>{select(active,source.name,source.auditRange);return ready().selection();});
    select(active,activeSheet,selectionRange);return snapshots;
  }
  function audit(p={}){select(active,activeSheet,p.range||auditRange);const result=ready().selection();select(active,activeSheet,selectionRange);return result;}
  function templateRecord(book){
    const parts=book.customXml.filter(part=>part.namespace===TEMPLATE_NAMESPACE);
    if(parts.length!==1)fault('template_record_invalid');
    validateRecord(parts[0].record);return clone(parts[0].record);
  }
  const templateScope=(book,record)=>book.read(sheetNamed(book,record.profile.worksheet).id,record.profile.address);
  const receipt={protectionMode:'nasca_excel_managed',nascaEncryptionVerified:false};
  const methods={
    init(p){
      if(p.mode==='document')fault('evaluation_mode_not_supported');
      books.clear();discovered.clear();selected=null;
      activeSheet=p.sheetName||'CaseSheet';sources=clone(p.sourceSheets||[]);selectionRange=p.range;auditRange=p.auditRange;
      active=open(createWorkbook({name:p.workbookName||'Book1.xlsx',sheets:[{name:activeSheet,cells:p.cells||{},merges:p.merges||[],protected:p.protected===true,hiddenRows:p.hiddenRows||[],hiddenColumns:p.hiddenColumns||[],tables:p.tables||[]},
        ...sources.map(source=>({name:source.name,cells:source.cells||{},merges:source.merges||[]}))]}));
      engine=createEngine(port);
      const before=audit();
      return{scope:engine.selection(),before,sourcesBefore:auditSources(),host:{...HOST}};
    },
    read:p=>ready().read(required(p.scopeId)),
    apply:p=>ready().apply(required(p.scopeId),p.operationId,p.plan&&typeof p.plan==='object'?p.plan:fault('invalid_plan')),
    reconcile:p=>ready().reconcile(required(p.scopeId),required(p.operationId),p.plan&&typeof p.plan==='object'?p.plan:fault('invalid_plan')),
    restore:p=>ready().restore(required(p.changeId)),
    history:()=>ready().history(),
    audit,auditSources,
    workbook_sheets:p=>ready().listSheets(required(p.scopeId),p.offset??0),
    workbook_structure:p=>ready().inspectSheet(required(p.scopeId),required(p.sheetId),required(p.part),p.offset??0),
    workbook_range:p=>ready().readWorkbookRange(required(p.scopeId),required(p.sheetId),required(p.address)),
    saveReopen(p){
      ready();const path=required(p.path);
      if(!/\.xlsx$/.test(path)||savedPaths.has(path))fault('invalid_artifact_path');
      savedPaths.add(path);books.delete(active.documentId);
      active=open(active.clone({name:basename(path),readOnly:true}));
      select(active,activeSheet,p.range||auditRange);return engine.selection();
    },
    template_register(p){
      const source=ready().boundState(required(p.scopeId),required(p.expectedFingerprint)),record=p.record;
      validateRecord(record);
      const original=bookOf(source);
      if(!/\.xlsx$/i.test(original.name))fault('template_format_unsupported');
      if(record.profile.worksheet!==source.worksheet||record.profile.address!==source.address)fault('template_record_invalid');
      const path=`/sim/templates/${record.id}.xlsx`,copy=original.clone({name:basename(path)});
      copy.customXml=[...copy.customXml.filter(part=>part.namespace!==TEMPLATE_NAMESPACE),{namespace:TEMPLATE_NAMESPACE,record:clone(record)}];
      // Reopen the saved copy to check that the record and the form persisted.
      const reopened=copy.clone({readOnly:true});
      if(!isDeepStrictEqual(templateRecord(reopened),record))fault('template_save_uncertain');
      if(fingerprint(port.read(source))!==fingerprint(source))fault('cells_changed');
      templates.set(record.id,{path,record:clone(record),book:copy});
      return{saved:true,id:record.id,path,metadataVerified:true,comparison:{before:describe(source),after:describe(templateScope(reopened,record))},...receipt};
    },
    template_catalog_list:()=>({host:'excel',entries:[...catalog.values()].map(entry=>clone(entry)),unreadable:0}),
    template_catalog_index(p){
      const candidate=templates.get(required(p.templateId))??fault('template_not_found'),{record,path}=candidate;
      if(!catalog.has(record.id)){const now=new Date().toISOString();
        catalog.set(record.id,{id:record.id,host:'excel',name:record.name.slice(0,100),summary:record.purpose.slice(0,3000),revision:1,createdAt:now,updatedAt:now,
          itemCount:record.profile.fields.length,inputCount:record.profile.fields.length,sourceFile:basename(path),available:true,protection:'windows_current_user'});}
      return{catalogued:true,id:record.id,entry:clone(catalog.get(record.id))};
    },
    template_catalog_use(p){
      const entry=catalog.get(required(p.templateId))??fault('template_not_found'),source=templates.get(entry.id).book,record=templateRecord(source);
      if(!isDeepStrictEqual(record,templates.get(entry.id).record))fault('template_source_changed');
      const before=templateScope(source,record),path=`/sim/documents/${++copies}-${source.name}`;
      const copy=open(source.clone({name:basename(path),readOnly:false}));
      if(!isDeepStrictEqual(templateRecord(copy),record))fault('template_record_invalid');
      active=copy;activeSheet=record.profile.worksheet;selectionRange=record.profile.address;auditRange=p.auditRange||record.profile.address;sources=[];
      engine??=createEngine(port);select(copy,activeSheet,selectionRange);
      // The caller receives a NEW scope bound to this copy, never the source.
      return{copied:true,record,path,comparison:{before:describe(before),after:describe(templateScope(copy,record))},...receipt,entry:clone(entry),scope:engine.selection()};
    }
  };
  return{
    async call(method,payload={}){
      if(!Object.hasOwn(methods,method))fault('unknown_method');
      return clone(methods[method](payload));
    },
    close(){books.clear();discovered.clear();engine=null;active=null;selected=null;}
  };
}

// Translates an agent host action into simulated native calls, as the task
// pane bridge and eval/run.mjs do. Expected rejections become {error:code}.
export async function hostAction(host,action){
  const {name,scopeId,payload={}}=action;
  const request=['workbook_sheets','workbook_structure','workbook_range'].includes(name)?[name,{...payload,scopeId}]
    :name==='reconcile_changes'?['reconcile',{scopeId,...payload}]
    :name==='restore_change'?['restore',payload]
    :name==='apply_changes'?['apply',{scopeId,operationId:action.callId,plan:action.plan}]
    :['read_selection','verify_selection'].includes(name)?['read',{scopeId}]
    :name==='template_register'?['template_register',{scopeId,...payload}]
    :name==='template_catalog_index'?['template_catalog_index',payload]
    :name==='template_catalog_list'?['template_catalog_list',{}]
    :name==='template_catalog_use'?['template_catalog_use',payload]
    :null;
  if(!request)throw new Error('evaluation_action_not_supported');
  try{return await host.call(...request);}
  catch(error){if(error instanceof OfficeFault)return{error:error.code};throw error;}
}
