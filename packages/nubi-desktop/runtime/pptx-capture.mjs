// The file engine of the registration capture for PowerPoint (document forms plan Task I, 2026-10-21): every slide in
// show order with its layout, every shape (placeholders, text boxes, pictures, tables, charts, groups) with its name,
// position and size, its text runs with font, size, colour and emphasis, the pictures as assets, and the notes.
// Office (engine 'office') is the product path; this read says fidelity 'file'.
import JSZip from 'jszip';
import {createHash} from 'node:crypto';
import {parseXml,findFirst,childrenNamed,firstNamed,isElement} from './docx-snapshot.mjs';
import {CAPTURE_SCHEMA_VERSION,validateCapture} from './office-capture.mjs';
import {fail} from './files.mjs';

const CONTENT_TYPES={png:'image/png',jpeg:'image/jpeg',jpg:'image/jpeg',gif:'image/gif',bmp:'image/bmp',emf:'image/emf',wmf:'image/wmf',svg:'image/svg+xml',tiff:'image/tiff'};
const EMU_PER_PT=12700;
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const pt=value=>value===undefined?null:Math.round(Number(value)/EMU_PER_PT*100)/100;
const textOf=node=>{let out='';for(const child of node.children){if(typeof child==='string')out+=child;else out+=textOf(child);}return out;};
const compact=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined&&v!==null));
const resolve=(dir,target)=>{if(target.startsWith('/'))return target.slice(1);const parts=dir.split('/');for(const piece of target.split('/')){if(piece==='..')parts.pop();else if(piece&&piece!=='.')parts.push(piece);}return parts.join('/');};

async function relationsOf(zip,part){
  const dir=part.slice(0,part.lastIndexOf('/')),base=part.slice(part.lastIndexOf('/')+1),file=zip.file(`${dir}/_rels/${base}.rels`),map=new Map();
  if(!file)return map;
  for(const rel of childrenNamed(findFirst(parseXml(await file.async('string')),'Relationships')??{children:[]},'Relationship'))map.set(rel.attrs.Id,{type:rel.attrs.Type,target:rel.attrs.TargetMode==='External'?null:resolve(dir,rel.attrs.Target)});
  return map;
}
function runFormat(rPr){
  if(!rPr)return {};
  const fill=firstNamed(rPr,'a:solidFill'),srgb=fill&&firstNamed(fill,'a:srgbClr'),scheme=fill&&firstNamed(fill,'a:schemeClr'),latin=firstNamed(rPr,'a:latin'),ea=firstNamed(rPr,'a:ea');
  return compact({font:ea?.attrs.typeface??latin?.attrs.typeface,size:rPr.attrs.sz?Number(rPr.attrs.sz)/100:undefined,bold:rPr.attrs.b==='1'||undefined,italic:rPr.attrs.i==='1'||undefined,underline:rPr.attrs.u&&rPr.attrs.u!=='none'?rPr.attrs.u:undefined,
    color:srgb?'#'+srgb.attrs.val.toUpperCase():scheme?`scheme:${scheme.attrs.val}`:undefined});
}
function paragraphsOf(txBody){
  if(!txBody)return [];
  return childrenNamed(txBody,'a:p').map(p=>{
    const runs=[];
    for(const child of p.children){if(!isElement(child))continue;if(child.name==='a:r'||child.name==='a:fld'){const t=firstNamed(child,'a:t');runs.push({text:t?textOf(t):'',...runFormat(firstNamed(child,'a:rPr'))});}else if(child.name==='a:br')runs.push({text:'\n'});}
    const pPr=firstNamed(p,'a:pPr');
    return compact({text:runs.map(r=>r.text).join(''),runs,level:pPr?.attrs.lvl?Number(pPr.attrs.lvl):undefined,align:pPr?.attrs.algn});
  });
}
function geometry(node){
  const xfrm=findFirst(node,'a:xfrm')??findFirst(node,'p:xfrm'),off=xfrm&&firstNamed(xfrm,'a:off'),ext=xfrm&&firstNamed(xfrm,'a:ext');
  return off&&ext?{left:pt(off.attrs.x),top:pt(off.attrs.y),width:pt(ext.attrs.cx),height:pt(ext.attrs.cy),...(xfrm.attrs.rot?{rotation:Number(xfrm.attrs.rot)/60000}:{})}:{};
}
async function shapesOf(tree,rels,zip,assetFor){
  const shapes=[];
  for(const node of tree.children){
    if(!isElement(node))continue;
    const nv=findFirst(node,'p:cNvPr'),ph=findFirst(node,'p:ph'),base={id:nv?.attrs.id??null,name:nv?.attrs.name??'',...(nv?.attrs.descr?{description:nv.attrs.descr}:{}),...geometry(node),...(ph?{placeholder:compact({type:ph.attrs.type??'body',index:ph.attrs.idx!==undefined?Number(ph.attrs.idx):undefined})}:{})};
    if(node.name==='p:sp'){const paragraphs=paragraphsOf(firstNamed(node,'p:txBody'));const fill=findFirst(firstNamed(node,'p:spPr')??{children:[]},'a:srgbClr');shapes.push(compact({...base,type:'shape',geometry:findFirst(node,'a:prstGeom')?.attrs.prst,fill:fill?'#'+fill.attrs.val.toUpperCase():undefined,text:paragraphs.map(p=>p.text).join('\n'),paragraphs}));}
    else if(node.name==='p:pic'){const blip=findFirst(node,'a:blip'),rel=blip&&rels.get(blip.attrs['r:embed']);shapes.push(compact({...base,type:'picture',asset:rel?.target?await assetFor(rel.target):undefined}));}
    else if(node.name==='p:graphicFrame'){
      const table=findFirst(node,'a:tbl'),chart=findFirst(node,'c:chart');
      if(table)shapes.push({...base,type:'table',rows:childrenNamed(table,'a:tr').map(tr=>childrenNamed(tr,'a:tc').map(tc=>{const paragraphs=paragraphsOf(firstNamed(tc,'a:txBody'));return {text:paragraphs.map(p=>p.text).join('\n'),runs:paragraphs.flatMap(p=>p.runs)};}))});
      else shapes.push(compact({...base,type:chart?'chart':'graphic',chart:chart&&rels.get(chart.attrs['r:id'])?.target}));
    }
    else if(node.name==='p:grpSp')shapes.push({...base,type:'group',shapes:await shapesOf(node,rels,zip,assetFor)});
    else if(node.name==='p:cxnSp')shapes.push({...base,type:'connector'});
  }
  return shapes;
}

