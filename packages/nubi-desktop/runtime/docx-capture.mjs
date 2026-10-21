// The file engine of the registration capture (document forms plan Task I): a docx read without Word, as complete as
// the file allows. Every run with its font, size, colour and emphasis, every picture with its anchor and bytes, the
// headers, footers, footnotes and page setup. It exists for tests and for a Mac without Office; the product registers
// through the Office host (engine 'office'), and a capture from here says fidelity 'file'.
import {createHash} from 'node:crypto';
import {docxParts,parseXml,snapshotParts,isElement,childrenNamed,firstNamed,findFirst,flag,runText} from './docx-snapshot.mjs';
import {CAPTURE_SCHEMA_VERSION,validateCapture} from './office-capture.mjs';

const CONTENT_TYPES={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff',emf:'image/emf',wmf:'image/wmf',svg:'image/svg+xml'};
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const twips=value=>value===undefined||value===null||value===''?null:Math.round(Number(value)/20*100)/100;

function runFormatting(rPr){
  if(!rPr)return {};
  const fonts=firstNamed(rPr,'w:rFonts'),size=firstNamed(rPr,'w:sz'),color=firstNamed(rPr,'w:color'),highlight=firstNamed(rPr,'w:highlight'),shade=firstNamed(rPr,'w:shd'),underline=firstNamed(rPr,'w:u');
  return {
    ...(fonts?{font:fonts.attrs['w:eastAsia']??fonts.attrs['w:ascii']??fonts.attrs['w:hAnsi']??null}:{}),
    ...(size?{size:Number(size.attrs['w:val'])/2}:{}),
    ...(color&&color.attrs['w:val']&&color.attrs['w:val']!=='auto'?{color:'#'+color.attrs['w:val'].toUpperCase()}:{}),
    ...(flag(rPr,'w:b')?{bold:true}:{}),...(flag(rPr,'w:i')?{italic:true}:{}),...(flag(rPr,'w:strike')?{strike:true}:{}),
    ...(underline&&underline.attrs['w:val']&&underline.attrs['w:val']!=='none'?{underline:underline.attrs['w:val']}:{}),
    ...(highlight?{highlight:highlight.attrs['w:val']}:{}),...(shade&&shade.attrs['w:fill']&&shade.attrs['w:fill']!=='auto'?{shading:'#'+shade.attrs['w:fill'].toUpperCase()}:{})
  };
}
// Runs in reading order with their formatting; drawings and legacy pictures inside a run are collected as images.
function walkRuns(node,out,images,anchor){
  for(const child of node.children){
    if(!isElement(child))continue;
    if(child.name==='w:r'){
      for(const drawing of [...childrenNamed(child,'w:drawing'),...childrenNamed(child,'w:pict')])images.push(imageOf(drawing,anchor));
      const value=runText(child);if(value)out.push({text:value,...runFormatting(firstNamed(child,'w:rPr'))});
      continue;
    }
    if(['w:pPr','w:rPr','w:del'].includes(child.name))continue;
    walkRuns(child,out,images,anchor);
  }
}
function imageOf(drawing,anchor){
  const blip=findFirst(drawing,'a:blip'),imagedata=findFirst(drawing,'v:imagedata'),extent=findFirst(drawing,'wp:extent'),docPr=findFirst(drawing,'wp:docPr');
  const inline=!!firstNamed(drawing,'wp:inline')||drawing.name==='w:pict';
  return {anchor,rId:blip?.attrs['r:embed']??blip?.attrs['r:link']??imagedata?.attrs['r:id']??null,inline,
    ...(extent?{cx:Number(extent.attrs.cx),cy:Number(extent.attrs.cy),widthCm:Math.round(Number(extent.attrs.cx)/360000*100)/100,heightCm:Math.round(Number(extent.attrs.cy)/360000*100)/100}:{}),
    ...(docPr?{name:docPr.attrs.name??'',description:docPr.attrs.descr??''}:{})};
}
function relationships(xml){
  const map=new Map();if(!xml)return map;
  for(const rel of childrenNamed(findFirst(parseXml(xml),'Relationships')??{children:[]},'Relationship'))map.set(rel.attrs.Id,{target:rel.attrs.Target,type:rel.attrs.Type,mode:rel.attrs.TargetMode??'Internal'});
  return map;
}
function partText(xml){
  if(!xml)return {paragraphs:[],images:[]};
  const root=parseXml(xml),paragraphs=[],images=[];
  const body=root.children.find(isElement);if(!body)return {paragraphs,images};
  for(const [k,p] of (body.name==='w:p'?[body]:(function all(node,out=[]){for(const child of node.children){if(!isElement(child))continue;if(child.name==='w:p')out.push(child);else all(child,out);}return out;})(body)).entries()){
    const runs=[];walkRuns(p,runs,images,'part-p-'+(k+1));paragraphs.push({text:runs.map(r=>r.text).join(''),runs});
  }
  return {paragraphs,images};
}
function sectionOf(body){
  const sectPr=childrenNamed(body,'w:sectPr').at(-1);if(!sectPr)return null;
  const size=firstNamed(sectPr,'w:pgSz'),margin=firstNamed(sectPr,'w:pgMar');
  return {page:size?{widthMm:Math.round(Number(size.attrs['w:w'])/56.7),heightMm:Math.round(Number(size.attrs['w:h'])/56.7),orientation:size.attrs['w:orient']??'portrait'}:null,
    margins:margin?{top:twips(margin.attrs['w:top']),bottom:twips(margin.attrs['w:bottom']),left:twips(margin.attrs['w:left']),right:twips(margin.attrs['w:right'])}:null};
}
function tableOf(node,index){
  const rows=[];
  for(const [r,row] of childrenNamed(node,'w:tr').entries()){
    const cells=[];
    for(const [c,cell] of childrenNamed(row,'w:tc').entries()){
      const tcPr=firstNamed(cell,'w:tcPr'),shade=tcPr&&firstNamed(tcPr,'w:shd'),width=tcPr&&firstNamed(tcPr,'w:tcW'),span=tcPr&&firstNamed(tcPr,'w:gridSpan'),vMerge=tcPr&&firstNamed(tcPr,'w:vMerge'),borders=tcPr&&firstNamed(tcPr,'w:tcBorders');
      const runs=[],images=[];for(const p of childrenNamed(cell,'w:p'))walkRuns(p,runs,images,`t${index}/r${r+1}/c${c+1}`);
      cells.push({row:r+1,column:c+1,text:runs.map(x=>x.text).join(''),runs,span:Number(span?.attrs['w:val']??1),...(vMerge?{vMerge:vMerge.attrs['w:val']??'continue'}:{}),
        ...(width?{width:Number(width.attrs['w:w']),widthType:width.attrs['w:type']??'dxa'}:{}),...(shade&&shade.attrs['w:fill']&&shade.attrs['w:fill']!=='auto'?{shading:'#'+shade.attrs['w:fill'].toUpperCase()}:{}),
        ...(borders?{borders:childrenNamed(borders,'w:top').concat(childrenNamed(borders,'w:bottom'),childrenNamed(borders,'w:left'),childrenNamed(borders,'w:right')).map(b=>({side:b.name.slice(2),style:b.attrs['w:val'],size:Number(b.attrs['w:sz']??0),color:b.attrs['w:color']??'auto'}))}:{})});
    }
    rows.push(cells);
  }
  const tblPr=firstNamed(node,'w:tblPr'),style=tblPr&&firstNamed(tblPr,'w:tblStyle');
  return {id:'t'+index,rows,...(style?{style:style.attrs['w:val']}:{})};
}

/** The full file capture of a docx: contract v1 with engine 'file'. */
export async function docxCapture(bytes,{name='양식.docx'}={}){
  const parts=await docxParts(bytes),zip=parts.zip,document=parts.document;
  const snapshot=snapshotParts(parts,{name,fingerprint:hash(bytes)});
  const tree=parseXml(document),body=findFirst(tree,'w:body');
  const paragraphs=[],tables=[],images=[],controls=snapshot.items.filter(item=>item.kind==='field').map(({id,tag,title,controlType,showingPlaceholder,text})=>({id,tag,title,controlType,showingPlaceholder,text}));
  let p=0,t=0;
  const walkBody=container=>{
    for(const child of container.children){
      if(!isElement(child))continue;
      if(child.name==='w:p'){const id='p-'+(++p),runs=[];walkRuns(child,runs,images,id);const item=snapshot.items.find(x=>x.id===id);paragraphs.push({id,text:runs.map(r=>r.text).join(''),style:item?.style??null,outlineLevel:item?.outlineLevel??10,listString:item?.listString??null,runs});}
      else if(child.name==='w:tbl'){const table=tableOf(child,++t);tables.push(table);p+=table.rows.reduce((n,row)=>n+row.length,0);}
      else if(child.name==='w:sdt'){const content=firstNamed(child,'w:sdtContent');if(content&&childrenNamed(content,'w:tbl').length)walkBody(content);else{const runs=[];walkRuns(child,runs,images,'control');}}
    }
  };
  if(body)walkBody(body);
  // Pictures: the relationship of each image gives the media part; its bytes become an asset.
  const rels=relationships(await zip.file('word/_rels/document.xml.rels')?.async('string')),assets=[],assetByTarget=new Map();
  const assetFor=async(image,rels)=>{
    const rel=image.rId&&rels.get(image.rId);if(!rel||rel.mode!=='Internal')return null;
    const target=rel.target.replace(/^\.?\//,''),key='word/'+target;
    if(assetByTarget.has(key))return assetByTarget.get(key);
    const file=zip.file(key);if(!file)return null;
    const extension=key.split('.').pop().toLowerCase(),id='image-'+(assets.length+1);
    assets.push({id,kind:'image',name:target.split('/').pop(),contentType:CONTENT_TYPES[extension]??'application/octet-stream',bytes:new Uint8Array(await file.async('nodebuffer'))});
    assetByTarget.set(key,id);return id;
  };
  const pictures=[];for(const image of images){const asset=await assetFor(image,rels);if(asset)pictures.push({...image,asset});}
  const partsOf=async(prefix)=>{
    const out=[];
    for(const file of Object.keys(zip.files).filter(name=>new RegExp(`^word/${prefix}\\d*\\.xml$`).test(name)).sort()){
      const xml=await zip.file(file).async('string'),read=partText(xml),partRels=relationships(await zip.file(`word/_rels/${file.slice(5)}.rels`)?.async('string'));
      const partImages=[];for(const image of read.images){const asset=await assetFor(image,partRels);if(asset)partImages.push({...image,asset});}
      out.push({part:file.slice(5),text:read.paragraphs.map(x=>x.text).join('\n'),paragraphs:read.paragraphs,images:partImages});
    }
    return out;
  };
  const headers=await partsOf('header'),footers=await partsOf('footer');
  const notes=async file=>{const xml=await zip.file(file)?.async('string');if(!xml)return [];const root=parseXml(xml);return childrenNamed(root.children.find(isElement)??{children:[]},file.includes('foot')?'w:footnote':'w:endnote').filter(n=>!['-1','0'].includes(n.attrs['w:id'])).map(n=>({id:n.attrs['w:id'],text:(function collect(node,out=[]){for(const child of node.children){if(!isElement(child))continue;if(child.name==='w:p'){const runs=[];walkRuns(child,runs,[],'note');out.push(runs.map(r=>r.text).join(''));}else collect(child,out);}return out;})(n).join('\n').trim()}));};
  const capture={schemaVersion:CAPTURE_SCHEMA_VERSION,app:'word',engine:'file',fidelity:'file',office:null,
    source:{name,bytes:bytes.length,hash:snapshot.fingerprint},
    document:{section:body?sectionOf(body):null,styles:snapshot.styles,paragraphs,tables,images:pictures,headers,footers,footnotes:await notes('word/footnotes.xml'),endnotes:await notes('word/endnotes.xml'),controls,
      fonts:[...new Set(paragraphs.flatMap(x=>x.runs.map(r=>r.font)).filter(Boolean))],colors:[...new Set(paragraphs.flatMap(x=>x.runs.map(r=>r.color)).filter(Boolean))]},
    assets};
  return validateCapture(capture);
}
