// Shared reading of OOXML packages for the capture file engines (document forms Task I, fidelity checklist 2026-10-21):
// parts by path, relationships resolved to part paths, chart parts, theme colours and fonts. No third-party parser:
// the same tokenizer as the Word snapshot, so a file one engine can read every engine can read.
import JSZip from 'jszip';
import {parseXml,findFirst,childrenNamed,firstNamed,isElement} from './docx-snapshot.mjs';

export const textOf=node=>{if(!node)return '';let out='';for(const child of node.children){if(typeof child==='string')out+=child;else out+=textOf(child);}return out;};
export const findAll=(node,name,out=[])=>{if(!node)return out;for(const child of node.children){if(!isElement(child))continue;if(child.name===name)out.push(child);else findAll(child,name,out);}return out;};
export const directChild=(node,names)=>node?.children.find(child=>isElement(child)&&names.includes(child.name))??null;
export const compact=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined&&v!==null&&v!==false&&!(Array.isArray(v)&&!v.length)&&!(typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length)));
export const resolvePart=(dir,target)=>{if(target.startsWith('/'))return target.slice(1);const parts=dir?dir.split('/'):[];for(const piece of target.split('/')){if(piece==='..')parts.pop();else if(piece&&piece!=='.')parts.push(piece);}return parts.join('/');};
export const CONTENT_TYPES={png:'image/png',jpeg:'image/jpeg',jpg:'image/jpeg',gif:'image/gif',bmp:'image/bmp',emf:'image/emf',wmf:'image/wmf',svg:'image/svg+xml',tiff:'image/tiff',tif:'image/tiff',mp4:'video/mp4',wmv:'video/x-ms-wmv',mp3:'audio/mpeg',wav:'audio/wav'};

