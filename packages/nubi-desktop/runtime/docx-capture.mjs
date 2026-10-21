// The file engine of the registration capture for Word (document forms Task I; fidelity checklist 2026-10-21 "워드
// 먼저 모든 기능 완벽하게"): everything a docx holds that Word shows, read without Word. Text runs with every
// character format, paragraph formats, lists, tables (merges, shading, nested tables), pictures (inline and floating,
// crop, wrap), shapes and text boxes, charts, equations, links, bookmarks, fields, notes, comments, tracked changes,
// content controls, sections with their headers and footers, styles and the theme. The product registers through the
// Office host (engine 'office'); this read says fidelity 'file'. Field names here are the contract the host fills too.
import {createHash} from 'node:crypto';
import {docxParts,snapshotParts} from './docx-snapshot.mjs';
import {openPackage,assetStore,readChart,readTheme,shapeStyle,textOf,findAll,directChild,compact,parseXml,findFirst,childrenNamed,firstNamed,isElement} from './ooxml-parts.mjs';
import {CAPTURE_SCHEMA_VERSION,validateCapture} from './office-capture.mjs';

const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const pt=twips=>twips===undefined||twips===null||twips===''?undefined:Math.round(Number(twips)/20*100)/100;
const emuPt=emu=>emu===undefined?undefined:Math.round(Number(emu)/12700*100)/100;
const on=(rPr,name)=>{const node=rPr&&firstNamed(rPr,name);if(!node)return undefined;const value=node.attrs['w:val'];return value===undefined||!['0','false','off'].includes(value)?true:undefined;};
const hex=value=>value&&value!=='auto'?'#'+String(value).toUpperCase():undefined;

function runFormat(rPr){
  if(!rPr)return {};
  const fonts=firstNamed(rPr,'w:rFonts'),color=firstNamed(rPr,'w:color'),u=firstNamed(rPr,'w:u'),shd=firstNamed(rPr,'w:shd'),vert=firstNamed(rPr,'w:vertAlign');
  return compact({font:fonts?.attrs['w:eastAsia']??fonts?.attrs['w:ascii']??fonts?.attrs['w:hAnsi'],
    size:firstNamed(rPr,'w:sz')?Number(firstNamed(rPr,'w:sz').attrs['w:val'])/2:undefined,
    color:hex(color?.attrs['w:val']),themeColor:color?.attrs['w:themeColor'],
    bold:on(rPr,'w:b'),italic:on(rPr,'w:i'),underline:u&&u.attrs['w:val']!=='none'?u.attrs['w:val']??'single':undefined,
    strike:on(rPr,'w:strike'),doubleStrike:on(rPr,'w:dstrike'),vertAlign:vert&&vert.attrs['w:val']!=='baseline'?vert.attrs['w:val']:undefined,
    smallCaps:on(rPr,'w:smallCaps'),allCaps:on(rPr,'w:caps'),hidden:on(rPr,'w:vanish'),highlight:firstNamed(rPr,'w:highlight')?.attrs['w:val'],
    spacing:firstNamed(rPr,'w:spacing')?Number(firstNamed(rPr,'w:spacing').attrs['w:val']):undefined,shading:hex(shd?.attrs['w:fill']),
    style:firstNamed(rPr,'w:rStyle')?.attrs['w:val'],effects:['w14:glow','w14:shadow','w14:reflection','w14:textOutline','w:outline','w:shadow','w:emboss','w:imprint'].filter(name=>firstNamed(rPr,name)).map(name=>name.split(':')[1])});
}
function paragraphFormat(pPr){
  if(!pPr)return {};
  const ind=firstNamed(pPr,'w:ind'),spacing=firstNamed(pPr,'w:spacing'),shd=firstNamed(pPr,'w:shd'),borders=firstNamed(pPr,'w:pBdr');
  const lineRule=spacing?.attrs['w:lineRule']??'auto',line=spacing?.attrs['w:line'];
  return compact({align:firstNamed(pPr,'w:jc')?.attrs['w:val'],
    indent:ind?compact({left:pt(ind.attrs['w:left']??ind.attrs['w:start']),right:pt(ind.attrs['w:right']??ind.attrs['w:end']),firstLine:pt(ind.attrs['w:firstLine']),hanging:pt(ind.attrs['w:hanging'])}):undefined,
    spacing:spacing?compact({before:pt(spacing.attrs['w:before']),after:pt(spacing.attrs['w:after']),line:line===undefined?undefined:lineRule==='auto'?Number(line)/240:pt(line),lineRule:line===undefined?undefined:lineRule}):undefined,
    keepNext:on(pPr,'w:keepNext'),keepLines:on(pPr,'w:keepLines'),pageBreakBefore:on(pPr,'w:pageBreakBefore'),widowControl:firstNamed(pPr,'w:widowControl')?.attrs['w:val']==='0'?false:undefined,
    shading:hex(shd?.attrs['w:fill']),borders:borders?Object.fromEntries(borders.children.filter(isElement).map(b=>[b.name.slice(2),compact({style:b.attrs['w:val'],size:b.attrs['w:sz']?Number(b.attrs['w:sz'])/8:undefined,color:hex(b.attrs['w:color'])})])):undefined,
    tabs:firstNamed(pPr,'w:tabs')?childrenNamed(firstNamed(pPr,'w:tabs'),'w:tab').map(t=>compact({align:t.attrs['w:val'],position:pt(t.attrs['w:pos']),leader:t.attrs['w:leader']})):undefined});
}

