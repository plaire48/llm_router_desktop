// In-place writes to a docx copy (document forms plan Task D, 2026-10-21): the operations the Office fill planner
// (form-apply.mjs nextOperation) emits for a Word host, applied to word/document.xml by replacing only the element
// each one touches. Every other byte of the XML and every other zip entry stay as they were. After each write the
// document is read again and the receipt carries the same checks the Office host reports (content, format kept, the
// rest of the document untouched), so applyFill stops on anything unexpected.
import JSZip from 'jszip';
import {createHash} from 'node:crypto';
import {parseXml,snapshotParts,docxParts} from './docx-snapshot.mjs';
import {align} from './docx-compare.mjs';
import {fail} from './files.mjs';

const refuse=code=>{throw new Error(code);};
const escape=text=>String(text??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const isElement=node=>typeof node==='object'&&node!==null;
const children=(node,name)=>node.children.filter(child=>isElement(child)&&child.name===name);
const first=(node,name)=>node.children.find(child=>isElement(child)&&child.name===name)??null;
const slice=(xml,node)=>xml.slice(node.start,node.end);
const openTag=(xml,node)=>xml.slice(node.start,xml.indexOf('>',node.start)+1);
const closeTag=name=>`</${name}>`;
const findAll=(node,name,out=[])=>{for(const child of node.children){if(!isElement(child))continue;if(child.name===name)out.push(child);else findAll(child,name,out);}return out;};

/** One run: the text as the reader sees it; the rPr XML kept verbatim. */
function runOf(xml,run){
  let text='';
  const walk=node=>{for(const child of node.children){if(!isElement(child))continue;if(child.name==='w:t')text+=child.children.filter(x=>typeof x==='string').join('');else if(child.name==='w:tab')text+='\t';else if(child.name==='w:br'||child.name==='w:cr')text+='\n';else if(child.name==='w:noBreakHyphen')text+='-';else if(child.name!=='w:rPr'&&child.name!=='w:delText')walk(child);}};
  walk(run);const rPr=first(run,'w:rPr');
  return {text,rPr:rPr?slice(xml,rPr):''};
}
// Runs in reading order (through hyperlinks and simple fields), as the reader counts them.
function runsOf(xml,node,out=[]){
  for(const child of node.children){
    if(!isElement(child))continue;
    if(child.name==='w:r'){const run=runOf(xml,child);if(run.text)out.push(run);continue;}
    if(['w:pPr','w:rPr','w:del'].includes(child.name))continue;
    runsOf(xml,child,out);
  }
  return out;
}
function renderText(text){
  const parts=[];let buffer='';
  const flush=()=>{if(buffer){parts.push(`<w:t xml:space="preserve">${escape(buffer)}</w:t>`);buffer='';}};
  for(const ch of String(text??'')){if(ch==='\t'){flush();parts.push('<w:tab/>');}else if(ch==='\n'){flush();parts.push('<w:br/>');}else buffer+=ch;}
  flush();return parts.join('');
}
const renderRun=(rPr,text)=>`<w:r>${rPr}${renderText(text)}</w:r>`;
const mergeRuns=runs=>runs.reduce((out,run)=>{const last=out.at(-1);if(last&&last.rPr===run.rPr)last.text+=run.text;else out.push({...run});return out;},[]);
// The run format new text takes in a paragraph that has none: the paragraph mark's own run properties.
const markRunProperties=(xml,p)=>{const pPr=first(p,'w:pPr'),rPr=pPr&&first(pPr,'w:rPr');return rPr?slice(xml,rPr):'';};
// A paragraph rebuilt from its properties, bookmarks and the given runs; the opening tag keeps its attributes.
function rebuildParagraph(xml,p,runs){
  const pPr=first(p,'w:pPr'),keep=p.children.filter(child=>isElement(child)&&['w:bookmarkStart','w:bookmarkEnd'].includes(child.name)).map(node=>slice(xml,node));
  return openTag(xml,p)+(pPr?slice(xml,pPr):'')+keep.join('')+runs.map(run=>renderRun(run.rPr,run.text)).join('')+closeTag('w:p');
}
function paragraphWithText(xml,p,text){
  const runs=runsOf(xml,p),rPr=runs[0]?.rPr??markRunProperties(xml,p);
  return rebuildParagraph(xml,p,text?[{rPr,text}]:[]);
}
// Characters of the guide take the replacement in the format where the guide begins; the others keep theirs.
function paragraphWithGuideReplaced(xml,p,guide,text){
  const runs=mergeRuns(runsOf(xml,p)),full=runs.map(run=>run.text).join('');
  const start=full.indexOf(guide);if(!guide||start<0||start!==full.lastIndexOf(guide))refuse('unsupported_target');
  const chars=runs.flatMap(run=>[...run.text].map(ch=>({ch,rPr:run.rPr})));
  const format=chars[start]?.rPr??runs[0]?.rPr??markRunProperties(xml,p);
  const next=[...chars.slice(0,start),...[...text].map(ch=>({ch,rPr:format})),...chars.slice(start+guide.length)];
  const rebuilt=mergeRuns(next.map(({ch,rPr})=>({text:ch,rPr})));
  return rebuildParagraph(xml,p,rebuilt);
}
const replaceRange=(xml,node,replacement)=>xml.slice(0,node.start)+replacement+xml.slice(node.end);

/** The elements the operations address, in the reader's order: body paragraphs (p-N over every paragraph, cells included), tables and content controls. */
function locate(xml){
  const tree=parseXml(xml),body=(function find(node){for(const child of node.children){if(!isElement(child))continue;if(child.name==='w:body')return child;const found=find(child);if(found)return found;}return null;})(tree);
  if(!body)fail('docx_invalid');
  const paragraphs=new Map(),cells=new Map(),tables=[],fields=[];let p=0;
  const table=node=>{
    const t=tables.push(node);let r=0;
    for(const row of children(node,'w:tr')){
      r++;let c=0;
      for(const cell of children(row,'w:tc')){
        const tcPr=first(cell,'w:tcPr'),vMerge=tcPr&&first(tcPr,'w:vMerge');
        const cellParagraphs=children(cell,'w:p');for(const paragraph of cellParagraphs)paragraphs.set('p-'+(++p),paragraph);
        if(vMerge&&vMerge.attrs['w:val']!=='restart')continue;
        c++;cells.set(`t${t}/r${r}/c${c}`,{cell,row,table:node,paragraphs:cellParagraphs});
      }
    }
  };
  const walk=container=>{
    for(const child of container.children){
      if(!isElement(child))continue;
      if(child.name==='w:p'){paragraphs.set('p-'+(++p),child);for(const sdt of findAll(child,'w:sdt'))fields.push(sdt);}
      else if(child.name==='w:tbl')table(child);
      else if(child.name==='w:sdt'){const content=first(child,'w:sdtContent');if(content&&children(content,'w:tbl').length)walk(content);else fields.push(child);}
    }
  };
  walk(body);
  return {body,paragraphs,cells,tables,fields:new Map(fields.map((node,k)=>['f-'+(k+1),node]))};
}
const bodyParagraph=(found,id)=>{const p=found.paragraphs.get(id);if(!p)refuse('unsupported_target');return p;};

/** Applies one operation to the document XML; returns the new XML. Refusals use the Office host's codes. */
export function applyOperationToXml(xml,op){
  if(!op||typeof op!=='object')refuse('invalid_plan');
  const found=locate(xml);
  if(op.type==='fill_cell'){
    const entry=found.cells.get(op.targetId);if(!entry)refuse('unsupported_target');
    const text=String(op.text??'');if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))refuse('invalid_plan');
    const [firstParagraph,...rest]=entry.paragraphs;if(!firstParagraph)refuse('unsupported_target');
    // The value goes in the cell's first paragraph; a second paragraph of the template cell is dropped with its guide.
    // Later paragraphs are removed first so the first one's offsets still hold.
    let next=xml;for(const extra of rest.slice().reverse())next=replaceRange(next,extra,'');
    return replaceRange(next,firstParagraph,paragraphWithText(xml,firstParagraph,text));
  }
  if(op.type==='replace_text'){const p=bodyParagraph(found,op.targetId);return replaceRange(xml,p,paragraphWithText(xml,p,String(op.text??'')));}
  if(op.type==='replace_guide'||op.type==='replace_text_fragment'){
    const guide=op.type==='replace_guide'?op.guide:op.findText,text=String(op.text??'');
    const entry=/^t\d/.test(op.targetId)?found.cells.get(op.targetId):null,p=entry?entry.paragraphs.find(paragraph=>runsOf(xml,paragraph).map(r=>r.text).join('').includes(guide)):bodyParagraph(found,op.targetId);
    if(!p)refuse('unsupported_target');
    return replaceRange(xml,p,paragraphWithGuideReplaced(xml,p,String(guide??''),text));
  }
  if(op.type==='fill_field'){
    const sdt=found.fields.get(op.targetId);if(!sdt)refuse('unsupported_target');
    const pr=first(sdt,'w:sdtPr'),content=first(sdt,'w:sdtContent');if(!content)refuse('unsupported_target');
    const text=String(op.text??'');
    const prXml=pr?slice(xml,pr).replace(/<w:showingPlcHdr\s*\/>|<w:showingPlcHdr\s*>\s*<\/w:showingPlcHdr>/g,''):'';
    const paragraphs=children(content,'w:p');let inner;
    if(paragraphs.length)inner=paragraphWithText(xml,paragraphs[0],text);
    else{const runs=runsOf(xml,content),rPr=runs[0]?.rPr??(pr&&first(pr,'w:rPr')?slice(xml,first(pr,'w:rPr')):'');inner=renderRun(rPr,text);}
    const rebuilt=openTag(xml,sdt)+prXml+openTag(xml,content)+inner+closeTag('w:sdtContent')+closeTag('w:sdt');
    return replaceRange(xml,sdt,rebuilt);
  }
  if(op.type==='insert_paragraphs'){
    const anchor=bodyParagraph(found,op.after);if(!Array.isArray(op.paragraphs)||!op.paragraphs.length||op.paragraphs.length>40)refuse('invalid_plan');
    const made=op.paragraphs.map(entry=>{
      const sample=bodyParagraph(found,entry.like??op.like);const pPr=first(sample,'w:pPr'),rPr=runsOf(xml,sample)[0]?.rPr??markRunProperties(xml,sample);
      return `<w:p>${pPr?slice(xml,pPr):''}${renderRun(rPr,String(entry.text??''))}</w:p>`;
    }).join('');
    return xml.slice(0,anchor.end)+made+xml.slice(anchor.end);
  }
  if(op.type==='remove_paragraph'){
    const p=bodyParagraph(found,op.targetId),ids=[...found.paragraphs.keys()];
    const bodyChildren=found.body.children.filter(isElement),at=bodyChildren.indexOf(p);
    // The last paragraph mark stays, and a paragraph between two tables keeps them apart.
    if(at<0||ids.at(-1)===op.targetId||(bodyChildren[at-1]?.name==='w:tbl'&&bodyChildren[at+1]?.name==='w:tbl'))refuse('unsupported_target');
    return replaceRange(xml,p,'');
  }
  if(op.type==='add_rows'){
    const match=/^t([1-9]\d*)$/.exec(String(op.targetId??''));const table=match&&found.tables[Number(match[1])-1];
    if(!table||!Number.isInteger(op.count)||op.count<1||op.count>50)refuse('invalid_plan');
    const rows=children(table,'w:tr'),last=rows.at(-1);if(!last)refuse('unsupported_target');
    // Each new row copies the last row with its cells emptied: properties, widths and spans stay.
    let rowXml=openTag(xml,last),cursor=xml.indexOf('>',last.start)+1;
    for(const child of last.children){
      if(!isElement(child))continue;
      rowXml+=xml.slice(cursor,child.start);cursor=child.end;
      if(child.name!=='w:tc'){rowXml+=slice(xml,child);continue;}
      const paragraphs=children(child,'w:p'),tcPr=first(child,'w:tcPr');
      rowXml+=openTag(xml,child)+(tcPr?slice(xml,tcPr):'')+(paragraphs[0]?paragraphWithText(xml,paragraphs[0],''):'<w:p/>')+closeTag('w:tc');
    }
    rowXml+=xml.slice(cursor,last.end-closeTag('w:tr').length)+closeTag('w:tr');
    return xml.slice(0,last.end)+rowXml.repeat(op.count)+xml.slice(last.end);
  }
  refuse('unsupported_operation');
}