export async function openPackage(bytes){
  const zip=await JSZip.loadAsync(bytes);
  const cache=new Map();
  const text=async part=>{const file=zip.file(part);return file?file.async('string'):null;};
  const xml=async part=>{if(cache.has(part))return cache.get(part);const source=await text(part);const tree=source===null?null:parseXml(source);cache.set(part,tree);return tree;};
  const relations=async part=>{
    const dir=part.includes('/')?part.slice(0,part.lastIndexOf('/')):'',base=part.slice(part.lastIndexOf('/')+1),tree=await xml(`${dir?dir+'/':''}_rels/${base}.rels`),map=new Map();
    for(const rel of findAll(tree,'Relationship'))map.set(rel.attrs.Id,{type:rel.attrs.Type??'',external:rel.attrs.TargetMode==='External',target:rel.attrs.TargetMode==='External'?rel.attrs.Target:resolvePart(dir,rel.attrs.Target??'')});
    return map;
  };
  const bytesOf=async part=>{const file=zip.file(part);return file?new Uint8Array(await file.async('nodebuffer')):null;};
  return {zip,text,xml,relations,bytes:bytesOf,files:()=>Object.keys(zip.files).filter(name=>!zip.files[name].dir)};
}
/** Assets by part path: each distinct media part becomes one asset. */
export function assetStore(pkg){
  const assets=[],byPart=new Map();
  return {assets,async add(part,kind='image'){
    if(!part)return undefined;if(byPart.has(part))return byPart.get(part);
    const bytes=await pkg.bytes(part);if(!bytes)return undefined;
    const extension=part.split('.').pop().toLowerCase(),id=`${kind==='image'?'image':'media'}-${assets.length+1}`;
    assets.push({id,kind:kind==='image'?'image':'image',name:part.split('/').pop(),contentType:CONTENT_TYPES[extension]??'application/octet-stream',bytes,...(kind!=='image'?{media:kind}:{})});
    byPart.set(part,id);return id;
  }};
}
/** A chart part: its type, title and series (names, categories, values). */
export async function readChart(pkg,part){
  const tree=await pkg.xml(part);if(!tree)return null;
  const plot=findFirst(tree,'c:plotArea'),types=(plot?.children??[]).filter(child=>isElement(child)&&/^c:\w+Chart$/.test(child.name));
  const title=findFirst(tree,'c:title'),points=node=>findAll(node,'c:pt').map(pt=>textOf(firstNamed(pt,'c:v')));
  const series=types.flatMap(type=>childrenNamed(type,'c:ser').map(ser=>({name:textOf(findFirst(firstNamed(ser,'c:tx')??{children:[]},'c:v'))||textOf(findFirst(firstNamed(ser,'c:tx')??{children:[]},'a:t')),categories:points(firstNamed(ser,'c:cat')),values:points(firstNamed(ser,'c:val')).map(Number)})));
  const formulas=findAll(tree,'c:f').map(f=>textOf(f)).slice(0,20);
  return compact({part,type:types[0]?.name.slice(2)??'chart',types:types.length>1?types.map(t=>t.name.slice(2)):undefined,title:title?findAll(title,'a:t').map(textOf).join(''):undefined,series,formulas});
}
/** Theme fonts and colours (theme1.xml). */
export async function readTheme(pkg,part){
  const tree=await pkg.xml(part);if(!tree)return null;
  const fontScheme=findFirst(tree,'a:fontScheme'),font=name=>{const node=findFirst(fontScheme??{children:[]},name);return node?compact({latin:firstNamed(node,'a:latin')?.attrs.typeface||undefined,ea:firstNamed(node,'a:ea')?.attrs.typeface||undefined}):undefined;};
  const colors={};const scheme=findFirst(tree,'a:clrScheme');
  for(const child of scheme?.children??[]){if(!isElement(child))continue;const color=firstNamed(child,'a:srgbClr')?.attrs.val??firstNamed(child,'a:sysClr')?.attrs.lastClr;if(color)colors[child.name.slice(2)]='#'+color.toUpperCase();}
  return {name:findFirst(tree,'a:theme')?.attrs.name??tree.children.find(isElement)?.attrs.name??null,fonts:{major:font('a:majorFont'),minor:font('a:minorFont')},colors};
}
/** DrawingML fill and line of a shape's properties (spPr): direct children only, so the line colour is not read as the fill. */
export function shapeStyle(spPr){
  if(!spPr)return {};
  const solid=directChild(spPr,['a:solidFill']),fill=solid?colorOf(solid):directChild(spPr,['a:gradFill'])?'gradient':directChild(spPr,['a:blipFill'])?'picture':directChild(spPr,['a:pattFill'])?'pattern':directChild(spPr,['a:noFill'])?'none':undefined;
  const ln=directChild(spPr,['a:ln']),line=ln?compact({width:ln.attrs.w?Math.round(Number(ln.attrs.w)/12700*100)/100:undefined,color:directChild(ln,['a:solidFill'])?colorOf(directChild(ln,['a:solidFill'])):undefined,dash:directChild(ln,['a:prstDash'])?.attrs.val,headEnd:directChild(ln,['a:headEnd'])?.attrs.type,tailEnd:directChild(ln,['a:tailEnd'])?.attrs.type,none:directChild(ln,['a:noFill'])?true:undefined}):undefined;
  const geometry=findFirst(spPr,'a:prstGeom')?.attrs.prst??(findFirst(spPr,'a:custGeom')?'custom':undefined);
  return compact({geometry,fill,line});
}
export function colorOf(node){
  const srgb=findFirst(node,'a:srgbClr'),scheme=findFirst(node,'a:schemeClr'),sys=findFirst(node,'a:sysClr');
  return srgb?'#'+srgb.attrs.val.toUpperCase():scheme?`scheme:${scheme.attrs.val}`:sys?'#'+String(sys.attrs.lastClr??'000000').toUpperCase():undefined;
}
export {parseXml,findFirst,childrenNamed,firstNamed,isElement};