class WordCapture{
  constructor(pkg,{items,styles,theme}){Object.assign(this,{pkg,items:new Map(items.map(item=>[item.id,item])),styles,theme});this.store=assetStore(pkg);
    Object.assign(this,{images:[],shapes:[],charts:[],equations:[],hyperlinks:[],bookmarks:[],fields:[],revisions:[],controls:[],commentAnchors:[]});}
  // The runs of an element in reading order. Drawings, fields, links, revisions and equations are recorded on the way.
  async runs(node,out,context){
    for(const child of node.children){
      if(!isElement(child))continue;
      switch(child.name){
        case 'w:r':await this.run(child,out,context);break;
        case 'w:hyperlink':{const start=out.length;await this.runs(child,out,context);const rel=child.attrs['r:id']?context.rels.get(child.attrs['r:id']):null;this.hyperlinks.push(compact({target:rel?.target??(child.attrs['w:anchor']?'#'+child.attrs['w:anchor']:undefined),text:out.slice(start).map(r=>r.text).join(''),paragraph:context.paragraph,part:context.part}));for(const r of out.slice(start))r.hyperlink=rel?.target??('#'+(child.attrs['w:anchor']??''));break;}
        case 'w:fldSimple':{const start=out.length;await this.runs(child,out,context);context.fields.push({instr:child.attrs['w:instr'].trim(),result:out.slice(start).map(r=>r.text).join('')});break;}
        case 'w:ins':case 'w:del':case 'w:moveFrom':case 'w:moveTo':{const start=out.length;await this.runs(child,out,{...context,deleted:child.name==='w:del'||child.name==='w:moveFrom'});const text=child.name==='w:del'||child.name==='w:moveFrom'?findAll(child,'w:delText').map(textOf).join('')||out.slice(start).map(r=>r.text).join(''):out.slice(start).map(r=>r.text).join('');this.revisions.push(compact({type:{'w:ins':'insert','w:del':'delete','w:moveFrom':'moveFrom','w:moveTo':'moveTo'}[child.name],author:child.attrs['w:author'],date:child.attrs['w:date'],text,paragraph:context.paragraph}));if(child.name==='w:del'||child.name==='w:moveFrom')out.splice(start);break;}
        case 'w:bookmarkStart':if(child.attrs['w:name']&&child.attrs['w:name']!=='_GoBack')this.bookmarks.push(child.attrs['w:name']);break;
        case 'w:commentRangeStart':this.commentAnchors.push({id:child.attrs['w:id'],paragraph:context.paragraph});break;
        case 'm:oMath':case 'm:oMathPara':this.equations.push({text:findAll(child,'m:t').map(textOf).join(''),paragraph:context.paragraph,display:child.name==='m:oMathPara'});out.push({text:findAll(child,'m:t').map(textOf).join(''),equation:true});break;
        case 'w:sdt':await this.control(child,out,context);break;
        case 'mc:AlternateContent':{const choice=firstNamed(child,'mc:Choice')??firstNamed(child,'mc:Fallback');if(choice)await this.runs(choice,out,context);break;}
        case 'w:pPr':case 'w:rPr':case 'w:proofErr':break;
        default:await this.runs(child,out,context);
      }
    }
  }
  async run(run,out,context){
    const format=runFormat(firstNamed(run,'w:rPr'));let text='';
    const flush=()=>{if(text){out.push({text,...format,...(context.deleted?{deleted:true}:{})});text='';}};
    for(const child of run.children){
      if(!isElement(child))continue;
      if(child.name==='w:t'||child.name==='w:delText')text+=textOf(child);
      else if(child.name==='w:tab')text+='\t';
      else if(child.name==='w:br'||child.name==='w:cr'){const type=child.attrs['w:type'];if(type==='page'){context.breaks.page++;}else if(type==='column')context.breaks.column++;else context.breaks.line++;text+='\n';}
      else if(child.name==='w:noBreakHyphen')text+='-';
      else if(child.name==='w:sym')text+=String.fromCharCode(parseInt(child.attrs['w:char']??'0',16));
      else if(child.name==='w:fldChar'){const type=child.attrs['w:fldCharType'];if(type==='begin')context.complex.push({instr:'',result:''});else if(type==='separate'&&context.complex.at(-1))context.complex.at(-1).separated=true;else if(type==='end'){const field=context.complex.pop();if(field)context.fields.push({instr:field.instr.trim(),result:field.result});}}
      else if(child.name==='w:instrText'){if(context.complex.at(-1))context.complex.at(-1).instr+=textOf(child);}
      else if(child.name==='w:footnoteReference'||child.name==='w:endnoteReference'){flush();out.push({text:'',note:child.name==='w:footnoteReference'?'footnote':'endnote',noteId:child.attrs['w:id']});}
      else if(child.name==='w:commentReference'){flush();out.push({text:'',comment:child.attrs['w:id']});}
      else if(child.name==='w:drawing'||child.name==='w:pict'||child.name==='mc:AlternateContent'){flush();await this.drawing(child,context);}
      else if(child.name==='w:object'){flush();this.shapes.push(compact({type:'object',paragraph:context.paragraph,progId:findFirst(child,'o:OLEObject')?.attrs.ProgID}));}
    }
    flush();
    if(context.complex.at(-1)?.separated){/* the result text of a complex field is part of the paragraph text */}
  }
  async drawing(node,context){
    const host=node.name==='mc:AlternateContent'?(firstNamed(node,'mc:Choice')??node):node;
    for(const holder of [...findAll(host,'wp:inline'),...findAll(host,'wp:anchor')]){
      const inline=holder.name==='wp:inline',extent=firstNamed(holder,'wp:extent'),docPr=firstNamed(holder,'wp:docPr'),data=findFirst(holder,'a:graphicData'),uri=data?.attrs.uri??'';
      const position=inline?undefined:compact({horizontal:compact({relativeFrom:firstNamed(holder,'wp:positionH')?.attrs.relativeFrom,offset:emuPt(textOf(findFirst(firstNamed(holder,'wp:positionH')??{children:[]},'wp:posOffset'))||undefined),align:textOf(findFirst(firstNamed(holder,'wp:positionH')??{children:[]},'wp:align'))||undefined}),
        vertical:compact({relativeFrom:firstNamed(holder,'wp:positionV')?.attrs.relativeFrom,offset:emuPt(textOf(findFirst(firstNamed(holder,'wp:positionV')??{children:[]},'wp:posOffset'))||undefined),align:textOf(findFirst(firstNamed(holder,'wp:positionV')??{children:[]},'wp:align'))||undefined}),behindText:holder.attrs.behindDoc==='1'||undefined});
      const wrap=inline?undefined:holder.children.find(child=>isElement(child)&&/^wp:wrap/.test(child.name))?.name.slice(7);
      const base={inline,...compact({paragraph:context.paragraph,part:context.part,name:docPr?.attrs.name,description:docPr?.attrs.descr,width:emuPt(extent?.attrs.cx),height:emuPt(extent?.attrs.cy),position,wrap})};
      if(/picture$/.test(uri)){
        const blip=findFirst(data,'a:blip'),rel=blip&&context.rels.get(blip.attrs['r:embed']??blip.attrs['r:link']),src=findFirst(data,'a:srcRect');
        const crop=src?compact({left:src.attrs.l?Number(src.attrs.l)/100000:undefined,top:src.attrs.t?Number(src.attrs.t)/100000:undefined,right:src.attrs.r?Number(src.attrs.r)/100000:undefined,bottom:src.attrs.b?Number(src.attrs.b)/100000:undefined}):undefined;
        this.images.push({...base,...compact({asset:rel&&!rel.external?await this.store.add(rel.target):undefined,link:rel?.external?rel.target:undefined,crop})});
      }else if(/wordprocessingShape$/.test(uri)){
        const wsp=findFirst(data,'wps:wsp'),txbx=findFirst(wsp??{children:[]},'w:txbxContent'),paragraphs=[];
        if(txbx)for(const p of childrenNamed(txbx,'w:p')){const runs=[];await this.runs(p,runs,{...context,breaks:{page:0,line:0,column:0},complex:[],fields:[]});paragraphs.push({text:runs.map(r=>r.text).join(''),runs});}
        this.shapes.push({type:'shape',...base,...compact({...shapeStyle(firstNamed(wsp??{children:[]},'wps:spPr')),text:paragraphs.map(p=>p.text).join('\n'),paragraphs})});
      }else if(/wordprocessingGroup$/.test(uri)){
        this.shapes.push(compact({type:'group',...base,shapes:findAll(data,'wps:wsp').map(wsp=>compact({...shapeStyle(firstNamed(wsp,'wps:spPr')),text:findAll(wsp,'w:t').map(textOf).join('')}))}));
      }else if(/chart$/.test(uri)){
        const ref=findFirst(data,'c:chart'),rel=ref&&context.rels.get(ref.attrs['r:id']);const chart=rel?await readChart(this.pkg,rel.target):null;
        const {part:chartPart,...rest}=chart??{};this.charts.push({...base,...compact({...rest,chartPart})});
      }else if(/diagram$/.test(uri)){
        this.shapes.push(compact({type:'smartArt',...base}));
      }else this.shapes.push(compact({type:'graphic',...base,uri}));
    }
    // A legacy VML shape (w:pict without DrawingML): its text and type are kept.
    if(node.name==='w:pict'&&!findAll(node,'wp:inline').length&&!findAll(node,'wp:anchor').length){const shape=node.children.find(isElement);if(shape)this.shapes.push(compact({type:'vml',paragraph:context.paragraph,name:shape.name,text:findAll(node,'w:t').map(textOf).join('')}));}
  }
  async control(sdt,out,context){
    const pr=firstNamed(sdt,'w:sdtPr')??{children:[]},content=firstNamed(sdt,'w:sdtContent');
    const date=firstNamed(pr,'w:date'),dropdown=firstNamed(pr,'w:dropDownList')??firstNamed(pr,'w:comboBox'),checkbox=firstNamed(pr,'w14:checkbox');
    const controlType=checkbox?'checkbox':date?'date':dropdown?(dropdown.name==='w:comboBox'?'combo':'dropdown'):firstNamed(pr,'w:picture')?'picture':firstNamed(pr,'w:text')?'text':firstNamed(pr,'w:docPartObj')?'docPart':'richText';
    const start=out.length;if(content)await this.runs(content,out,context);
    this.controls.push(compact({controlType,tag:firstNamed(pr,'w:tag')?.attrs['w:val'],title:firstNamed(pr,'w:alias')?.attrs['w:val'],showingPlaceholder:firstNamed(pr,'w:showingPlcHdr')?true:undefined,
      text:out.slice(start).map(r=>r.text).join(''),dateFormat:date?firstNamed(date,'w:dateFormat')?.attrs['w:val']:undefined,
      items:dropdown?childrenNamed(dropdown,'w:listItem').map(item=>({text:item.attrs['w:displayText'],value:item.attrs['w:value']})):undefined,
      checked:checkbox?firstNamed(checkbox,'w14:checked')?.attrs['w14:val']==='1':undefined,locked:firstNamed(pr,'w:lock')?.attrs['w:val'],paragraph:context.paragraph}));
  }
  async paragraph(node,id,context){
    const pPr=firstNamed(node,'w:pPr'),item=this.items.get(id)??{},runs=[];const local={...context,paragraph:id,breaks:{page:0,line:0,column:0},complex:[],fields:[]};
    await this.runs(node,runs,local);
    this.fields.push(...local.fields.map(field=>({...field,paragraph:id,part:context.part})));
    const styleId=firstNamed(pPr??{children:[]},'w:pStyle')?.attrs['w:val'];
    return {...compact({id,text:runs.filter(r=>!r.deleted).map(r=>r.text).join(''),style:item.style??this.styles.get(styleId)?.name??styleId,outlineLevel:item.outlineLevel,listString:item.listString,listLevel:item.listLevel,listIndent:item.listIndent,
      ...paragraphFormat(pPr),breaks:local.breaks.page||local.breaks.line||local.breaks.column?compact({page:local.breaks.page||undefined,line:local.breaks.line||undefined,column:local.breaks.column||undefined}):undefined,
      fields:local.fields.length?local.fields:undefined,sectionBreak:findFirst(pPr??{children:[]},'w:sectPr')?true:undefined}),runs:runs.filter(r=>r.text||r.note||r.comment||r.equation)};
  }
  async table(node,index,context,counter){
    const tblPr=firstNamed(node,'w:tblPr'),rows=[];let headerRow=false;
    for(const [r,row] of childrenNamed(node,'w:tr').entries()){
      const trPr=firstNamed(row,'w:trPr');if(r===0&&trPr&&firstNamed(trPr,'w:tblHeader'))headerRow=true;
      const cells=[];let c=0;
      for(const cell of childrenNamed(row,'w:tc')){
        const tcPr=firstNamed(cell,'w:tcPr'),span=Number(firstNamed(tcPr??{children:[]},'w:gridSpan')?.attrs['w:val']??1),vMerge=tcPr&&firstNamed(tcPr,'w:vMerge');c++;
        const paragraphs=[],tables=[];
        for(const child of cell.children){
          if(!isElement(child))continue;
          if(child.name==='w:p'){counter.p++;paragraphs.push(await this.paragraph(child,'p-'+counter.p,context));}
          else if(child.name==='w:tbl')tables.push(await this.table(child,`${index}.${tables.length+1}`,context,{p:counter.p,nested:true}));
        }
        const shd=tcPr&&firstNamed(tcPr,'w:shd'),borders=tcPr&&firstNamed(tcPr,'w:tcBorders'),width=tcPr&&firstNamed(tcPr,'w:tcW');
        cells.push(compact({row:r+1,column:c,text:paragraphs.map(p=>p.text).join('\n'),paragraphs,span:span>1?span:undefined,vMerge:vMerge?vMerge.attrs['w:val']??'continue':undefined,
          shading:hex(shd?.attrs['w:fill']),width:width?Number(width.attrs['w:w']):undefined,verticalAlign:firstNamed(tcPr??{children:[]},'w:vAlign')?.attrs['w:val'],
          borders:borders?Object.fromEntries(borders.children.filter(isElement).map(b=>[b.name.slice(2),compact({style:b.attrs['w:val'],size:b.attrs['w:sz']?Number(b.attrs['w:sz'])/8:undefined,color:hex(b.attrs['w:color'])})])):undefined,tables}));
      }
      rows.push(cells);
    }
    return compact({id:'t'+index,style:firstNamed(tblPr??{children:[]},'w:tblStyle')?.attrs['w:val'],headerRow:headerRow||undefined,align:firstNamed(tblPr??{children:[]},'w:jc')?.attrs['w:val'],rows});
  }
  async part(path,kind){
    const tree=await this.pkg.xml(path);if(!tree)return null;const rels=await this.pkg.relations(path),root=tree.children.find(isElement),paragraphs=[];
    const before={images:this.images.length,fields:this.fields.length};
    for(const [k,p] of findAll(root,'w:p').entries())paragraphs.push(await this.paragraph(p,`${kind}-p-${k+1}`,{rels,part:path}));
    return {paragraphs,text:paragraphs.map(p=>p.text).join('\n'),fields:this.fields.slice(before.fields).map(({paragraph:_,part:__,...field})=>field),images:this.images.slice(before.images).map(image=>image.asset).filter(Boolean)};
  }
}
function sectionOf(sectPr,rels){
  if(!sectPr)return null;
  const size=firstNamed(sectPr,'w:pgSz'),margin=firstNamed(sectPr,'w:pgMar'),cols=firstNamed(sectPr,'w:cols'),numbering=firstNamed(sectPr,'w:pgNumType');
  const refs=kind=>childrenNamed(sectPr,`w:${kind}Reference`).map(ref=>({type:ref.attrs['w:type']??'default',part:rels.get(ref.attrs['r:id'])?.target}));
  return compact({page:size?compact({widthMm:Math.round(Number(size.attrs['w:w'])/56.7),heightMm:Math.round(Number(size.attrs['w:h'])/56.7),orientation:size.attrs['w:orient']??(Number(size.attrs['w:w'])>Number(size.attrs['w:h'])?'landscape':'portrait')}):undefined,
    margins:margin?compact({top:pt(margin.attrs['w:top']),bottom:pt(margin.attrs['w:bottom']),left:pt(margin.attrs['w:left']),right:pt(margin.attrs['w:right']),header:pt(margin.attrs['w:header']),footer:pt(margin.attrs['w:footer'])}):undefined,
    columns:cols?.attrs['w:num']?Number(cols.attrs['w:num']):1,columnSpace:pt(cols?.attrs['w:space']),titlePage:firstNamed(sectPr,'w:titlePg')?true:undefined,type:firstNamed(sectPr,'w:type')?.attrs['w:val'],
    pageNumbers:numbering?compact({format:numbering.attrs['w:fmt'],start:numbering.attrs['w:start']?Number(numbering.attrs['w:start']):undefined}):undefined,
    pageBorders:firstNamed(sectPr,'w:pgBorders')?true:undefined,headers:refs('header'),footers:refs('footer')});
}

