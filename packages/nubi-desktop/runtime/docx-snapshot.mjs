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
const isElement=node=>typeof node==='object'&&node!==null;
const childrenNamed=(node,name)=>node.children.filter(child=>isElement(child)&&child.name===name);
const firstNamed=(node,name)=>node.children.find(child=>isElement(child)&&child.name===name)??null;
const findFirst=(node,name)=>{for(const child of node.children){if(!isElement(child))continue;if(child.name===name)return child;const found=findFirst(child,name);if(found)return found;}return null;};
const flag=(node,name)=>{const found=firstNamed(node,name);if(!found)return false;const value=found.attrs['w:val'];return value===undefined||!['0','false','off'].includes(value);};

function readStyles(xml){
  const styles=new Map();if(!xml)return styles;
  for(const style of childrenNamed(findFirst(parseXml(xml),'w:styles')??{children:[]},'w:style')){
    const id=style.attrs['w:styleId'];if(!id)continue;
    const pPr=firstNamed(style,'w:pPr'),rPr=firstNamed(style,'w:rPr'),outline=pPr&&firstNamed(pPr,'w:outlineLvl');
    styles.set(id,{id,name:firstNamed(style,'w:name')?.attrs['w:val']??id,basedOn:firstNamed(style,'w:basedOn')?.attrs['w:val']??null,
      outlineLevel:outline?Number(outline.attrs['w:val'])+1:null,bold:rPr?flag(rPr,'w:b'):null,size:rPr&&firstNamed(rPr,'w:sz')?Number(firstNamed(rPr,'w:sz').attrs['w:val'])/2:null});
  }
  // Outline level and size follow the basedOn chain, as Word resolves them.
  const resolve=(id,key,seen=new Set())=>{const style=styles.get(id);if(!style||seen.has(id))return null;seen.add(id);return style[key]??(style.basedOn?resolve(style.basedOn,key,seen):null);};
  for(const style of styles.values()){style.outlineLevel=resolve(style.id,'outlineLevel')??10;style.size=resolve(style.id,'size');}
  return styles;
}
function readNumbering(xml){
  const abstracts=new Map(),nums=new Map();if(!xml)return {abstracts,nums};
  const root=findFirst(parseXml(xml),'w:numbering')??{children:[]};
  for(const abstract of childrenNamed(root,'w:abstractNum')){
    const levels=new Map();
    for(const lvl of childrenNamed(abstract,'w:lvl'))levels.set(Number(lvl.attrs['w:ilvl']),{format:firstNamed(lvl,'w:numFmt')?.attrs['w:val']??'decimal',text:firstNamed(lvl,'w:lvlText')?.attrs['w:val']??'',start:Number(firstNamed(lvl,'w:start')?.attrs['w:val']??1)});
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
function runText(run){
  let text='';
  const walk=node=>{for(const child of node.children){if(!isElement(child))continue;if(child.name==='w:t')text+=child.children.filter(x=>typeof x==='string').join('');else if(child.name==='w:tab')text+='\t';else if(child.name==='w:br'||child.name==='w:cr')text+='\n';else if(child.name==='w:noBreakHyphen')text+='-';else if(child.name!=='w:rPr'&&child.name!=='w:delText')walk(child);}};
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
  constructor(parts){this.styles=readStyles(parts.styles);this.numbering=readNumbering(parts.numbering);this.counters=new Map();this.items=[];this.locations=new Map();this.fields=0;this.paragraphs=0;this.tables=0;}
  styleOf(id){return id&&this.styles.get(id)||null;}
  listString(pPr){
    const numPr=pPr&&firstNamed(pPr,'w:numPr');if(!numPr)return null;
    const numId=firstNamed(numPr,'w:numId')?.attrs['w:val'],level=Number(firstNamed(numPr,'w:ilvl')?.attrs['w:val']??0);
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
    const writable=!fields&&!counts.controls,editable=writable&&merged.length<=1&&text.length<=4000;
    let at=0;const textRuns=merged.map(run=>{const entry={start:at,length:run.text.length};at+=run.text.length;return entry;});
    return {text:text.slice(0,4000),truncated:text.length>4000,style:style?.name??styleId??'Normal',...(style?.size?{fontSize:style.size}:{}),outlineLevel,listString:this.listString(pPr),bold,editable,writable,fields,controls:counts.controls,runs:merged.length,textRuns,fragmentEditable:writable&&merged.length>0&&merged.length<=128,range:{start:node.start,end:node.end}};
  }
  field(node,paragraphId=null){
    const pr=firstNamed(node,'w:sdtPr')??{children:[]},content=firstNamed(node,'w:sdtContent');
    const type=['w:date','w:dropDownList','w:comboBox','w:checkbox','w14:checkbox','w:picture','w:text','w:richText'].find(name=>firstNamed(pr,name));
    const controlType={'w:date':'date','w:dropDownList':'dropdown','w:comboBox':'combo','w:checkbox':'checkbox','w14:checkbox':'checkbox','w:picture':'picture','w:text':'text'}[type]??'richText';
    const runs=[],counts={fields:0,fieldChars:0,controls:0};if(content)collectRuns(content,runs,counts);
    const id='f-'+(++this.fields),text=runs.map(run=>run.text).join('');
    this.items.push({id,kind:'field',tag:firstNamed(pr,'w:tag')?.attrs['w:val']??'',title:firstNamed(pr,'w:alias')?.attrs['w:val']??'',controlType,showingPlaceholder:!!firstNamed(pr,'w:showingPlcHdr'),text:text.slice(0,4000),editable:false,writable:false,...(paragraphId?{paragraph:paragraphId}:{})});
    this.locations.set(id,{start:node.start,end:node.end});
  }
  body(body){
    for(const child of body.children){
      if(!isElement(child))continue;
      if(child.name==='w:p'){
        const id='p-'+(++this.paragraphs),{range,...item}=this.paragraph(child);
        this.items.push({id,kind:'paragraph',...item,inTable:false});this.locations.set(id,range);
        for(const sdt of findAll(child,'w:sdt'))this.field(sdt,id);
      }else if(child.name==='w:tbl')this.table(child,++this.tables);
      else if(child.name==='w:sdt'){const content=firstNamed(child,'w:sdtContent');if(content&&childrenNamed(content,'w:tbl').length)this.body(content);else this.field(child);}
    }
  }
  table(node,t){
    let r=0;
    for(const row of childrenNamed(node,'w:tr')){
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
        const writable=!fields&&!controls,editable=writable&&paragraphs.length<=1&&first.runs<=1;
        const id=`t${t}/r${r}/c${c}`;
        this.items.push({id,kind:'cell',table:t,row:r,column:c,span:Number((tcPr&&firstNamed(tcPr,'w:gridSpan')?.attrs['w:val'])??1),width:Number((tcPr&&firstNamed(tcPr,'w:tcW')?.attrs['w:w'])??0),
          text:text.slice(0,4000),style:first.style,...(first.fontSize?{fontSize:first.fontSize}:{}),bold:paragraphs.length?paragraphs.every(p=>p.bold||!p.text):false,editable,writable,fields,controls,runs:first.runs,textRuns:first.textRuns,fragmentEditable:editable});
        this.locations.set(id,{start:cell.start,end:cell.end,paragraph:first.range});
      }
    }
  }
}
function findAll(node,name,out=[]){for(const child of node.children){if(!isElement(child))continue;if(child.name===name)out.push(child);else findAll(child,name,out);}return out;}

/** The snapshot of the XML parts (document, styles, numbering) already read out of a docx. */
export function snapshotParts(parts,{name='양식.docx',fingerprint=''}={}){
  if(typeof parts?.document!=='string')fail('docx_invalid');
  const reader=new Reader({styles:parts.styles??null,numbering:parts.numbering??null});
  const body=findFirst(parseXml(parts.document),'w:body');if(!body)fail('docx_invalid');
  reader.body(body);
  return {host:'word',name,scopeId:'docx:'+String(fingerprint).slice(7,19),fingerprint,items:reader.items,styles:[...reader.styles.values()].map(({id,name:styleName,outlineLevel,size})=>({id,name:styleName,outlineLevel,size})),locations:reader.locations,documentXml:parts.document};
}
/** The XML parts of a docx. */
export async function docxParts(bytes){
  if(!bytes||!bytes.length)fail('docx_invalid');
  let zip;try{zip=await JSZip.loadAsync(bytes);}catch{fail('docx_invalid');}
  const part=async path=>{const file=zip.file(path);return file?await file.async('string'):null;};
  const document=await part('word/document.xml');if(!document)fail('docx_invalid');
  return {zip,document,styles:await part('word/styles.xml'),numbering:await part('word/numbering.xml')};
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
