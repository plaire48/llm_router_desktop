// A Word form read without Word (document forms plan Task A, 2026-10-21): the same snapshot items the Word host
// reports (paragraphs p-N, cells tT/rR/cC, content controls f-N) from a docx file, so the Office form map, fill sheet
// and checks work on a file in the Workspace. The XML is walked once; every item keeps the character range of its
// element in word/document.xml so a later in-place edit touches that fragment only.
import JSZip from 'jszip';
import {createHash} from 'node:crypto';
import {wordFormMap} from '../generated/office-forms.mjs';
import {fail} from './files.mjs';

const TAG=/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+(?:="[^"]*"|='[^']*')?)*)\s*(\/?)>/g;
const ENTITY=/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g;
const HANGUL=['가','나','다','라','마','바','사','아','자','차','카','타','파','하'];
const decode=text=>text.replace(ENTITY,(_,e)=>e==='amp'?'&':e==='lt'?'<':e==='gt'?'>':e==='quot'?'"':e==='apos'?"'":String.fromCodePoint(e[1]==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10)));
const attributes=text=>{const out={};for(const m of text.matchAll(/([^\s=/]+)=(?:"([^"]*)"|'([^']*)')/g))out[m[1]]=decode(m[2]??m[3]??'');return out;};
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');

/** A light element tree of one XML part; text nodes are strings. Comments and processing instructions are skipped. */
export function parseXml(xml){
  const root={name:'#root',attrs:{},children:[],start:0,end:xml.length};const stack=[root];let last=0;
  const text=(from,to)=>{if(to>from){const value=xml.slice(from,to);if(/\S/.test(value)||stack.length>1)stack.at(-1).children.push(decode(value));}};
  for(const match of xml.matchAll(TAG)){
    const [whole,closing,name,attrText,selfClosing]=match,at=match.index;
    if(name.startsWith('?')||name.startsWith('!')){last=at+whole.length;continue;}
    text(last,at);last=at+whole.length;
    if(closing){const node=stack.pop();if(!node||node.name!==name)fail('docx_xml_invalid');node.end=last;continue;}
    const node={name,attrs:attributes(attrText),children:[],start:at,end:last,parent:stack.at(-1)};
    stack.at(-1).children.push(node);
    if(!selfClosing)stack.push(node);
  }
  if(stack.length!==1)fail('docx_xml_invalid');
  return root;
}
export const isElement=node=>typeof node==='object'&&node!==null;
export const childrenNamed=(node,name)=>node.children.filter(child=>isElement(child)&&child.name===name);
export const firstNamed=(node,name)=>node.children.find(child=>isElement(child)&&child.name===name)??null;
export const findFirst=(node,name)=>{for(const child of node.children){if(!isElement(child))continue;if(child.name===name)return child;const found=findFirst(child,name);if(found)return found;}return null;};
export const flag=(node,name)=>{const found=firstNamed(node,name);if(!found)return false;const value=found.attrs['w:val'];return value===undefined||!['0','false','off'].includes(value);};

function readStyles(xml){
  const styles=new Map();if(!xml)return styles;
  for(const style of childrenNamed(findFirst(parseXml(xml),'w:styles')??{children:[]},'w:style')){
    const id=style.attrs['w:styleId'];if(!id)continue;
    const pPr=firstNamed(style,'w:pPr'),rPr=firstNamed(style,'w:rPr'),outline=pPr&&firstNamed(pPr,'w:outlineLvl');
    styles.set(id,{id,name:firstNamed(style,'w:name')?.attrs['w:val']??id,basedOn:firstNamed(style,'w:basedOn')?.attrs['w:val']??null,
      outlineLevel:outline?Number(outline.attrs['w:val'])+1:null,bold:rPr?flag(rPr,'w:b'):null,size:rPr&&firstNamed(rPr,'w:sz')?Number(firstNamed(rPr,'w:sz').attrs['w:val'])/2:null,
      // A list style (List Bullet, 개조식) numbers its paragraphs through the style's numPr, not the paragraph's.
      numPr:pPr&&firstNamed(pPr,'w:numPr')?{numId:firstNamed(firstNamed(pPr,'w:numPr'),'w:numId')?.attrs['w:val']??null,ilvl:firstNamed(firstNamed(pPr,'w:numPr'),'w:ilvl')?.attrs['w:val']??null}:null});
  }
  // Outline level and size follow the basedOn chain, as Word resolves them.
  const resolve=(id,key,seen=new Set())=>{const style=styles.get(id);if(!style||seen.has(id))return null;seen.add(id);return style[key]??(style.basedOn?resolve(style.basedOn,key,seen):null);};
  for(const style of styles.values()){style.outlineLevel=resolve(style.id,'outlineLevel')??10;style.size=resolve(style.id,'size');style.numPr=resolve(style.id,'numPr');}
  return styles;
}
function readNumbering(xml){
  const abstracts=new Map(),nums=new Map();if(!xml)return {abstracts,nums};
  const root=findFirst(parseXml(xml),'w:numbering')??{children:[]};
  for(const abstract of childrenNamed(root,'w:abstractNum')){
    const levels=new Map();
    for(const lvl of childrenNamed(abstract,'w:lvl')){const ind=firstNamed(firstNamed(lvl,'w:pPr')??{children:[]},'w:ind');levels.set(Number(lvl.attrs['w:ilvl']),{format:firstNamed(lvl,'w:numFmt')?.attrs['w:val']??'decimal',text:firstNamed(lvl,'w:lvlText')?.attrs['w:val']??'',start:Number(firstNamed(lvl,'w:start')?.attrs['w:val']??1),indent:ind?Number(ind.attrs['w:left']??ind.attrs['w:start']??0)/20:null});}
    abstracts.set(abstract.attrs['w:abstractNumId'],levels);
  }
  for(const num of childrenNamed(root,'w:num'))nums.set(num.attrs['w:numId'],firstNamed(num,'w:abstractNumId')?.attrs['w:val']??null);
  return {abstracts,nums};
}
const numberText=(format,n)=>format==='ganada'||format==='chosung'?HANGUL[(n-1)%HANGUL.length]:format==='lowerLetter'?String.fromCharCode(96+((n-1)%26)+1):format==='upperLetter'?String.fromCharCode(64+((n-1)%26)+1):format==='upperRoman'?roman(n):format==='lowerRoman'?roman(n).toLowerCase():String(n);
const roman=n=>{const table=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];let out='';for(const [value,letters] of table)while(n>=value){out+=letters;n-=value;}return out;};

function runFormat(rPr){
  return {bold:rPr?flag(rPr,'w:b'):false,size:rPr&&firstNamed(rPr,'w:sz')?Number(firstNamed(rPr,'w:sz').attrs['w:val'])/2:null,font:rPr?(firstNamed(rPr,'w:rFonts')?.attrs['w:eastAsia']??firstNamed(rPr,'w:rFonts')?.attrs['w:ascii']??null):null};
}
// The text of one run: w:t, tabs and breaks; deleted text (w:delText) is not part of the paragraph.
// Text inside a shape (a text box, a picture's alt text) belongs to the shape, not to the paragraph that anchors it.
const SHAPE_TEXT=new Set(['w:drawing','w:pict','w:object','mc:AlternateContent']);
// What a paragraph holds besides text runs (Task J3, 2026-10-21). A write rebuilds the paragraph from its text runs, so
// anything it would drop makes the paragraph read-only (blocking): an inline picture or object, an equation, a link, a
// note or comment mark, a tracked change, a symbol. A floating shape (a text box, a picture placed by position) is kept
// as it is (anchored runs). Bookmarks and permission marks are kept by the writer; spelling marks may go.
const KEPT=new Set(['w:pPr','w:bookmarkStart','w:bookmarkEnd','w:proofErr','w:permStart','w:permEnd']);
const RUN_BLOCKING=new Set(['w:object','w:footnoteReference','w:endnoteReference','w:commentReference','w:sym','w:fldChar','w:instrText','w:ptab','w:ruby','w:separator','w:continuationSeparator']);
const anchoredOnly=node=>findAll(node,'wp:anchor').length>0&&!findAll(node,'wp:inline').length;
export function paragraphObjects(p){
  const anchored=[];let blocking=false;
  for(const child of p.children){
    if(!isElement(child)||KEPT.has(child.name))continue;
    if(child.name!=='w:r'){blocking=true;continue;}
    let floating=false;
    for(const part of child.children){
      if(!isElement(part))continue;
      if(RUN_BLOCKING.has(part.name))blocking=true;
      else if(part.name==='w:drawing'){if(anchoredOnly(part))floating=true;else blocking=true;}
      else if(part.name==='mc:AlternateContent'){const choice=firstNamed(part,'mc:Choice');if(choice&&anchoredOnly(choice))floating=true;else blocking=true;}
      else if(part.name==='w:pict')blocking=true;
    }
    if(floating)anchored.push(child);
  }
  return {blocking,anchored};
}
// The text boxes of a part in document order (Task J3): the DrawingML copy of each, paired with its VML copy for older
// Word (mc:Fallback) when the file has one. Writes change both, so the two never disagree.
export function textBoxes(root){
  const out=[];
  const walk=node=>{
    for(const child of node.children){
      if(!isElement(child))continue;
      if(child.name==='mc:AlternateContent'){
        const choice=firstNamed(child,'mc:Choice'),fallback=firstNamed(child,'mc:Fallback');
        const main=choice?findAll(choice,'w:txbxContent'):[],copies=fallback?findAll(fallback,'w:txbxContent'):[];
        if(main.length){main.forEach((node,k)=>out.push({node,copy:copies.length===main.length?copies[k]:null}));continue;}
        if(fallback){for(const node of copies)out.push({node,copy:null});continue;}
      }
      if(child.name==='w:txbxContent'){out.push({node:child,copy:null});continue;}
      walk(child);
    }
  };
  walk(root);return out;
}
// Legacy form fields of a paragraph (Task J4): FORMTEXT, FORMCHECKBOX and FORMDROPDOWN as begin (with ffData),
// instruction, separate, shown result and end runs. A field inside another field's result is not one to write.
export function legacyFields(p){
  const out=[];let current=null,depth=0;
  for(const run of p.children){
    if(!isElement(run)||run.name!=='w:r')continue;
    let marker=false;
    for(const part of run.children){
      if(!isElement(part))continue;
      if(part.name==='w:fldChar'){
        marker=true;const type=part.attrs['w:fldCharType'];
        if(type==='begin'){if(current){depth++;current.nested=true;continue;}const ffData=firstNamed(part,'w:ffData');if(ffData){current={begin:run,ffData,instr:'',separate:null,results:[],end:null,nested:false};depth=0;}continue;}
        if(!current)continue;
        if(type==='separate'&&depth===0)current.separate=run;
        else if(type==='end'){if(depth>0)depth--;else{current.end=run;out.push(current);current=null;}}
      }else if(current&&depth===0&&!current.separate&&part.name==='w:instrText')current.instr+=part.children.filter(x=>typeof x==='string').join('');
    }
    if(current&&current.separate&&!marker&&depth===0)current.results.push(run);
  }
  return out;
}
export function legacyState(field){
  const ff=field.ffData,on=node=>node&&!['0','false','off'].includes(String(node.attrs['w:val']??'1').toLowerCase());
  const enabled=!firstNamed(ff,'w:enabled')||on(firstNamed(ff,'w:enabled')),box=firstNamed(ff,'w:checkBox'),list=firstNamed(ff,'w:ddList'),input=firstNamed(ff,'w:textInput');
  const base={name:firstNamed(ff,'w:name')?.attrs['w:val']??'',enabled};
  if(box)return {...base,controlType:'checkbox',checked:on(firstNamed(box,'w:checked')??firstNamed(box,'w:default'))??false};
  if(list){const options=childrenNamed(list,'w:listEntry').map(entry=>({text:entry.attrs['w:val']??'',value:entry.attrs['w:val']??''}));const at=Number(firstNamed(list,'w:result')?.attrs['w:val']??firstNamed(list,'w:default')?.attrs['w:val']??0);return {...base,controlType:'dropdown',options,selected:at,text:options[at]?.text??''};}
  const max=Number(firstNamed(input??{children:[]},'w:maxLength')?.attrs['w:val']??0);
  return {...base,controlType:input?'text':'other',text:field.results.map(runText).join(''),...(max>0?{maxLength:max}:{})};
}
export function documentEditing(settings){
  if(!settings)return {};
  const edit=/<w:documentProtection\b([^>]*)\/?>/.exec(settings),attr=(text,name)=>new RegExp(`w:${name}="([^"]*)"`).exec(text)?.[1];
  const protection=edit&&attr(edit[1],'edit')&&attr(edit[1],'edit')!=='none'?{edit:attr(edit[1],'edit'),enforced:['1','true','on'].includes(String(attr(edit[1],'enforcement')??'0').toLowerCase())}:null;
  const track=/<w:trackRevisions\b(?![^>]*w:val="(?:0|false|off)")[^>]*\/?>/.test(settings)||protection?.enforced&&protection.edit==='trackedChanges';
  return {...(protection?{protection}:{}),...(track?{trackRevisions:true}:{})};
}
// The rows of a table through content control wrappers (Task J6): a repeating section (Word 2013+) wraps each row in
// an item control. item: the control whose content is that row, when there is one.
export function tableRows(table){
  const out=[];
  const walk=(node,item)=>{for(const child of node.children){if(!isElement(child))continue;
    if(child.name==='w:tr')out.push({row:child,item});
    else if(child.name==='w:sdt'){const content=firstNamed(child,'w:sdtContent');if(content)walk(content,child);}
    else if(child.name==='w:customXml')walk(child,item);}};
  walk(table,null);return out;
}
// Bookmarks the author named (Task J6; not Word's hidden _Ref, _Toc, _GoBack ones) that hold only text in one paragraph.
// The map makes a slot of an empty one (a value's place); one around text is a cross-reference target and stays as it is.
// A filled bookmark is still listed, so a write can be checked and is not repeated.
export function bookmarkPoints(p){
  const out=[],kids=p.children.filter(isElement);
  kids.forEach((child,k)=>{
    if(child.name!=='w:bookmarkStart')return;const name=child.attrs['w:name']??'',id=child.attrs['w:id'];
    if(!name||name.startsWith('_'))return;
    const endAt=kids.findIndex((other,j)=>j>k&&other.name==='w:bookmarkEnd'&&other.attrs['w:id']===id);if(endAt<0)return;
    const inner=kids.slice(k+1,endAt);if(inner.some(node=>node.name!=='w:r'||node.children.some(part=>isElement(part)&&!['w:rPr','w:t','w:tab'].includes(part.name))))return;
    const before=kids.slice(0,k).filter(node=>node.name==='w:r').map(runText).join('');
    out.push({name,start:child,end:kids[endAt],inner,before:before.replace(/[\s:：]+$/,'').trim().slice(-40),previous:kids.slice(0,k).filter(node=>node.name==='w:r').at(-1)??null});
  });
  return out;
}
// XML-bound controls (Task J8): the data store a binding names (custom XML items by their itemID; Word's fixed ids for
// the core and extended document properties) and the element a simple XPath (/p:a[1]/p:b[1]) selects in it. A path
// Word allows but this reader does not (predicates, attributes, functions) is not resolved, and the control is not written.
const PROPERTY_STORES={'{6C3C8BC8-F283-45AE-878A-BAB7291924A1}':'docProps/core.xml','{6668398D-A668-4E3E-A5EB-62B293D839F1}':'docProps/app.xml'};
export async function bindingStores(zip){
  const stores=new Map(),read=async part=>{const file=zip.file(part);return file?file.async('string'):null;};
  for(const name of Object.keys(zip.files)){
    const match=/^customXml\/itemProps(\d+)\.xml$/.exec(name);if(!match)continue;
    const id=/:itemID="([^"]+)"/.exec(await read(name)??'')?.[1],part=`customXml/item${match[1]}.xml`,xml=await read(part);
    if(id&&xml)stores.set(id.toUpperCase(),{part,xml});
  }
  for(const [id,part] of Object.entries(PROPERTY_STORES)){const xml=await read(part);if(xml)stores.set(id,{part,xml});}
  return stores;
}
export function resolveBinding(stores,binding){
  const store=stores?.get(String(binding?.storeItemID??'').toUpperCase());if(!store)return null;
  const prefixes=new Map([...String(binding.prefixMappings??'').matchAll(/xmlns:([\w.-]+)\s*=\s*['"]([^'"]+)['"]/g)].map(m=>[m[1],m[2]]));
  const steps=String(binding.xpath??'').split('/').filter(Boolean).map(step=>/^(?:([\w.-]+):)?([\w.-]+)(?:\[(\d+)\])?$/.exec(step));
  if(!steps.length||steps.some(step=>!step))return null;
  const scopeOf=(node,inherited)=>{const scope=new Map(inherited);for(const [key,value] of Object.entries(node.attrs??{})){if(key==='xmlns')scope.set('',value);else if(key.startsWith('xmlns:'))scope.set(key.slice(6),value);}return scope;};
  let node=parseXml(store.xml),scope=new Map();
  for(const [,prefix,local,index] of steps){
    const want=prefix?prefixes.get(prefix):'';if(want===undefined)return null;
    const matches=node.children.filter(isElement).map(child=>({child,scope:scopeOf(child,scope)})).filter(({child,scope:inner})=>{const [p,l]=child.name.includes(':')?child.name.split(':'):['',child.name];return l===local&&(inner.get(p)??'')===want;});
    const found=matches[Number(index??1)-1];if(!found)return null;node=found.child;scope=found.scope;
  }
  if(node.children.some(isElement))return null;
  return {part:store.part,node,text:node.children.filter(x=>typeof x==='string').join('')};
}
export function runText(run){
  let text='';
  const walk=node=>{for(const child of node.children){if(!isElement(child))continue;if(child.name==='w:t')text+=child.children.filter(x=>typeof x==='string').join('');else if(child.name==='w:tab')text+='\t';else if(child.name==='w:br'||child.name==='w:cr')text+='\n';else if(child.name==='w:noBreakHyphen')text+='-';else if(!SHAPE_TEXT.has(child.name)&&child.name!=='w:rPr'&&child.name!=='w:delText')walk(child);}};
  walk(run);return text;
}
// Runs in reading order, through hyperlinks, simple fields and inline content controls; tracked deletions are skipped.
function collectRuns(node,out,counts){
  for(const child of node.children){
    if(!isElement(child))continue;
    if(child.name==='w:r'){const text=runText(child);counts.fieldChars+=childrenNamed(child,'w:fldChar').filter(x=>x.attrs['w:fldCharType']==='begin').length;if(text)out.push({...runFormat(firstNamed(child,'w:rPr')),text});continue;}
    if(child.name==='w:fldSimple'){counts.fields++;collectRuns(child,out,counts);continue;}
    if(child.name==='w:sdt'){counts.controls++;const content=firstNamed(child,'w:sdtContent');if(content)collectRuns(content,out,counts);continue;}
    if(child.name==='w:del'||child.name==='w:pPr'||child.name==='w:rPr')continue;
    collectRuns(child,out,counts);
  }
}
const sameFormat=(a,b)=>a.bold===b.bold&&a.size===b.size&&a.font===b.font;

