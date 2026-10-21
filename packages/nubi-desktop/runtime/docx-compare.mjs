// Before/after comparison of a form copy for the existing Office change viewer (document forms, §8 답 33): the same
// block shape `NativeDocumentPreview` already renders for Word (paragraph and table blocks with `changed`, the
// before blocks found by id), built from two docx snapshots instead of a live Office observation. Paragraphs are
// aligned by text so an inserted paragraph does not make every later one look changed; cells align by their place.
import {docxParts,parseXml,snapshotParts,findFirst,firstNamed} from './docx-snapshot.mjs';

// Header and footer text of a docx, part by part, so the viewer shows them beside the body (사용자 지적 2026-10-21: 머리글 반영).
async function headerFooterTexts(zip){
  const out={headers:[],footers:[]};
  for(const name of Object.keys(zip.files).filter(n=>/^word\/(header|footer)\d*\.xml$/.test(n)).sort()){
    const xml=await zip.file(name).async('string'),text=[...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(p=>[...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('')).join('\n');
    (name.includes('header')?out.headers:out.footers).push({part:name.slice(5),text});
  }
  return out;
}

const points=value=>value===undefined||value===null||value===''?null:Math.round(Number(value)/20);
function pageOf(document){
  const body=findFirst(parseXml(document),'w:body'),sectPr=body?[...body.children].reverse().find(child=>typeof child==='object'&&child?.name==='w:sectPr'):null;
  const size=sectPr&&firstNamed(sectPr,'w:pgSz'),margin=sectPr&&firstNamed(sectPr,'w:pgMar');
  return {width:points(size?.attrs['w:w'])??595,height:points(size?.attrs['w:h'])??842,TopMargin:points(margin?.attrs['w:top'])??72,BottomMargin:points(margin?.attrs['w:bottom'])??72,LeftMargin:points(margin?.attrs['w:left'])??72,RightMargin:points(margin?.attrs['w:right'])??72,changed:false};
}
// Longest common subsequence of two text lists: pairs of matching indexes in order.
export function align(a,b){
  const n=a.length,m=b.length,table=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)table[i][j]=a[i]===b[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
  const pairs=[];let i=0,j=0;
  while(i<n&&j<m){if(a[i]===b[j]){pairs.push([i,j]);i++;j++;}else if(table[i+1][j]>=table[i][j+1])i++;else j++;}
  return pairs;
}
const paragraphBlock=(id,item,changed,extra={})=>({id,kind:'paragraph',text:item.text,style:{name:item.style,outlineLevel:item.outlineLevel,...(item.listString?{listString:item.listString}:{})},changed,...extra});
function tableBlocks(items,changedCells,cellTextBefore){
  const tables=new Map();
  for(const item of items.filter(x=>x.kind==='cell')){
    if(!tables.has(item.table))tables.set(item.table,{id:'table-'+item.table,kind:'table',index:item.table,cells:[],changed:false});
    const table=tables.get(item.table),changed=changedCells.has(item.id);
    table.cells.push({row:item.row,col:item.column,text:item.text,changed,...(changed&&cellTextBefore?{before:cellTextBefore.get(item.id)??null}:{}),target:item.id});
    if(changed)table.changed=true;
  }
  return [...tables.values()];
}
/** The comparison DTO: {app, before:{blocks,page}, after:{blocks,page}, changes, counts}. */
export async function compareDocx(beforeBytes,afterBytes,{name='양식.docx'}={}){
  const [beforeParts,afterParts]=await Promise.all([docxParts(beforeBytes),docxParts(afterBytes)]);
  const before=snapshotParts(beforeParts,{name}).items,after=snapshotParts(afterParts,{name}).items;
  const beforeParagraphs=before.filter(x=>x.kind==='paragraph'),afterParagraphs=after.filter(x=>x.kind==='paragraph');
  // Equal texts pair up; between two pairs, the leftover paragraphs pair in order as changed, the rest are inserted
  // or removed. A changed paragraph keeps its before id so the viewer can show the old text under it.
  const pairs=align(beforeParagraphs.map(p=>p.text),afterParagraphs.map(p=>p.text));
  const afterBlocks=[],beforeBlocks=[],changes=[];let bi=0,ai=0;
  const between=(bEnd,aEnd)=>{
    while(bi<bEnd||ai<aEnd){
      if(bi<bEnd&&ai<aEnd){const old=beforeParagraphs[bi],now=afterParagraphs[ai];const id=old.id;afterBlocks.push(paragraphBlock(id,now,true,{before:old.text,target:now.id}));beforeBlocks.push(paragraphBlock(id,old,false));changes.push({id,kind:'paragraph',title:`문단 ${now.id.slice(2)}`,before:old.text,after:now.text,change:'changed'});bi++;ai++;}
      else if(ai<aEnd){const now=afterParagraphs[ai];const id='inserted-'+now.id;afterBlocks.push(paragraphBlock(id,now,true,{target:now.id}));changes.push({id,kind:'paragraph',title:`문단 ${now.id.slice(2)} (새 문단)`,before:null,after:now.text,change:'inserted'});ai++;}
      else{const old=beforeParagraphs[bi];beforeBlocks.push(paragraphBlock(old.id,old,false));changes.push({id:old.id,kind:'paragraph',title:`문단 ${old.id.slice(2)} (지움)`,before:old.text,after:null,change:'removed'});bi++;}
    }
  };
  for(const [b,a] of pairs){between(b,a);const old=beforeParagraphs[b],now=afterParagraphs[a];afterBlocks.push(paragraphBlock(old.id,now,false,{target:now.id}));beforeBlocks.push(paragraphBlock(old.id,old,false));bi=b+1;ai=a+1;}
  between(beforeParagraphs.length,afterParagraphs.length);
  // Cells align by their place in the table; a filled cell is changed, and the viewer gets its old text.
  const beforeCells=new Map(before.filter(x=>x.kind==='cell').map(x=>[x.id,x.text])),changedCells=new Set();
  for(const cell of after.filter(x=>x.kind==='cell'))if(beforeCells.has(cell.id)?beforeCells.get(cell.id)!==cell.text:cell.text)changedCells.add(cell.id);
  for(const id of changedCells){const old=beforeCells.get(id)??null,now=after.find(x=>x.id===id);const [t,r,c]=id.split('/');changes.push({id,kind:'cell',title:`표 ${t.slice(1)} (${r.slice(1)}, ${c.slice(1)})`,before:old,after:now.text,change:old===null?'inserted':'changed'});}
  // Document order: tables sit where their first cell is; the viewer lays blocks out in this order.
  const order=items=>{const out=[];let seenTables=new Set();for(const item of items){if(item.kind==='paragraph')out.push({kind:'paragraph',id:item.id});else if(item.kind==='cell'&&!seenTables.has(item.table)){seenTables.add(item.table);out.push({kind:'table',id:'table-'+item.table});}}return out;};
  const afterTables=new Map(tableBlocks(after,changedCells,beforeCells).map(block=>[block.id,block])),beforeTables=new Map(tableBlocks(before,new Set(),null).map(block=>[block.id,block]));
  const afterById=new Map(afterBlocks.map(block=>[block.target,block])),beforeById=new Map(beforeBlocks.map(block=>[block.id,block]));
  const afterOrdered=order(after).map(entry=>entry.kind==='table'?afterTables.get(entry.id):afterById.get(entry.id)).filter(Boolean);
  const beforeOrdered=order(before).map(entry=>entry.kind==='table'?beforeTables.get(entry.id):beforeById.get(entry.id)).filter(Boolean);
  const page=pageOf(afterParts.document),[beforeHF,afterHF]=await Promise.all([headerFooterTexts(beforeParts.zip),headerFooterTexts(afterParts.zip)]);
  const marked=(list,old)=>list.map(item=>({...item,changed:(old.find(o=>o.part===item.part)?.text??null)!==item.text}));
  return {app:'word',before:{blocks:beforeOrdered,page:pageOf(beforeParts.document),headers:beforeHF.headers,footers:beforeHF.footers},after:{blocks:afterOrdered,page:{...page,changed:changes.length>0},headers:marked(afterHF.headers,beforeHF.headers),footers:marked(afterHF.footers,beforeHF.footers)},changes,
    counts:{changedParagraphs:changes.filter(c=>c.kind==='paragraph'&&c.change==='changed').length,insertedParagraphs:changes.filter(c=>c.change==='inserted'&&c.kind==='paragraph').length,removedParagraphs:changes.filter(c=>c.change==='removed').length,changedCells:changes.filter(c=>c.kind==='cell').length}};
}