/** The full file capture of a pptx: contract v1 with engine 'file'. */
export async function pptxCapture(bytes,{name='양식.pptx'}={}){
  if(!bytes||!bytes.length)fail('pptx_invalid');
  let zip;try{zip=await JSZip.loadAsync(bytes);}catch{fail('pptx_invalid');}
  const presentationFile=zip.file('ppt/presentation.xml');if(!presentationFile)fail('pptx_invalid');
  const presentation=parseXml(await presentationFile.async('string')),presentationRels=await relationsOf(zip,'ppt/presentation.xml');
  const size=findFirst(presentation,'p:sldSz');
  const assets=[],byPart=new Map();
  const assetFor=async part=>{
    if(byPart.has(part))return byPart.get(part);
    const file=zip.file(part);if(!file)return undefined;
    const extension=part.split('.').pop().toLowerCase(),id='image-'+(assets.length+1);
    assets.push({id,kind:'image',name:part.split('/').pop(),contentType:CONTENT_TYPES[extension]??'application/octet-stream',bytes:new Uint8Array(await file.async('nodebuffer'))});
    byPart.set(part,id);return id;
  };
  const slides=[];
  for(const [k,entry] of childrenNamed(findFirst(presentation,'p:sldIdLst')??{children:[]},'p:sldId').entries()){
    const part=presentationRels.get(entry.attrs['r:id'])?.target;const file=part&&zip.file(part);if(!file)continue;
    const slide=parseXml(await file.async('string')),rels=await relationsOf(zip,part),tree=findFirst(slide,'p:spTree');
    let layout=null,notes='';
    for(const rel of rels.values()){
      if(rel.type.endsWith('/slideLayout')&&rel.target){const xml=await zip.file(rel.target)?.async('string');if(xml)layout=findFirst(parseXml(xml),'p:cSld')?.attrs.name??rel.target.split('/').pop();}
      if(rel.type.endsWith('/notesSlide')&&rel.target){const xml=await zip.file(rel.target)?.async('string');if(xml){const root=parseXml(xml);notes=(function collect(node,out=[]){for(const child of node.children){if(!isElement(child))continue;if(child.name==='p:sp'&&findFirst(child,'p:ph')?.attrs.type==='body')out.push(paragraphsOf(firstNamed(child,'p:txBody')).map(p=>p.text).join('\n'));else collect(child,out);}return out;})(root).join('\n').trim();}}
    }
    const background=findFirst(findFirst(slide,'p:bg')??{children:[]},'a:srgbClr');
    slides.push(compact({index:k+1,part,layout,hidden:slide.children.find(isElement)?.attrs.show==='0'||undefined,background:background?'#'+background.attrs.val.toUpperCase():undefined,shapes:tree?await shapesOf(tree,rels,zip,assetFor):[],notes}));
  }
  const flat=shapes=>shapes.flatMap(shape=>shape.type==='group'?flat(shape.shapes):[shape]);
  const runs=slides.flatMap(slide=>flat(slide.shapes).flatMap(shape=>[...(shape.paragraphs??[]).flatMap(p=>p.runs),...(shape.rows??[]).flat().flatMap(cell=>cell.runs)]));
  const capture={schemaVersion:CAPTURE_SCHEMA_VERSION,app:'powerpoint',engine:'file',fidelity:'file',office:null,source:{name,bytes:bytes.length,hash:hash(bytes)},
    document:{size:size?{width:pt(size.attrs.cx),height:pt(size.attrs.cy)}:null,slides,fonts:[...new Set(runs.map(r=>r.font).filter(Boolean))],colors:[...new Set(runs.map(r=>r.color).filter(c=>c&&c.startsWith('#')))]},
    assets};
  return validateCapture(capture);
}