class Reader{
  constructor(parts){this.stores=parts.stores??null;this.styles=readStyles(parts.styles);this.numbering=readNumbering(parts.numbering);this.counters=new Map();this.items=[];this.locations=new Map();this.fields=0;this.paragraphs=0;this.tables=0;this.legacyFields=0;this.bookmarks=0;}
  bookmark(paragraph,id,writable){
    for(const point of bookmarkPoints(paragraph)){
      const key='bm-'+(++this.bookmarks);
      this.items.push({id:key,kind:'bookmark',name:point.name,before:point.before,text:point.inner.map(runText).join(''),paragraph:id,editable:false,writable});
      this.locations.set(key,{start:point.start.start,end:point.end.end});
    }
  }
  // Legacy form fields get ids of their own (ff-N), so content control ids (f-N) of existing forms do not move.
  legacy(paragraph,where){
    for(const field of legacyFields(paragraph)){
      const state=legacyState(field),id='ff-'+(++this.legacyFields);
      const writable=state.enabled&&!field.nested&&['text','checkbox','dropdown'].includes(state.controlType);
      this.items.push({id,kind:'field',legacy:true,tag:'',title:'',showingPlaceholder:false,...state,text:state.controlType==='text'?state.text.replace(/\u00a0/g,' ').trim()?state.text:'':state.text??'',editable:false,writable,...(typeof where==='string'?{paragraph:where}:where)});
      this.locations.set(id,{start:field.begin.start,end:field.end.end});
    }
  }
  styleOf(id){return id&&this.styles.get(id)||null;}
  listInfo(pPr,style){
    const own=pPr&&firstNamed(pPr,'w:numPr'),numId=(own&&firstNamed(own,'w:numId')?.attrs['w:val'])??style?.numPr?.numId,level=Number((own&&firstNamed(own,'w:ilvl')?.attrs['w:val'])??style?.numPr?.ilvl??0);
    if(!numId||numId==='0')return {listString:null};
    const lvl=this.numbering.abstracts.get(this.numbering.nums.get(numId))?.get(level);
    return {listString:this.listString(pPr,style),listLevel:level,...(lvl?.indent!=null?{listIndent:lvl.indent}:{})};
  }
  listString(pPr,style){
    const numPr=pPr&&firstNamed(pPr,'w:numPr');if(!numPr&&!style?.numPr)return null;
    const numId=(numPr&&firstNamed(numPr,'w:numId')?.attrs['w:val'])??style.numPr.numId,level=Number((numPr&&firstNamed(numPr,'w:ilvl')?.attrs['w:val'])??style?.numPr?.ilvl??0);
    const abstract=this.numbering.abstracts.get(this.numbering.nums.get(numId));const lvl=abstract?.get(level);if(!numId||!lvl)return null;
    for(const key of [...this.counters.keys()])if(key.startsWith(numId+'/')&&Number(key.slice(numId.length+1))>level)this.counters.delete(key);
    const n=(this.counters.get(numId+'/'+level)??lvl.start-1)+1;this.counters.set(numId+'/'+level,n);
    if(lvl.format==='bullet')return lvl.text||'-';
    return lvl.text.replace(/%\d/g,numberText(lvl.format,n))||numberText(lvl.format,n)+'.';
  }
  paragraph(node){
    const pPr=firstNamed(node,'w:pPr'),styleId=pPr&&firstNamed(pPr,'w:pStyle')?.attrs['w:val'],style=this.styleOf(styleId);
    const outline=pPr&&firstNamed(pPr,'w:outlineLvl');const outlineLevel=outline?Number(outline.attrs['w:val'])+1:style?.outlineLevel??10;
    const runs=[],counts={fields:0,fieldChars:0,controls:0};collectRuns(node,runs,counts);
    const merged=runs.reduce((out,run)=>{const last=out.at(-1);if(last&&sameFormat(last,run))last.text+=run.text;else out.push({...run});return out;},[]);
    const text=merged.map(run=>run.text).join(''),fields=counts.fields+counts.fieldChars;
    const paragraphBold=pPr&&firstNamed(pPr,'w:rPr')?flag(firstNamed(pPr,'w:rPr'),'w:b'):false;
    const bold=merged.length?merged.every(run=>run.bold):paragraphBold||style?.bold===true;
    const objects=paragraphObjects(node),writable=!fields&&!counts.controls&&!objects.blocking,editable=writable&&merged.length<=1&&text.length<=4000;
    let at=0;const textRuns=merged.map(run=>{const entry={start:at,length:run.text.length};at+=run.text.length;return entry;});
    return {...(objects.anchored.length?{anchored:objects.anchored.length}:{}),text:text.slice(0,4000),truncated:text.length>4000,style:style?.name??styleId??'Normal',...(style?.size?{fontSize:style.size}:{}),outlineLevel,...this.listInfo(pPr,style),bold,editable,writable,fields,controls:counts.controls,runs:merged.length,textRuns,fragmentEditable:writable&&merged.length>0&&merged.length<=128,range:{start:node.start,end:node.end}};
  }
  field(node,where=null){
    const pr=firstNamed(node,'w:sdtPr')??{children:[]},content=firstNamed(node,'w:sdtContent');
    const type=['w:date','w:dropDownList','w:comboBox','w:checkbox','w14:checkbox','w:picture','w:text','w:richText'].find(name=>firstNamed(pr,name));
    const controlType={'w:date':'date','w:dropDownList':'dropdown','w:comboBox':'combo','w:checkbox':'checkbox','w14:checkbox':'checkbox','w:picture':'picture','w:text':'text'}[type]??'richText';
    const runs=[],counts={fields:0,fieldChars:0,controls:0};if(content)collectRuns(content,runs,counts);
    const id='f-'+(++this.fields),text=runs.map(run=>run.text).join('');
    // Typed state (Task J1): a checkbox's checked value, list items, a date's stored value and display format. The fill
    // writes these, never free text into a checkbox or an unlisted item into a dropdown. A locked control is not written.
    const box=firstNamed(pr,'w14:checkbox'),list=firstNamed(pr,'w:dropDownList')??firstNamed(pr,'w:comboBox'),date=firstNamed(pr,'w:date');
    const locked=['contentLocked','sdtContentLocked'].includes(firstNamed(pr,'w:lock')?.attrs['w:val']);
    const typed={
      ...(box?{checked:['1','true','on'].includes(String(firstNamed(box,'w14:checked')?.attrs['w14:val']??'0').toLowerCase())}:{}),
      ...(list?{options:childrenNamed(list,'w:listItem').map(item=>({text:item.attrs['w:displayText']??item.attrs['w:value']??'',value:item.attrs['w:value']??item.attrs['w:displayText']??''}))}:{}),
      ...(controlType==='picture'&&content?{image:findAll(content,'a:blip')[0]?.attrs['r:embed']??null}:{}),
      ...(date?{date:/^\d{4}-\d{2}-\d{2}/.test(date.attrs['w:fullDate']??'')?date.attrs['w:fullDate'].slice(0,10):null,dateFormat:firstNamed(date,'w:dateFormat')?.attrs['w:val']??null}:{})};
    // A control bound to custom XML (w:dataBinding) is rewritten from that XML when Word opens the file: not written here.
    const bound=firstNamed(pr,'w:dataBinding'),mapped=!!bound,binding=bound?{xpath:bound.attrs['w:xpath']??'',prefixMappings:bound.attrs['w:prefixMappings']??'',storeItemID:bound.attrs['w:storeItemID']??''}:null;
    const resolvable=!bound||!!resolveBinding(this.stores,binding);
    const writable=!!content&&!locked&&resolvable&&(['text','richText','checkbox','dropdown','combo','date'].includes(controlType)||controlType==='picture'&&findAll(content,'a:blip').length===1)&&!findAll(content,'w:sdt').length;
    this.items.push({id,kind:'field',tag:firstNamed(pr,'w:tag')?.attrs['w:val']??'',title:firstNamed(pr,'w:alias')?.attrs['w:val']??'',controlType,showingPlaceholder:!!firstNamed(pr,'w:showingPlcHdr'),text:text.slice(0,4000),...typed,editable:false,writable,...(locked?{locked:true}:{}),...(mapped?{mapped:true,binding,...(date?{storeMappedDataAs:firstNamed(date,'w:storeMappedDataAs')?.attrs['w:val']??'dateTime'}:{})}:{}),...(typeof where==='string'?{paragraph:where}:where??{})});
    this.locations.set(id,{start:node.start,end:node.end});
  }
  body(body){
    for(const child of body.children){
      if(!isElement(child))continue;
      if(child.name==='w:p'){
        const id='p-'+(++this.paragraphs),{range,...item}=this.paragraph(child);
        this.items.push({id,kind:'paragraph',...item,inTable:false});this.locations.set(id,range);
        for(const sdt of findAll(child,'w:sdt'))this.field(sdt,id);
        this.legacy(child,id);
        // A bookmark write changes only what is between its marks, so it does not depend on the rest of the paragraph.
        this.bookmark(child,id,true);
      }else if(child.name==='w:tbl')this.table(child,++this.tables);
      else if(child.name==='w:sdt'){const content=firstNamed(child,'w:sdtContent');if(content&&childrenNamed(content,'w:tbl').length)this.body(content);else this.field(child);}
    }
  }
  table(node,t){
    let r=0;
    for(const {row} of tableRows(node)){
      r++;let c=0;
      for(const cell of childrenNamed(row,'w:tc')){
        const tcPr=firstNamed(cell,'w:tcPr'),vMerge=tcPr&&firstNamed(tcPr,'w:vMerge');
        // A vertically merged continuation is the cell above, not a cell of its own.
        if(vMerge&&vMerge.attrs['w:val']!=='restart')continue;
        c++;
        // Word counts cell paragraphs in the p-N sequence (Office ledger note, 2026-10-01); so does this reader.
        const paragraphs=childrenNamed(cell,'w:p').map(p=>{this.paragraphs++;return this.paragraph(p);});
        const first=paragraphs[0]??{text:'',style:'Normal',bold:false,fields:0,controls:0,runs:0,textRuns:[],editable:true,writable:true,range:{start:cell.start,end:cell.end}};
        const text=paragraphs.map(p=>p.text).join('\n'),fields=paragraphs.reduce((n,p)=>n+p.fields,0),controls=paragraphs.reduce((n,p)=>n+p.controls,0);
        // A cell is written in its first paragraph and loses its other paragraphs: none of them may hold anything else.
        const writable=!fields&&!controls&&paragraphs.every(p=>p.writable!==false)&&paragraphs.slice(1).every(p=>!p.anchored),editable=writable&&paragraphs.length<=1&&first.runs<=1;
        const id=`t${t}/r${r}/c${c}`;
        this.items.push({id,kind:'cell',table:t,row:r,column:c,span:Number((tcPr&&firstNamed(tcPr,'w:gridSpan')?.attrs['w:val'])??1),width:Number((tcPr&&firstNamed(tcPr,'w:tcW')?.attrs['w:w'])??0),
          text:text.slice(0,4000),style:first.style,...(first.fontSize?{fontSize:first.fontSize}:{}),bold:paragraphs.length?paragraphs.every(p=>p.bold||!p.text):false,editable,writable,fields,controls,runs:first.runs,textRuns:first.textRuns,fragmentEditable:editable});
        this.locations.set(id,{start:cell.start,end:cell.end,paragraph:first.range});
        // Controls in a cell (a checkbox, a date) follow the cell, in the order the writer counts them (docx-apply locate).
        for(const child of cell.children){if(!isElement(child))continue;if(child.name==='w:p'){for(const sdt of findAll(child,'w:sdt'))this.field(sdt,{cell:id});this.legacy(child,{cell:id});}else if(child.name==='w:sdt')this.field(child,{cell:id});}
      }
    }
  }
}
function findAll(node,name,out=[]){for(const child of node.children){if(!isElement(child))continue;if(child.name===name)out.push(child);else findAll(child,name,out);}return out;}

