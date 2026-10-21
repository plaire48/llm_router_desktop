// In-place writes to a docx copy (document forms plan Task D, 2026-10-21): the operations the Office fill planner
// (form-apply.mjs nextOperation) emits for a Word host, applied to word/document.xml by replacing only the element
// each one touches. Every other byte of the XML and every other zip entry stay as they were. After each write the
// document is read again and the receipt carries the same checks the Office host reports (content, format kept, the
// rest of the document untouched), so applyFill stops on anything unexpected.
import JSZip from 'jszip';
import {createHash} from 'node:crypto';
import {parseXml,snapshotParts,docxParts,paragraphObjects,textBoxes,legacyFields,legacyState,documentEditing,tableRows,bookmarkPoints,resolveBinding} from './docx-snapshot.mjs';
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
  const walk=node=>{for(const child of node.children){if(!isElement(child))continue;if(child.name==='w:t')text+=child.children.filter(x=>typeof x==='string').join('');else if(child.name==='w:tab')text+='\t';else if(child.name==='w:br'||child.name==='w:cr')text+='\n';else if(child.name==='w:noBreakHyphen')text+='-';else if(!['w:rPr','w:delText','w:drawing','w:pict','w:object','mc:AlternateContent'].includes(child.name))walk(child);}};
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
// Track Changes (Task J7): while a write runs on a document with Track Changes on, removed text is a tracked deletion and
// new text a tracked insertion by 누비, as Word records a person's typing. Set only inside applyOperationToXml.
let tracking=null,boundWrites=false;
const revisionOpen=kind=>`<w:${kind} w:id="${tracking.next()}" w:author="${escape(tracking.author)}" w:date="${tracking.date}">`;
const renderRun=(rPr,text,kind)=>{
  const body=renderText(text),run=kind==='del'?`<w:r>${rPr}${body.replaceAll('<w:t ','<w:delText ').replaceAll('</w:t>','</w:delText>')}</w:r>`:`<w:r>${rPr}${body}</w:r>`;
  return kind&&tracking?revisionOpen(kind)+run+closeTag('w:'+kind):run;
};
// The runs that replace old ones: the new runs, or with Track Changes the old ones deleted and the new ones inserted.
const replacing=(oldRuns,newRuns)=>tracking?[...oldRuns.map(run=>({...run,kind:'del'})),...newRuns.map(run=>({...run,kind:'ins'}))]:newRuns;
// A paragraph mark inserted or deleted with Track Changes: the mark's run properties carry the revision.
function markParagraph(pPr,kind){
  if(!tracking)return pPr;
  const mark=revisionOpen(kind).slice(0,-1)+'/>';
  if(!pPr)return `<w:pPr><w:rPr>${mark}</w:rPr></w:pPr>`;
  if(/<w:rPr\s*\/>/.test(pPr))return pPr.replace(/<w:rPr\s*\/>/,`<w:rPr>${mark}</w:rPr>`);
  if(pPr.includes('<w:rPr>'))return pPr.replace('<w:rPr>','<w:rPr>'+mark);
  const at=['<w:sectPr','<w:pPrChange','</w:pPr>'].map(tag=>pPr.indexOf(tag)).filter(i=>i>=0).sort((a,b)=>a-b)[0];
  return pPr.slice(0,at)+`<w:rPr>${mark}</w:rPr>`+pPr.slice(at);
}
const mergeRuns=runs=>runs.reduce((out,run)=>{const last=out.at(-1);if(last&&last.rPr===run.rPr&&last.kind===run.kind)last.text+=run.text;else out.push({...run});return out;},[]);
// The run format new text takes in a paragraph that has none: the paragraph mark's own run properties.
const markRunProperties=(xml,p)=>{const pPr=first(p,'w:pPr'),rPr=pPr&&first(pPr,'w:rPr');return rPr?slice(xml,rPr):'';};
// A paragraph rebuilt from its properties, bookmarks and the given runs; the opening tag keeps its attributes.
// A paragraph that holds anything a rebuild would drop is refused; its floating shapes are kept as they are (Task J3).
// An empty paragraph for a new table row drops what the copied row held, by intent.
function rebuildParagraph(xml,p,runs,{floating=true,empty=false}={}){
  const objects=paragraphObjects(p);if(objects.blocking&&!empty)refuse('unsupported_target');
  const pPr=first(p,'w:pPr'),keep=p.children.filter(child=>isElement(child)&&['w:bookmarkStart','w:bookmarkEnd','w:permStart','w:permEnd'].includes(child.name)).map(node=>slice(xml,node));
  return openTag(xml,p)+(pPr?slice(xml,pPr):'')+keep.join('')+(floating?objects.anchored.map(run=>slice(xml,run)).join(''):'')+runs.map(run=>renderRun(run.rPr,run.text,run.kind)).join('')+closeTag('w:p');
}
function paragraphWithText(xml,p,text){
  const runs=runsOf(xml,p),rPr=runs[0]?.rPr??markRunProperties(xml,p);
  return rebuildParagraph(xml,p,replacing(mergeRuns(runs),text?[{rPr,text}]:[]));
}
// Characters of the guide take the replacement in the format where the guide begins; the others keep theirs.
function paragraphWithGuideReplaced(xml,p,guide,text){
  const runs=mergeRuns(runsOf(xml,p)),full=runs.map(run=>run.text).join('');
  const start=full.indexOf(guide);if(!guide||start<0||start!==full.lastIndexOf(guide))refuse('unsupported_target');
  const chars=runs.flatMap(run=>[...run.text].map(ch=>({ch,rPr:run.rPr})));
  const format=chars[start]?.rPr??runs[0]?.rPr??markRunProperties(xml,p);
  const removed=chars.slice(start,start+guide.length).map(c=>({...c,kind:tracking?'del':undefined}));
  const next=[...chars.slice(0,start),...(tracking?removed:[]),...[...text].map(ch=>({ch,rPr:format,kind:tracking?'ins':undefined})),...chars.slice(start+guide.length)];
  const rebuilt=mergeRuns(next.map(({ch,rPr,kind})=>({text:ch,rPr,kind})));
  return rebuildParagraph(xml,p,rebuilt);
}
const replaceRange=(xml,node,replacement)=>xml.slice(0,node.start)+replacement+xml.slice(node.end);

