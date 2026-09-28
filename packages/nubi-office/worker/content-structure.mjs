import {createHash} from 'node:crypto';
import {contentTextIncomplete,contentFieldIncomplete} from './content-integrity.mjs';
import {contentObservation} from './content-schema.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const inspectDocumentStructureTool={type:'function',function:{name:'inspect_document_structure',description:'Get a compact map of already read Word/PPT items: headings, fields, slides, editable targets and observed issues. No extra pages are read. Missing page offsets and truncated text remain unknown. Use returned pageOffset/itemId with read_document and read_document_text before editing. Cursor pages require the same viewId; this structure map is navigation, not full content or approval.',parameters:{type:'object',additionalProperties:false,properties:{filter:{type:'string',enum:['landmarks','all','editable','issues']},cursor:{type:'integer',minimum:0,maximum:2000},viewId:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}};
const clip=(value,size=120)=>typeof value==='string'?value.slice(0,size):undefined;
export function inspectDocumentStructure(pages,{filter='landmarks',cursor=0,viewId}={}){
  if(!['landmarks','all','editable','issues'].includes(filter)||!Number.isSafeInteger(cursor)||cursor<0||cursor>2000||cursor>0&&!/^[a-f0-9]{64}$/.test(viewId??''))throw new Error('tool_arguments_invalid');
  const ordered=[...pages.values()].sort((a,b)=>a.offset-b.offset),first=ordered[0];
  if(!first)throw new Error('source_not_read');
  const ids=new Set(),offsets=new Set(),items=[],counts={paragraphs:0,fields:0,slides:0,shapes:0,editable:0,tableParagraphs:0,textIncomplete:0,overflow:0};
  for(const page of ordered){
    contentObservation(page,first.host,first.scopeId,first.documentId);
    if(page.fingerprint!==first.fingerprint||page.total!==first.total||offsets.has(page.offset)||page.total>2000)throw new Error('observation_invalid');offsets.add(page.offset);
    for(const item of page.items){
      if(ids.has(item.id))throw new Error('observation_invalid');ids.add(item.id);
      const heading=item.kind==='paragraph'&&Number.isInteger(item.outlineLevel)&&item.outlineLevel>=1&&item.outlineLevel<=9;
      const label=heading?item.text:item.kind==='field'?item.title||item.tag:item.kind==='slide'?item.name||item.layout:item.kind==='shape'?item.name:undefined;
      const incomplete=contentTextIncomplete(item),issues=[...(incomplete?['text_incomplete']:[]),...(item.overflow===true?['text_overflow']:[])];
      const node={itemId:item.id,pageOffset:page.offset,kind:item.kind??'unknown',...(heading?{headingLevel:item.outlineLevel}:{}),...(label?{label:clip(label),labelTruncated:label.length>120}:{}),...(item.slideId?{slideId:clip(item.slideId,100)}:{}),...(Number.isInteger(item.index)?{slideIndex:item.index}:{}),editable:item.editable===true,issues};
      if(['text','notes'].some(field=>typeof item[field]==='string'))node.textFields=Object.fromEntries(['text','notes'].filter(field=>typeof item[field]==='string').map(field=>[field,{observedChars:item[field].length,totalChars:item[field+'Length']??(contentFieldIncomplete(item,field)?null:item[field].length)}]));
      if(Object.hasOwn(counts,item.kind+'s'))counts[item.kind+'s']++;
      if(item.editable===true)counts.editable++;if(item.inTable===true)counts.tableParagraphs++;if(incomplete)counts.textIncomplete++;if(item.overflow===true)counts.overflow++;
      if(filter==='all'||filter==='landmarks'&&(heading||['field','slide'].includes(item.kind))||filter==='editable'&&item.editable===true||filter==='issues'&&issues.length)items.push(node);
    }
  }
  const current=hash([first.host,first.scopeId,first.documentId,first.fingerprint,ordered,filter]);
  if(viewId!==undefined&&viewId!==current)throw new Error('source_changed');
  if(cursor>items.length)throw new Error('tool_arguments_invalid');
  const missingPageOffsets=[];for(let offset=0;offset<first.total;offset+=40)if(!offsets.has(offset))missingPageOffsets.push(offset);
  const rows=items.slice(cursor,cursor+40),result={kind:'document_structure',viewId:current,host:first.host,scopeId:first.scopeId,documentId:first.documentId,fingerprint:first.fingerprint,filter,cursor,nextCursor:cursor+rows.length<items.length?cursor+rows.length:null,matchedItems:items.length,counts,coverage:{observedItems:ids.size,totalItems:first.total,allItemsRead:ids.size===first.total&&missingPageOffsets.length===0,capturedTextComplete:counts.textIncomplete===0,missingPageOffsets},items:rows,instruction:'Observed structure only. Counts are for captured native items, not document pages or unique tables. Missing pages and incomplete text are unknown. Labels are excerpts, not full content. Use pageOffset/itemId to read exact evidence; editable flags never authorize an edit.'};
  // Budget serialized escaping, labels, identifiers and coverage metadata too.
  while(result.items.length&&JSON.stringify(result).length>14000)result.items.pop();
  if(items.length>cursor&&!result.items.length||JSON.stringify(result).length>14000)throw new Error('evidence_limit');
  result.nextCursor=cursor+result.items.length<items.length?cursor+result.items.length:null;
  return result;
}