/** The snapshot of the XML parts (document, styles, numbering) already read out of a docx. */
export function snapshotParts(parts,{name='양식.docx',fingerprint=''}={}){
  if(typeof parts?.document!=='string')fail('docx_invalid');
  const reader=new Reader({styles:parts.styles??null,numbering:parts.numbering??null,stores:parts.stores??null});
  const body=findFirst(parseXml(parts.document),'w:body');if(!body)fail('docx_invalid');
  reader.body(body);
  // Text boxes of the body (Task J3) are parts of their own: "box1:p-1".
  const boxes=textBoxes(body).map((box,k)=>({key:'box'+(k+1),kind:'textbox',type:'default',root:box.node,part:'word/document.xml'}));
  // Headers and footers (Task J2): read like the body, each in its own counters, ids prefixed with the part
  // ("header1:t1/r1/c2"), so they never meet a body id and the writer knows which part to change.
  for(const extra of [...boxes,...(parts.extras??[])]){
    const top=extra.root??parseXml(extra.xml).children.find(child=>isElement(child)&&['w:hdr','w:ftr'].includes(child.name));if(!top)continue;
    const sub=new Reader({styles:parts.styles??null,numbering:parts.numbering??null,stores:parts.stores??null});sub.body(top);
    const id=value=>value?extra.key+':'+value:value;
    for(const item of sub.items)reader.items.push({...item,id:id(item.id),...(item.paragraph?{paragraph:id(item.paragraph)}:{}),...(item.cell?{cell:id(item.cell)}:{}),...(item.table!==undefined?{table:extra.key+':'+item.table}:{}),part:extra.key,partKind:extra.kind,partType:extra.type});
    for(const [key,location] of sub.locations)reader.locations.set(id(key),{...location,part:extra.part});
  }
  // Restrict Editing and Track Changes (Task J7): what Word lets a person do in this file.
  const editing=documentEditing(parts.settings);
  if(editing.protection?.enforced){
    const formsOnly=editing.protection.edit==='forms',readOnly=['readOnly','comments'].includes(editing.protection.edit);
    for(const item of reader.items)if(readOnly||formsOnly&&item.kind!=='field')Object.assign(item,{writable:false,editable:false,...(item.fragmentEditable!==undefined?{fragmentEditable:false}:{})});
  }
  return {host:'word',...editing,name,scopeId:'docx:'+String(fingerprint).slice(7,19),fingerprint,items:reader.items,styles:[...reader.styles.values()].map(({id,name:styleName,outlineLevel,size})=>({id,name:styleName,outlineLevel,size})),locations:reader.locations,documentXml:parts.document};
}
/** The XML parts of a docx. */
export async function docxParts(bytes){
  if(!bytes||!bytes.length)fail('docx_invalid');
  let zip;try{zip=await JSZip.loadAsync(bytes);}catch{fail('docx_invalid');}
  const part=async path=>{const file=zip.file(path);return file?await file.async('string'):null;};
  const document=await part('word/document.xml');if(!document)fail('docx_invalid');
  // Header and footer parts the document references, with the type of page they are for (default, first, even).
  const rels=await part('word/_rels/document.xml.rels'),types=new Map(),extras=[];
  for(const match of document.matchAll(/<w:(header|footer)Reference\b([^>]*)\/?>/g)){const rid=/r:id="([^"]+)"/.exec(match[2])?.[1],type=/w:type="([^"]+)"/.exec(match[2])?.[1]??'default';if(rid&&!types.has(rid))types.set(rid,type);}
  for(const match of (rels??'').matchAll(/<Relationship\b([^>]*)\/?>/g)){
    const attr=name=>new RegExp(`\\b${name}="([^"]*)"`).exec(match[1])?.[1],kind=/\/(header|footer)$/.exec(attr('Type')??'')?.[1];
    if(!kind||attr('TargetMode')==='External')continue;
    const target=attr('Target')??'',path=target.startsWith('/')?target.slice(1):'word/'+target.replace(/^\.\//,'');
    if(!/^word\/[\w.-]+\.xml$/.test(path)||extras.some(extra=>extra.part===path))continue;
    const xml=await part(path);if(xml)extras.push({part:path,key:path.slice(5,-4),kind,type:types.get(attr('Id'))??'default',xml});
  }
  extras.sort((a,b)=>(a.kind===b.kind?0:a.kind==='header'?-1:1)||a.part.localeCompare(b.part,undefined,{numeric:true}));
  return {zip,document,styles:await part('word/styles.xml'),numbering:await part('word/numbering.xml'),settings:await part('word/settings.xml'),extras,stores:await bindingStores(zip)};
}
/** The snapshot of a docx: items in document order, resolved styles and the XML location of each item. */
export async function docxSnapshot(bytes,{name='양식.docx'}={}){
  const parts=await docxParts(bytes);
  return snapshotParts(parts,{name,fingerprint:hash(bytes)});
}
/** The form map of a docx, built by the Office form map code from the snapshot. */
export async function extractFormMap(bytes,options={}){
  const snapshot=await docxSnapshot(bytes,options);
  return {map:wordFormMap(snapshot),hash:snapshot.fingerprint,items:snapshot.items,snapshot};
}