/** The elements the operations address, in the reader's order: body paragraphs (p-N over every paragraph, cells included), tables and content controls. */
function locate(xml){
  // The body of the document, or the root of a header or footer part (Task J2).
  const tree=parseXml(xml),body=(function find(node){for(const child of node.children){if(!isElement(child))continue;if(['w:body','w:hdr','w:ftr','w:txbxContent'].includes(child.name))return child;const found=find(child);if(found)return found;}return null;})(tree);
  if(!body)fail('docx_invalid');
  const paragraphs=new Map(),cells=new Map(),tables=[],fields=[],legacy=[],marks=[];let p=0;
  const table=node=>{
    const t=tables.push(node);let r=0;
    for(const {row} of tableRows(node)){
      r++;let c=0;
      for(const cell of children(row,'w:tc')){
        const tcPr=first(cell,'w:tcPr'),vMerge=tcPr&&first(tcPr,'w:vMerge');
        const cellParagraphs=children(cell,'w:p');for(const paragraph of cellParagraphs)paragraphs.set('p-'+(++p),paragraph);
        if(vMerge&&vMerge.attrs['w:val']!=='restart')continue;
        c++;cells.set(`t${t}/r${r}/c${c}`,{cell,row,table:node,paragraphs:cellParagraphs});
        for(const child of cell.children){if(!isElement(child))continue;if(child.name==='w:p'){fields.push(...findAll(child,'w:sdt'));legacy.push(...legacyFields(child));}else if(child.name==='w:sdt')fields.push(child);}
      }
    }
  };
  const walk=container=>{
    for(const child of container.children){
      if(!isElement(child))continue;
      if(child.name==='w:p'){paragraphs.set('p-'+(++p),child);for(const sdt of findAll(child,'w:sdt'))fields.push(sdt);legacy.push(...legacyFields(child));marks.push(...bookmarkPoints(child));}
      else if(child.name==='w:tbl')table(child);
      else if(child.name==='w:sdt'){const content=first(child,'w:sdtContent');if(content&&children(content,'w:tbl').length)walk(content);else fields.push(child);}
    }
  };
  walk(body);
  return {body,paragraphs,cells,tables,fields:new Map(fields.map((node,k)=>['f-'+(k+1),node])),legacy:new Map(legacy.map((field,k)=>['ff-'+(k+1),field])),bookmarks:new Map(marks.map((mark,k)=>['bm-'+(k+1),mark]))};
}
const bodyParagraph=(found,id)=>{const p=found.paragraphs.get(id);if(!p)refuse('unsupported_target');return p;};