const strip=item=>{if(item.kind==='cell'){const {width:_,...rest}=item;return rest;}if(item.kind!=='paragraph')return item;const {id:_,listString:__,...rest}=item;return rest;};
const sameItems=(a,b)=>JSON.stringify(a.map(strip))===JSON.stringify(b.map(strip));
const result=(requirement,met)=>({requirement,status:met?'met':'unmet'});
const shape=items=>items.filter(i=>i.kind==='cell').map(i=>i.id+':'+i.span).join(',');
const format=item=>JSON.stringify([item?.style,item?.bold,item?.runs,item?.listString??null]);
/** The receipt of one write: what the Office host reports (content, format, the rest untouched). */
function receiptFor(op,before,after){
  const same=id=>i=>i.id===id,others=(skipBefore,skipAfter)=>sameItems(before.filter(i=>!skipBefore(i)),after.filter(i=>!skipAfter(i)));
  const was=before.find(same(op.targetId)),now=after.find(same(op.targetId)),checks=[];
  if(op.type==='fill_cell')checks.push(result('칸 내용',now?.text===String(op.text??'')),result('칸 서식 보존',!!now&&now.style===was?.style),result('표 모양 보존',shape(before)===shape(after)),result('다른 칸과 문단 보존',others(same(op.targetId),same(op.targetId))));
  else if(op.type==='replace_text')checks.push(result('문단 내용',now?.text===String(op.text??'')),result('문단 서식 보존',!!now&&now.style===was?.style),result('선택 밖 문단 보존',others(same(op.targetId),same(op.targetId))));
  else if(op.type==='replace_guide'||op.type==='replace_text_fragment'){
    const find=op.type==='replace_guide'?op.guide:op.findText,at=was?.text.indexOf(find)??-1;
    checks.push(result('안내 문구 교체',at>=0&&now?.text===was.text.slice(0,at)+String(op.text??'')+was.text.slice(at+find.length)),result('안내 문구 밖 서식 보존',!!now&&now.style===was?.style),result('다른 칸과 문단 보존',others(same(op.targetId),same(op.targetId))));
  }else if(op.type==='fill_field')checks.push(result('필드 내용',now?.text===String(op.text??'')&&now?.showingPlaceholder===false),result('다른 칸과 문단 보존',others(same(op.targetId),same(op.targetId))));
  else if(op.type==='insert_paragraphs'){
    // The new paragraphs follow their anchor in document order.
    const k=before.findIndex(same(op.after)),count=op.paragraphs.length,made=after.slice(k+1,k+1+count),like=entry=>before.find(same(entry.like??op.like));
    checks.push(result('넣은 문단 내용',made.map(i=>i.text).join('\n')===op.paragraphs.map(e=>String(e.text??'')).join('\n')),result('넣은 문단 서식',made.length===count&&made.every((item,j)=>item.style===like(op.paragraphs[j])?.style)),result('다른 칸과 문단 보존',others(()=>false,i=>made.includes(i))));
    return {targetId:made[0]?.id??null,inserted:made.map(i=>i.id),checks};
  }else if(op.type==='remove_paragraph')checks.push(result('문단 삭제',!!was&&after.length===before.length-1),result('다른 칸과 문단 보존',others(same(op.targetId),()=>false)));
  else if(op.type==='add_rows'){
    const t=Number(op.targetId.slice(1)),rowsBefore=Math.max(0,...before.filter(i=>i.kind==='cell'&&i.table===t).map(i=>i.row)),rowsAfter=Math.max(0,...after.filter(i=>i.kind==='cell'&&i.table===t).map(i=>i.row));
    const added=after.filter(i=>i.kind==='cell'&&i.table===t&&i.row>rowsBefore);
    checks.push(result('표 행 추가',rowsAfter===rowsBefore+op.count&&added.every(cell=>!cell.text)),result('다른 칸과 문단 보존',others(()=>false,i=>added.includes(i))));
    return {targetId:`t${t}/r${rowsBefore+1}/c1`,checks};
  }
  return {targetId:op.targetId,checks};
}