/** The full file capture of a docx: contract v1 with engine 'file'. */
export async function docxCapture(bytes,{name='양식.docx'}={}){
  const parts=await docxParts(bytes),snapshot=snapshotParts(parts,{name,fingerprint:hash(bytes)});
  const pkg=await openPackage(bytes),documentPart='word/document.xml',rels=await pkg.relations(documentPart);
  const relOf=type=>[...rels.values()].find(rel=>rel.type.endsWith('/'+type))?.target;
  const styleNames=new Map(snapshot.styles.map(style=>[style.id,style.name]));
  const theme=relOf('theme')?await readTheme(pkg,relOf('theme')):null;
  const capture=new WordCapture(pkg,{items:snapshot.items,styles:new Map(snapshot.styles.map(s=>[s.id,s])),theme});
  const tree=parseXml(parts.document),body=findFirst(tree,'w:body'),paragraphs=[],tables=[],sections=[];const counter={p:0};let t=0;
  const walk=async container=>{
    for(const child of container.children){
      if(!isElement(child))continue;
      if(child.name==='w:p'){counter.p++;const paragraph=await capture.paragraph(child,'p-'+counter.p,{rels,part:documentPart});paragraphs.push(paragraph);const sectPr=findFirst(firstNamed(child,'w:pPr')??{children:[]},'w:sectPr');if(sectPr)sections.push(sectionOf(sectPr,rels));}
      else if(child.name==='w:tbl')tables.push(await capture.table(child,++t,{rels,part:documentPart},counter));
      else if(child.name==='w:sdt'){const content=firstNamed(child,'w:sdtContent');if(content&&childrenNamed(content,'w:tbl').length)await walk(content);else{const out=[];await capture.control(child,out,{rels,part:documentPart,paragraph:null,breaks:{page:0,line:0,column:0},complex:[],fields:[]});}}
    }
  };
  if(body)await walk(body);
  const last=body?childrenNamed(body,'w:sectPr').at(-1):null;if(last)sections.push(sectionOf(last,rels));
  // Headers and footers: each part once, with the section reference types that use it.
  const partsOf=async kind=>{const out=[],seen=new Map();for(const section of sections)for(const ref of section?.[kind+'s']??[]){if(!ref.part)continue;if(seen.has(ref.part)){seen.get(ref.part).types.push(ref.type);continue;}const read=await capture.part(ref.part,kind==='header'?'header':'footer');if(!read)continue;const entry={type:ref.type,types:[ref.type],part:ref.part.replace(/^word\//,''),...read};seen.set(ref.part,entry);out.push(entry);}return out;};
  const headers=await partsOf('header'),footers=await partsOf('footer');
  const notes=async(type,tag)=>{const target=relOf(type);if(!target)return [];const tree=await pkg.xml(target),out=[];for(const note of childrenNamed(tree?.children.find(isElement)??{children:[]},`w:${tag}`)){if(['-1','0'].includes(note.attrs['w:id'])||note.attrs['w:type'])continue;const read=[];for(const p of childrenNamed(note,'w:p')){const runs=[];await capture.runs(p,runs,{rels:await pkg.relations(target),part:target,paragraph:null,breaks:{page:0,line:0,column:0},complex:[],fields:[]});read.push(runs.map(r=>r.text).join(''));}out.push({id:note.attrs['w:id'],text:read.join('\n').trim()});}return out;};
  const footnotes=await notes('footnotes','footnote'),endnotes=await notes('endnotes','endnote');
  const commentsTree=relOf('comments')?await pkg.xml(relOf('comments')):null;
  const comments=findAll(commentsTree,'w:comment').map(c=>compact({id:c.attrs['w:id'],author:c.attrs['w:author'],initials:c.attrs['w:initials'],date:c.attrs['w:date'],text:childrenNamed(c,'w:p').map(p=>findAll(p,'w:t').map(textOf).join('')).join('\n').trim(),paragraph:capture.commentAnchors.find(a=>a.id===c.attrs['w:id'])?.paragraph}));
  const allRuns=[...paragraphs,...tables.flatMap(function cells(table){return table.rows.flat().flatMap(cell=>[...(cell.paragraphs??[]),...(cell.tables??[]).flatMap(cells)]);}),...headers.flatMap(h=>h.paragraphs),...footers.flatMap(f=>f.paragraphs),...capture.shapes.flatMap(s=>s.paragraphs??[])].flatMap(p=>p.runs??[]);
  const settings=await pkg.xml(relOf('settings')??'word/settings.xml');
  const result={schemaVersion:CAPTURE_SCHEMA_VERSION,app:'word',engine:'file',fidelity:'file',office:null,source:{name,bytes:bytes.length,hash:snapshot.fingerprint},
    document:compact({section:sections.at(-1)?{page:sections.at(-1).page,margins:sections.at(-1).margins}:null,sections,styles:snapshot.styles.map(({id,name:styleName,outlineLevel,size})=>compact({id,name:styleName,outlineLevel,size})),theme,
      paragraphs,tables,images:capture.images,shapes:capture.shapes,charts:capture.charts,equations:capture.equations,hyperlinks:capture.hyperlinks,bookmarks:[...new Set(capture.bookmarks)],
      fields:capture.fields.filter(field=>field.part===documentPart).map(({part:_,...field})=>field),footnotes,endnotes,comments,revisions:capture.revisions,controls:capture.controls,headers,footers,
      trackChanges:settings&&findFirst(settings,'w:trackRevisions')?true:undefined,protection:settings&&findFirst(settings,'w:documentProtection')?findFirst(settings,'w:documentProtection').attrs['w:edit']??'on':undefined,
      fonts:[...new Set(allRuns.map(r=>r.font).filter(Boolean))],colors:[...new Set(allRuns.map(r=>r.color).filter(Boolean))],styleNames:undefined}),
    assets:capture.store.assets};
  void styleNames;
  return validateCapture(result);
}