// Typed content controls (Task J1): a checkbox takes checked true or false and shows its own symbol; a dropdown takes
// one of its items (by text or value); a date takes an ISO date, stored in w:fullDate and shown in its format. Free
// text goes only into text, rich text and combo boxes. Returns the text to show and the change to the properties.
const KO_DAYS=['일','월','화','수','목','금','토'];
export function formatControlDate(iso,format){
  const [y,m,d]=iso.split('-').map(Number),day=new Date(Date.UTC(y,m-1,d)).getUTCDay(),pad=n=>String(n).padStart(2,'0');
  const tokens={yyyy:String(y),yy:pad(y%100),MMMM:m+'월',MMM:m+'월',MM:pad(m),M:String(m),dddd:KO_DAYS[day]+'요일',ddd:KO_DAYS[day],dd:pad(d),d:String(d)};
  return String(format||'yyyy-MM-dd').replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|'[^']*'/g,token=>token.startsWith("'")?token.slice(1,-1):tokens[token]);
}
const realDate=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso??''));if(!m)return false;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3];};
function fieldValue(pr,op){
  const node=name=>pr&&first(pr,name),box=node('w14:checkbox'),drop=node('w:dropDownList'),combo=node('w:comboBox'),date=node('w:date');
  if(node('w:lock')&&['contentLocked','sdtContentLocked'].includes(node('w:lock').attrs['w:val']))refuse('unsupported_target');
  if(node('w:picture')||node('w:group')||node('w:docPartObj')||node('w:docPartList'))refuse('unsupported_target');
  // Word rewrites a bound control from its XML part on open: only the writer, which writes that part too, may write it.
  if(node('w:dataBinding')&&!boundWrites)refuse('unsupported_target');
  const same=props=>props,checkedGiven=op.checked!==undefined,dateGiven=op.date!==undefined;
  if(box){
    if(typeof op.checked!=='boolean'||op.text!==undefined||dateGiven)refuse('invalid_plan');
    const state=first(box,op.checked?'w14:checkedState':'w14:uncheckedState'),code=parseInt(state?.attrs['w14:val']??(op.checked?'2612':'2610'),16);
    const flag=`<w14:checked w14:val="${op.checked?1:0}"/>`;
    return {text:String.fromCodePoint(code),props:props=>/<w14:checked\b[^>]*\/>/.test(props)?props.replace(/<w14:checked\b[^>]*\/>/,flag):props.replace(/<w14:checkbox>/,'<w14:checkbox>'+flag)};
  }
  if(checkedGiven)refuse('invalid_plan');
  if(date){
    if(!dateGiven){if(op.text===undefined)refuse('invalid_plan');return {text:String(op.text),props:same};}
    if(!realDate(op.date))refuse('invalid_plan');
    const format=first(date,'w:dateFormat')?.attrs['w:val'],stamp=`w:fullDate="${op.date}T00:00:00Z"`;
    return {text:op.text!==undefined?String(op.text):formatControlDate(op.date,format),props:props=>props.replace(/<w:date\b[^>]*?(\/?)>/,(tag,close)=>(/w:fullDate="[^"]*"/.test(tag)?tag.replace(/w:fullDate="[^"]*"/,stamp):tag.replace(/<w:date/,'<w:date '+stamp))) }; 
  }
  if(dateGiven)refuse('invalid_plan');
  const text=String(op.text??'');
  if(drop){
    const items=children(drop,'w:listItem').map(item=>({text:item.attrs['w:displayText']??item.attrs['w:value']??'',value:item.attrs['w:value']??item.attrs['w:displayText']??''}));
    const chosen=items.find(item=>item.text===text)??items.find(item=>item.value===text);if(!chosen)refuse('invalid_plan');
    return {text:chosen.text,props:props=>props.replace(/(<w:dropDownList\b[^>]*?)w:lastValue="[^"]*"/,(all,head)=>`${head}w:lastValue="${escape(chosen.value)}"`)};
  }
  void combo;return {text,props:same};
}
/** Applies one operation to the document XML; returns the new XML. Refusals use the Office host's codes. track: the
 * revision author, date and id counter when the document has Track Changes on. */