/** A writer over one docx copy: the Office fill's read and apply ports, with the bytes zipped once at the end. */
export async function createDocxWriter(bytes,{name='양식.docx'}={}){
  const parts=await docxParts(bytes);let xml=parts.document;const applied=[];
  const snapshot=()=>snapshotParts({...parts,document:xml},{name});
  return {
    read:async()=>snapshot(),
    apply:async op=>{
      const before=snapshot().items,next=applyOperationToXml(xml,op),after=snapshotParts({...parts,document:next},{name}).items;
      xml=next;const receipt=receiptFor(op,before,after);applied.push({operation:op,receipt});return receipt;
    },
    get applied(){return applied.slice();},
    get changed(){return xml!==parts.document;},
    get documentXml(){return xml;},
    async bytes(){if(xml!==parts.document)parts.zip.file('word/document.xml',xml);return parts.zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
  };
}
/** Applies operations in order to a docx copy. Returns the new bytes and a receipt per operation. */
export async function applyDocxOperations(bytes,operations,{name='양식.docx'}={}){
  if(!Array.isArray(operations))fail('invalid_plan');
  const writer=await createDocxWriter(bytes,{name});
  for(const op of operations)await writer.apply(op);
  return {buffer:await writer.bytes(),applied:writer.applied,documentXml:writer.documentXml};
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** What changed between the source and a written copy: zip entries other than the document must be identical. */
export async function verifyDocxCopy(original,copy,{targets=[]}={}){
  const [a,b]=await Promise.all([JSZip.loadAsync(original),JSZip.loadAsync(copy)]);
  const names=[...new Set([...Object.keys(a.files),...Object.keys(b.files)])].filter(name=>!a.files[name]?.dir&&!b.files[name]?.dir).sort();
  const changedEntries=[];
  for(const name of names){
    const [x,y]=await Promise.all([a.file(name)?.async('nodebuffer'),b.file(name)?.async('nodebuffer')]);
    if(!x||!y||digest(x)!==digest(y))changedEntries.push(name);
  }
  const [before,after]=await Promise.all([docxSnapshotItems(original),docxSnapshotItems(copy)]);
  // Cells and fields keep their ids; paragraphs are aligned by text, so a paragraph after an insertion (its id moved by
  // one) is not reported as changed. Measured 2026-10-21 (forms baseline 1차, trip): the trailing empty paragraph was
  // reported as a change outside the targets after a section gained a paragraph.
  const changed=[],paragraphs=items=>items.filter(item=>item.kind==='paragraph');
  const was=new Map(before.filter(item=>item.kind!=='paragraph').map(item=>[item.id,item])),now=new Map(after.filter(item=>item.kind!=='paragraph').map(item=>[item.id,item]));
  for(const [id,item] of now){const old=was.get(id);if(!old)changed.push({id,kind:'inserted',text:item.text});else if(old.text!==item.text)changed.push({id,kind:'changed',before:old.text,after:item.text});}
  for(const id of was.keys())if(!now.has(id))changed.push({id,kind:'removed'});
  const oldParagraphs=paragraphs(before),newParagraphs=paragraphs(after);let i=0,j=0;
  const gap=(iEnd,jEnd)=>{while(i<iEnd||j<jEnd){if(i<iEnd&&j<jEnd){changed.push({id:newParagraphs[j].id,beforeId:oldParagraphs[i].id,kind:'changed',before:oldParagraphs[i].text,after:newParagraphs[j].text});i++;j++;}else if(j<jEnd){changed.push({id:newParagraphs[j].id,kind:'inserted',text:newParagraphs[j].text});j++;}else{changed.push({id:oldParagraphs[i].id,kind:'removed'});i++;}}};
  for(const [a,b] of align(oldParagraphs.map(p=>p.text),newParagraphs.map(p=>p.text))){gap(a,b);i=a+1;j=b+1;}
  gap(oldParagraphs.length,newParagraphs.length);
  const allowed=new Set(targets);
  return {sameEntries:changedEntries.every(name=>name==='word/document.xml'),changedEntries,changedParagraphs:changed,violations:allowed.size?changed.filter(item=>!allowed.has(item.id)&&!(item.beforeId&&allowed.has(item.beforeId))):[]};
}
async function docxSnapshotItems(bytes){const parts=await docxParts(bytes);return snapshotParts(parts).items;}