export function applyOperationToXml(xml,op,{track=null,bound=false}={}){
  const previous=[tracking,boundWrites];tracking=track;boundWrites=bound;
  try{return applyOperation(xml,op);}finally{[tracking,boundWrites]=previous;}
}
function applyOperation(xml,op){
  if(!op||typeof op!=='object')refuse('invalid_plan');
  const found=locate(xml);
  if(op.type==='fill_cell'){
    const entry=found.cells.get(op.targetId);if(!entry)refuse('unsupported_target');
    const text=String(op.text??'');if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))refuse('invalid_plan');
    const [firstParagraph,...rest]=entry.paragraphs;if(!firstParagraph)refuse('unsupported_target');
    // The value goes in the cell's first paragraph; a second paragraph of the template cell is dropped with its guide.
    // Later paragraphs are removed first so the first one's offsets still hold.
    for(const extra of rest){const objects=paragraphObjects(extra);if(objects.blocking||objects.anchored.length)refuse('unsupported_target');}
    // With Track Changes a cell is written in a single paragraph only: removing paragraphs would need tracked marks.
    if(tracking&&rest.length)refuse('unsupported_target');
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
  if(op.type==='fill_bookmark'){
    // Only what is between the bookmark's marks changes; the marks stay around the value (Task J6).
    const mark=found.bookmarks.get(op.targetId);if(!mark)refuse('unsupported_target');
    const text=String(op.text??'');if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))refuse('invalid_plan');
    const sample=mark.inner[0]??mark.previous,rPr=sample&&first(sample,'w:rPr')?slice(xml,first(sample,'w:rPr')):'';
    const old=mergeRuns(mark.inner.flatMap(run=>runsOf(xml,{children:[run]})));
    const runs=replacing(old,text?[{rPr,text}]:[]).map(run=>renderRun(run.rPr,run.text,run.kind)).join('');
    return xml.slice(0,mark.start.end)+runs+xml.slice(mark.end.start);
  }
  if(op.type==='fill_picture'){
    // The picture of a picture control points at the new media part (op.embed), fitted in the control's box.
    const sdt=found.fields.get(op.targetId),pr=sdt&&first(sdt,'w:sdtPr'),content=sdt&&first(sdt,'w:sdtContent');
    if(!sdt||!pr||!first(pr,'w:picture')||!content)refuse('unsupported_target');
    if(!op.embed||!(op.width>0)||!(op.height>0))refuse('invalid_plan');
    const blips=findAll(content,'a:blip'),extent=findAll(content,'wp:extent')[0];if(blips.length!==1||!extent)refuse('unsupported_target');
    const boxX=Number(extent.attrs.cx),boxY=Number(extent.attrs.cy),scale=Math.min(boxX/op.width,boxY/op.height),cx=Math.round(op.width*scale),cy=Math.round(op.height*scale);
    let inner=slice(xml,content);const base=content.start;
    const edits=[{from:blips[0].start,to:xml.indexOf('>',blips[0].start)+1,text:openTag(xml,blips[0]).replace(/r:embed="[^"]*"/,`r:embed="${op.embed}"`)},{from:extent.start,to:extent.end,text:`<wp:extent cx="${cx}" cy="${cy}"/>`}];
    for(const ext of findAll(content,'a:ext'))if(ext.attrs.cx!==undefined)edits.push({from:ext.start,to:ext.end,text:`<a:ext cx="${cx}" cy="${cy}"/>`});
    for(const edit of edits.sort((a,b)=>b.from-a.from))inner=inner.slice(0,edit.from-base)+edit.text+inner.slice(edit.to-base);
    const props=slice(xml,pr).replace(/<w:showingPlcHdr\s*\/>|<w:showingPlcHdr\s*>\s*<\/w:showingPlcHdr>/g,'');
    return xml.slice(0,pr.start)+props+xml.slice(pr.end,content.start)+inner+xml.slice(content.end);
  }
  if(op.type==='fill_field'&&/^ff-\d+$/.test(String(op.targetId))){
    // A legacy form field (Task J4): text goes in its result runs, a check box and a drop-down change their ffData.
    const field=found.legacy.get(op.targetId);if(!field)refuse('unsupported_target');
    const state=legacyState(field);if(!state.enabled||field.nested)refuse('unsupported_target');
    const edits=[];
    if(state.controlType==='checkbox'){
      if(typeof op.checked!=='boolean'||op.text!==undefined)refuse('invalid_plan');
      const box=first(field.ffData,'w:checkBox'),flag=`<w:checked w:val="${op.checked?1:0}"/>`,own=first(box,'w:checked');
      edits.push(own?{node:own,text:flag}:{at:box.end-closeTag('w:checkBox').length,text:flag});
    }else if(state.controlType==='dropdown'){
      if(op.checked!==undefined||op.date!==undefined)refuse('invalid_plan');
      const at=state.options.findIndex(option=>option.text===String(op.text??''));if(at<0)refuse('invalid_plan');
      const list=first(field.ffData,'w:ddList'),own=first(list,'w:result'),flag=`<w:result w:val="${at}"/>`;
      edits.push(own?{node:own,text:flag}:{at:xml.indexOf('>',list.start)+1,text:flag});
    }else if(state.controlType==='text'){
      if(op.checked!==undefined||op.date!==undefined)refuse('invalid_plan');
      const text=String(op.text??'');if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)||state.maxLength&&[...text].length>state.maxLength)refuse('invalid_plan');
      const sample=field.results[0]??field.begin,rPr=first(sample,'w:rPr'),fresh=renderRun(rPr?slice(xml,rPr):'',text||'\u00a0\u00a0\u00a0\u00a0\u00a0',tracking?'ins':undefined);
      const run=(tracking?field.results.flatMap(result=>runsOf(xml,{children:[result]})).map(old=>renderRun(old.rPr,old.text,'del')).join(''):'')+fresh;
      if(field.separate)edits.push({from:field.separate.end,to:field.end.start,text:run});
      else edits.push({at:field.end.start,text:'<w:r><w:fldChar w:fldCharType="separate"/></w:r>'+run});
    }else refuse('unsupported_target');
    let next=xml;
    for(const edit of edits.map(e=>e.node?{from:e.node.start,to:e.node.end,text:e.text}:e.at!==undefined?{from:e.at,to:e.at,text:e.text}:e).sort((a,b)=>b.from-a.from))next=next.slice(0,edit.from)+edit.text+next.slice(edit.to);
    return next;
  }
  if(op.type==='fill_field'){
    const sdt=found.fields.get(op.targetId);if(!sdt)refuse('unsupported_target');
    const pr=first(sdt,'w:sdtPr'),content=first(sdt,'w:sdtContent');if(!content)refuse('unsupported_target');
    const typed=fieldValue(pr,op),placeholder=!!(pr&&first(pr,'w:showingPlcHdr')),text=typed.text;
    const prXml=typed.props(pr?slice(xml,pr).replace(/<w:showingPlcHdr\s*\/>|<w:showingPlcHdr\s*>\s*<\/w:showingPlcHdr>/g,''):'');
    // The placeholder's grey character style goes with the placeholder; the control's other run formats stay.
    const keep=rPr=>placeholder?rPr.replace(/<w:rStyle w:val="[^"]*Placeholder[^"]*"\s*\/>/gi,'').replace(/<w:rPr>\s*<\/w:rPr>/,''):rPr;
    const paragraphs=children(content,'w:p');let inner;
    if(paragraphs.length){const p0=paragraphs[0],runs=runsOf(xml,p0),rPr=keep(runs[0]?.rPr??markRunProperties(xml,p0));inner=rebuildParagraph(xml,p0,replacing(placeholder?[]:mergeRuns(runs),text?[{rPr,text}]:[]));}
    else{const runs=runsOf(xml,content),rPr=keep(runs[0]?.rPr??(pr&&first(pr,'w:rPr')?slice(xml,first(pr,'w:rPr')):''));inner=replacing(placeholder?[]:mergeRuns(runs),[{rPr,text}]).map(run=>renderRun(run.rPr,run.text,run.kind)).join('');}
    const rebuilt=openTag(xml,sdt)+prXml+openTag(xml,content)+inner+closeTag('w:sdtContent')+closeTag('w:sdt');
    return replaceRange(xml,sdt,rebuilt);
  }
  if(op.type==='insert_paragraphs'){
    const anchor=bodyParagraph(found,op.after);if(!Array.isArray(op.paragraphs)||!op.paragraphs.length||op.paragraphs.length>40)refuse('invalid_plan');
    const made=op.paragraphs.map(entry=>{
      const sample=bodyParagraph(found,entry.like??op.like);const pPr=first(sample,'w:pPr'),rPr=runsOf(xml,sample)[0]?.rPr??markRunProperties(xml,sample);
      return `<w:p>${markParagraph(pPr?slice(xml,pPr):'','ins')}${renderRun(rPr,String(entry.text??''),tracking?'ins':undefined)}</w:p>`;
    }).join('');
    return xml.slice(0,anchor.end)+made+xml.slice(anchor.end);
  }
  if(op.type==='remove_paragraph'){
    const p=bodyParagraph(found,op.targetId),ids=[...found.paragraphs.keys()];
    const bodyChildren=found.body.children.filter(isElement),at=bodyChildren.indexOf(p);
    // The last paragraph mark stays, and a paragraph between two tables keeps them apart.
    if(at<0||ids.at(-1)===op.targetId||(bodyChildren[at-1]?.name==='w:tbl'&&bodyChildren[at+1]?.name==='w:tbl'))refuse('unsupported_target');
    if(tracking){
      // A tracked removal keeps the paragraph, its text and mark deleted, until someone accepts the change in Word.
      const pPr=first(p,'w:pPr');if(paragraphObjects(p).blocking)refuse('unsupported_target');
      return replaceRange(xml,p,openTag(xml,p)+markParagraph(pPr?slice(xml,pPr):'','del')+mergeRuns(runsOf(xml,p)).map(run=>renderRun(run.rPr,run.text,'del')).join('')+closeTag('w:p'));
    }
    return replaceRange(xml,p,'');
  }
  if(op.type==='add_rows'){
    const match=/^t([1-9]\d*)$/.exec(String(op.targetId??''));const table=match&&found.tables[Number(match[1])-1];
    if(!table||!Number.isInteger(op.count)||op.count<1||op.count>50)refuse('invalid_plan');
    const rows=tableRows(table),lastRow=rows.at(-1),last=lastRow?.row;if(!last)refuse('unsupported_target');
    // Each new row copies the last row with its cells emptied: properties, widths and spans stay. Content control ids
    // are left for Word to assign, so a copy never repeats one.
    const makeRow=()=>{
    let rowXml=openTag(xml,last),cursor=xml.indexOf('>',last.start)+1;
    for(const child of last.children){
      if(!isElement(child))continue;
      rowXml+=xml.slice(cursor,child.start);cursor=child.end;
      if(child.name==='w:trPr'&&tracking){const props=slice(xml,child);rowXml+=props.endsWith('/>')?`<w:trPr>${revisionOpen('ins').slice(0,-1)}/></w:trPr>`:props.replace(/<w:trPr>/,'<w:trPr>'+revisionOpen('ins').slice(0,-1)+'/>');continue;}
      if(child.name!=='w:tc'){rowXml+=slice(xml,child);continue;}
      if(tracking&&!first(last,'w:trPr')&&!rowXml.includes('<w:trPr'))rowXml+=`<w:trPr>${revisionOpen('ins').slice(0,-1)}/></w:trPr>`;
      const paragraphs=children(child,'w:p'),tcPr=first(child,'w:tcPr');
      rowXml+=openTag(xml,child)+(tcPr?slice(xml,tcPr):'')+(paragraphs[0]?rebuildParagraph(xml,paragraphs[0],[],{floating:false,empty:true}):'<w:p/>')+closeTag('w:tc');
    }
    rowXml+=xml.slice(cursor,last.end-closeTag('w:tr').length)+closeTag('w:tr');
    return rowXml.replace(/<w:id w:val="-?\d+"\s*\/>/g,'');
    };
    // A row of a repeating section is copied as a new item of the section (Task J6).
    const item=lastRow.item,itemPr=item&&first(item,'w:sdtPr'),itemContent=item&&first(item,'w:sdtContent');
    if(itemPr&&itemContent&&first(itemPr,'w15:repeatingSectionItem')&&children(itemContent,'w:tr').length===1){
      const wrap=row=>openTag(xml,item)+slice(xml,itemPr).replace(/<w:id w:val="-?\d+"\s*\/>/g,'')+xml.slice(itemPr.end,itemContent.start)+openTag(xml,itemContent)+row+closeTag('w:sdtContent')+closeTag('w:sdt');
      return xml.slice(0,item.end)+Array.from({length:op.count},()=>wrap(makeRow())).join('')+xml.slice(item.end);
    }
    return xml.slice(0,last.end)+Array.from({length:op.count},makeRow).join('')+xml.slice(last.end);
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
  }else if(op.type==='fill_bookmark'){
    const holder=item=>item.id===op.targetId||(!!was?.paragraph&&item.id===was.paragraph);
    checks.push(result('책갈피 값',now?.text===String(op.text??'')),result('다른 칸과 문단 보존',others(holder,holder)));
  }else if(op.type==='fill_picture'){
    const holder=item=>item.id===op.targetId||(!!was?.paragraph&&item.id===was.paragraph)||(!!was?.cell&&item.id===was.cell);
    checks.push(result('그림 넣기',now?.image===op.embed&&now?.showingPlaceholder===false),result('다른 칸과 문단 보존',others(holder,holder)));
  }else if(op.type==='fill_field'){
    // The paragraph or cell that holds an inline control shows its new text too; everything else stays.
    const holder=item=>item.id===op.targetId||(!!was?.paragraph&&item.id===was.paragraph)||(!!was?.cell&&item.id===was.cell);
    const shown=op.checked!==undefined?now?.checked===op.checked:op.date!==undefined?now?.date===op.date&&!!now?.text:now?.text===(was?.controlType==='dropdown'?was.options?.find(o=>o.text===op.text||o.value===op.text)?.text:String(op.text??''));
    checks.push(result('필드 내용',!!shown&&now?.showingPlaceholder===false),result('다른 칸과 문단 보존',others(holder,holder)));
  }
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

// An operation on a header or footer names its part in the target ("header1:t1/r1/c2"): it is applied to that part
// with the part's own ids. Only values are written there: no paragraphs or rows are added or removed.
function partOperation(op,extras){
  const match=/^([\w.-]+):(.+)$/.exec(String(op?.targetId??''));if(!match)return null;
  if(!['fill_cell','replace_text','replace_guide','replace_text_fragment','fill_field','fill_bookmark'].includes(op.type))refuse('unsupported_target');
  if(/^box\d+$/.test(match[1]))return {box:Number(match[1].slice(3)),op:{...op,targetId:match[2]}};
  const extra=extras.find(entry=>entry.key===match[1]);if(!extra)refuse('unsupported_target');
  return {extra,op:{...op,targetId:match[2]}};
}
// A write inside the n-th text box of the body (Task J3): applied to its DrawingML copy, and the VML copy takes the same
// content so Word of any version shows the same text.
function applyInTextBox(xml,n,op,track){
  const body=(function find(node){for(const child of node.children){if(!isElement(child))continue;if(child.name==='w:body')return child;const found=find(child);if(found)return found;}return null;})(parseXml(xml));
  const box=body&&textBoxes(body)[n-1];if(!box)refuse('unsupported_target');
  const written=applyOperationToXml(slice(xml,box.node),op,{track}),inner=written.slice(written.indexOf('>')+1,written.lastIndexOf('</'));
  const edits=[box.node,box.copy].filter(Boolean).map(node=>({node,text:openTag(xml,node)+inner+closeTag('w:txbxContent')})).sort((a,b)=>b.node.start-a.node.start);
  let next=xml;for(const edit of edits)next=replaceRange(next,edit.node,edit.text);
  return next;
}
/** A writer over one docx copy: the Office fill's read and apply ports, with the bytes zipped once at the end. */
export async function createDocxWriter(bytes,{name='양식.docx',resolveImage=null}={}){
  const parts=await docxParts(bytes),extras=(parts.extras??[]).map(extra=>({...extra}));let xml=parts.document;const applied=[];
  // Restrict Editing and Track Changes as Word applies them to a person (Task J7).
  const editing=documentEditing(parts.settings);
  let revision=Math.max(0,...[xml,...extras.map(extra=>extra.xml)].flatMap(text=>[...text.matchAll(/w:id="(\d+)"/g)].map(m=>Number(m[1]))));
  const track=editing.trackRevisions?{author:'누비',date:new Date().toISOString().replace(/\.\d+Z$/,'Z'),next:()=>++revision}:null;
  const allowed=op=>{const edit=editing.protection?.enforced?editing.protection.edit:null;if(['readOnly','comments'].includes(edit)||edit==='forms'&&!['fill_field','fill_picture'].includes(op.type))refuse('document_not_writable');};
  // Media a picture write adds: the new part, its relationship and its content type, zipped with the copy.
  const media=[],relsPart='word/_rels/document.xml.rels';let rels=null,types=null;
  // Data stores of bound controls (Task J8), written with the copy.
  const stores=new Map([...(parts.stores??new Map())].map(([id,store])=>[id,{...store}])),storeChanged=new Set();
  const storeValue=(item,op)=>{
    if(op.checked!==undefined)return op.checked?'true':'false';
    if(op.date!==undefined)return item.storeMappedDataAs==='date'?op.date:item.storeMappedDataAs==='text'?formatControlDate(op.date,item.dateFormat):op.date+'T00:00:00';
    const text=String(op.text??'');return item.controlType==='dropdown'?item.options?.find(o=>o.text===text||o.value===text)?.value??text:text;
  };
  const writeStore=(item,op)=>{
    const found=resolveBinding(stores,item.binding);if(!found)refuse('unsupported_target');
    const store=[...stores.values()].find(entry=>entry.part===found.part),node=found.node,value=escape(storeValue(item,op));
    const tag=store.xml.slice(node.start,store.xml.indexOf('>',node.start)+1);
    const rebuilt=tag.endsWith('/>')?tag.slice(0,-2).trimEnd()+'>'+value+`</${node.name}>`:tag+value+`</${node.name}>`;
    store.xml=store.xml.slice(0,node.start)+rebuilt+store.xml.slice(node.end);storeChanged.add(store.part);
  };
  const addImage=async op=>{
    if(typeof resolveImage!=='function'||typeof op.path!=='string'||!op.path)refuse('invalid_plan');
    const data=await resolveImage(op.path),info=data&&data.length<=20*1024*1024?imageInfo(data):null;if(!info||!info.width||!info.height)refuse('invalid_plan');
    rels??=await parts.zip.file(relsPart)?.async('string')??'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    types??=await parts.zip.file('[Content_Types].xml').async('string');
    let n=1;while(parts.zip.file(`word/media/nubi-image-${n}.${info.extension}`)||media.some(m=>m.n===n)||rels.includes(`Id="rIdNubiImage${n}"`))n++;
    const embed=`rIdNubiImage${n}`,target=`media/nubi-image-${n}.${info.extension}`;
    return {embed,width:info.width,height:info.height,commit:()=>{
      media.push({n,part:'word/'+target,data:Buffer.from(data)});
      rels=rels.replace('</Relationships>',`<Relationship Id="${embed}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`);
      if(!new RegExp(`<Default Extension="${info.extension}"`,'i').test(types))types=types.replace('</Types>',`<Default Extension="${info.extension}" ContentType="${info.contentType}"/></Types>`);
    }};
  };
  const snapshotOf=(document,list)=>snapshotParts({...parts,document,extras:list},{name});
  const snapshot=()=>snapshotOf(xml,extras);
  return {
    read:async()=>snapshot(),
    apply:async op=>{
      allowed(op);
      // A picture is placed in the body only; the image is read and checked before the document changes.
      let picture=null;if(op?.type==='fill_picture'){if(/:/.test(String(op.targetId)))refuse('unsupported_target');picture=await addImage(op);op={...op,embed:picture.embed,width:picture.width,height:picture.height};}
      const before=snapshot().items,inPart=partOperation(op,extras),boundItem=op?.type==='fill_field'?before.find(item=>item.id===op.targetId&&item.mapped&&item.writable):null,bound=!!boundItem;
      const nextXml=inPart?.box?applyInTextBox(xml,inPart.box,inPart.op,track):inPart?xml:applyOperationToXml(xml,op,{track,bound}),nextExtras=inPart?.extra?extras.map(extra=>extra===inPart.extra?{...extra,xml:applyOperationToXml(extra.xml,inPart.op,{track,bound})}:extra):extras;
      if(boundItem)writeStore(boundItem,op);
      const after=snapshotOf(nextXml,nextExtras).items;
      xml=nextXml;if(inPart?.extra){const k=extras.indexOf(inPart.extra);extras[k]=nextExtras[k];}
      picture?.commit();
      const receipt=receiptFor(op,before,after),record=picture?{type:op.type,targetId:op.targetId,path:op.path}:op;applied.push({operation:record,receipt});return receipt;
    },
    get applied(){return applied.slice();},
    get changed(){return xml!==parts.document||extras.some((extra,k)=>extra.xml!==parts.extras[k].xml);},
    get documentXml(){return xml;},
    async bytes(){
      if(xml!==parts.document)parts.zip.file('word/document.xml',xml);
      extras.forEach((extra,k)=>{if(extra.xml!==parts.extras[k].xml)parts.zip.file(extra.part,extra.xml);});
      if(media.length){for(const m of media)parts.zip.file(m.part,m.data);parts.zip.file(relsPart,rels);parts.zip.file('[Content_Types].xml',types);}
      for(const store of stores.values())if(storeChanged.has(store.part))parts.zip.file(store.part,store.xml);
      return parts.zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
    }
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
// The pixel size of a PNG or JPEG; anything else is not placed.
export function imageInfo(bytes){
  if(!Buffer.isBuffer(bytes)&&!(bytes instanceof Uint8Array))return null;const b=Buffer.from(bytes);
  if(b.length>24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR')return {extension:'png',contentType:'image/png',width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  if(b.length>4&&b[0]===0xff&&b[1]===0xd8){
    for(let at=2;at+9<b.length;){if(b[at]!==0xff){at++;continue;}const marker=b[at+1],length=b.readUInt16BE(at+2);
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {extension:'jpeg',contentType:'image/jpeg',width:b.readUInt16BE(at+7),height:b.readUInt16BE(at+5)};
      at+=2+length;}
  }
  return null;
}
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
  // A control's paragraph or cell shows the control's new value, so it changes with its control.
  const allowed=new Set(targets);for(const item of before)if(allowed.has(item.id)&&['field','bookmark'].includes(item.kind)){if(item.paragraph)allowed.add(item.paragraph);if(item.cell)allowed.add(item.cell);}
  // Values go into the document part and the header and footer parts; every other entry stays byte for byte.
  // A placed picture (Task J5) adds its media part, relationship and content type.
  return {sameEntries:changedEntries.every(name=>name==='word/document.xml'||/^word\/(?:header|footer)\d*\.xml$/.test(name)||/^word\/media\/nubi-image-\d+\.(?:png|jpeg)$/.test(name)&&!a.files[name]||name==='word/_rels/document.xml.rels'||name==='[Content_Types].xml'||/^customXml\/item\d+\.xml$/.test(name)||['docProps/core.xml','docProps/app.xml'].includes(name)),changedEntries,changedParagraphs:changed,violations:allowed.size?changed.filter(item=>!allowed.has(item.id)&&!(item.beforeId&&allowed.has(item.beforeId))):[]};
}
async function docxSnapshotItems(bytes){const parts=await docxParts(bytes);return snapshotParts(parts).items;}
