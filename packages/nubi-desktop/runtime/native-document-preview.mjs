// Read-only visual projection of native observations and an already validated
// proposal. This never executes Office, parses a file or changes approval DTOs.
const key=p=>JSON.stringify(p),copy=v=>structuredClone(v),finite=v=>typeof v==='number'&&Number.isFinite(v);
const rgb=v=>Number.isInteger(v)&&v>=0&&v<=0xffffff?'#'+[v&255,(v>>8)&255,(v>>16)&255].map(n=>n.toString(16).padStart(2,'0')).join(''):undefined;
function graph(app,observation,proposal){
 const handles=new Map([['document',[]]]),before=new Map(),after=new Map();let unmappedChanges=0;
 function path(s){const target=String(s.target??'document').split('.'),base=handles.get(target[0]);if(!base)return null;const names=[...target.slice(1),...String(s.member).split('.')],args=[...s.args??[]],p=copy(base);for(const name of names){const count=name==='Item'?1:name==='Cell'?2:name==='Range'&&app==='word'&&p.length===0?2:0;if(args.length<count)return null;p.push({name,args:args.splice(0,count)});}return p;}
 for(let i=0;i<(observation?.steps?.length||0);i++){const s=observation.steps[i],p=path(s),value=observation.results?.[i];if(!p)continue;if(value&&typeof value==='object'&&typeof value.reference==='string'){handles.set(value.reference,p);if(s.id)handles.set(s.id,p);}else before.set(key(p),{path:p,value:copy(value),read:copy(s)});}
 for(const [k,v] of before)after.set(k,copy(v));
 const changed=new Set();
 for(const s of proposal?.steps||[]){if(s.action==='get')continue;const p=path(s);if(s.action!=='set'||!p||!before.has(key(p))){unmappedChanges++;continue;}after.set(key(p),{...copy(before.get(key(p))),path:p,value:copy(s.value)});changed.add(key(p));}
 return {before,after,changed,unmappedChanges};
}
function styleFor(records,path){
 const value=names=>records.get(key([...path,...names.split('.').map(name=>({name,args:[]}))]))?.value,s={};
 const n=(name,prop,min,max)=>{const v=value(name);if(finite(v)&&v>=min&&v<=max)s[prop]=v;};
 n('Font.Size','fontSize',1,400);n('ParagraphFormat.LineSpacing','lineSpacing',1,1000);n('ParagraphFormat.LineSpacingRule','lineSpacingRule',0,5);n('ParagraphFormat.Alignment','alignment',0,3);n('ParagraphFormat.SpaceBefore','spaceBefore',0,1000);n('ParagraphFormat.SpaceAfter','spaceAfter',0,1000);
 if(typeof value('Font.Name')==='string')s.fontFamily=value('Font.Name').slice(0,120);
 if(value('Font.Bold')!==undefined&&[true,false,0,-1].includes(value('Font.Bold')))s.bold=!!value('Font.Bold');
 if(value('Font.Italic')!==undefined&&[true,false,0,-1].includes(value('Font.Italic')))s.italic=!!value('Font.Italic');
 s.color=rgb(value('Font.Color')??value('Font.Color.RGB'));if(s.color===undefined)delete s.color;
 if([true,-1,1].includes(value('ParagraphFormat.PageBreakBefore')))s.pageBreakBefore=true;
 return s;
}
function wordView(records,changed){
 const entries=[...records.values()],value=p=>records.get(key(p))?.value;let partial=false,total=0;
 const touched=path=>[...changed].some(k=>{const candidate=JSON.parse(k);return candidate.length>=path.length&&path.every((p,i)=>JSON.stringify(p)===JSON.stringify(candidate[i]));});
 const bounded=text=>{if(typeof text!=='string')return '';const left=Math.max(0,40000-total),v=text.slice(0,left);total+=v.length;if(v.length<text.length)partial=true;return v;};
 const texts=entries.filter(r=>r.path.at(-1).name==='Text'&&typeof r.value==='string'),body=texts.find(r=>r.path.length===2&&r.path[0].name==='Content')||texts.find(r=>r.path.length===1);
 const blocks=[],tables=new Map();
 if(body){
  let text=body.value;const bodyChanged=touched(body.path.slice(0,-1));
  // Apply observed absolute range edits against the actual observed Content.
  const ranges=texts.filter(r=>r.path[0]?.name==='Range'&&r.path[0].args.length===2&&changed.has(key(r.path)));
  if(!bodyChanged)for(const r of ranges.sort((a,b)=>b.path[0].args[0]-a.path[0].args[0])){const [start,end]=r.path[0].args;if(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&end<=text.length)text=text.slice(0,start)+r.value+text.slice(end);else partial=true;}
  let offset=0;const spans=[...ranges].sort((a,b)=>a.path[0].args[0]-b.path[0].args[0]).map(r=>{const [a,b]=r.path[0].args,start=a+offset;offset+=r.value.length-(b-a);return {start,end:start+r.value.length};});let at=0;
  const content=bounded(text),parts=content.match(/[^\r\n\f]*(?:\r\n|\r|\n|\f|$)/g)?.filter(Boolean)||[];
  for(let i=0;i<parts.length;i++){const end=at+parts[i].length;blocks.push({id:'body-'+i,sourceKey:key(body.path),kind:'paragraph',text:parts[i],style:styleFor(records,body.path.slice(0,-1)),changed:bodyChanged||spans.some(s=>s.start<end&&s.end>at)});at=end;}
 }
 for(const r of texts){
  const p=r.path,tableAt=p.findIndex(t=>t.name==='Tables'),cellAt=p.findIndex(t=>t.name==='Cell');
  if(tableAt>=0&&cellAt>tableAt){const tableId=p[tableAt+1]?.args[0],coordinates=p[cellAt].args;if(!Number.isInteger(tableId)||coordinates.length!==2||!coordinates.every(n=>Number.isInteger(n)&&n>=1&&n<=1000)){partial=true;continue;}
   if(!tables.has(tableId))tables.set(tableId,{id:'table-'+tableId,kind:'table',index:tableId,cells:[],changed:false});const t=tables.get(tableId);if(t.cells.length>=240){partial=true;continue;}t.cells.push({row:coordinates[0],col:coordinates[1],sourceKey:key(p),text:bounded(r.value.replace(/\r?\x07$/,'').replace(/\r$/,'')),changed:changed.has(key(p))});t.changed ||=changed.has(key(p));continue;
  }
  if(body)continue;
  const parent=p.slice(0,-1),index=p.find(t=>t.name==='Item')?.args[0],start=value([...parent,{name:'Start',args:[]}])??(p[0]?.name==='Range'?p[0].args[0]:undefined);
  blocks.push({id:key(parent),sourceKey:key(p),kind:'paragraph',text:bounded(r.value),style:styleFor(records,parent),changed:touched(parent),...(finite(start)?{start}:{}),...(Number.isInteger(index)?{index}:{})});
 }
 blocks.sort((a,b)=>(a.start??a.index??0)-(b.start??b.index??0));blocks.push(...[...tables.values()].sort((a,b)=>a.index-b.index));
 if(blocks.length>300){blocks.length=300;partial=true;}
 const setup=name=>records.get(key([{name:'PageSetup',args:[]},{name,args:[]}]))?.value;
 const width=setup('PageWidth'),height=setup('PageHeight'),page={width:finite(width)&&width>100&&width<3000?width:595,height:finite(height)&&height>100&&height<3000?height:842,sizeKnown:finite(width)&&finite(height)};
 for(const name of ['TopMargin','BottomMargin','LeftMargin','RightMargin']){const n=setup(name);if(finite(n)&&n>=0&&n<page.width/2)page[name]=n;}
 page.changed=[...changed].some(k=>JSON.parse(k)[0]?.name==='PageSetup');return {blocks,page,partial};
}
function pptView(records,changed){
 const slides=new Map();let partial=false;
 const slide=i=>{if(!slides.has(i))slides.set(i,{index:i,name:`슬라이드 ${i}`,shapes:new Map(),notes:[]});return slides.get(i);};
 for(const [k,r] of records){const p=r.path,at=p.findIndex(t=>t.name==='Slides'),item=p[at+1];if(at<0||item?.name!=='Item'||!Number.isInteger(item.args[0])||item.args[0]<1){continue;}const sl=slide(item.args[0]),prop=p.at(-1).name;
  if(p.some(t=>t.name==='NotesPage')){if(prop==='Text'&&typeof r.value==='string'){sl.notes.push(r.value.slice(0,8000));sl.notesChanged ||=changed.has(k);if(r.value.length>8000)partial=true;}continue;}
  const shapesAt=p.findIndex(t=>t.name==='Shapes'),shapeItem=p[shapesAt+1];if(shapesAt<0){if(prop==='Name'&&typeof r.value==='string')sl.name=r.value.slice(0,300);continue;}
  if(shapeItem?.name!=='Item'||!Number.isInteger(shapeItem.args[0])||shapeItem.args[0]<1)continue;
  if(sl.shapes.size>=100&&!sl.shapes.has(shapeItem.args[0])){partial=true;continue;}
  const index=shapeItem.args[0];if(!sl.shapes.has(index))sl.shapes.set(index,{index,name:`개체 ${index}`,changed:false});const s=sl.shapes.get(index);s.sourceKeys ||= {};const tail=p.slice(shapesAt+2).map(t=>t.name).join('.');s.changed ||=changed.has(k);s.sourceKeys[tail]=k;
  if(['Left','Top','Width','Height','Rotation','AutoShapeType','Type','ZOrderPosition'].includes(tail)&&finite(r.value))s[tail[0].toLowerCase()+tail.slice(1)]=r.value;
  if(tail==='Name'&&typeof r.value==='string')s.name=r.value.slice(0,300);
  if(['TextFrame.TextRange.Text','TextFrame2.TextRange.Text'].includes(tail)&&typeof r.value==='string'){s.text=r.value.slice(0,16000);if(s.text.length<r.value.length)partial=true;}
  if(/^(TextFrame|TextFrame2)\.TextRange\.Font\.Size$/.test(tail)&&finite(r.value)&&r.value>0&&r.value<400)s.fontSize=r.value;
  if(/^(TextFrame|TextFrame2)\.TextRange\.Font\.Bold$/.test(tail))s.bold=[true,-1,1].includes(r.value);
  if(/^(TextFrame|TextFrame2)\.TextRange\.Font\.Name$/.test(tail)&&typeof r.value==='string')s.fontFamily=r.value.slice(0,120);
  if(tail==='Fill.ForeColor.RGB')s.fill=rgb(r.value);
  if(tail==='Line.ForeColor.RGB')s.line=rgb(r.value);
  if(/^(TextFrame|TextFrame2)\.TextRange\.Font\.Color\.RGB$/.test(tail))s.color=rgb(r.value);
 }
 if(slides.size>40)partial=true;
 const dimension=prop=>records.get(key([{name:'PageSetup',args:[]},{name:prop,args:[]}]))?.value,width=dimension('SlideWidth'),height=dimension('SlideHeight'),sizeKnown=finite(width)&&finite(height)&&width>0&&height>0&&width<20000&&height<20000;
 return {width:sizeKnown?width:960,height:sizeKnown?height:540,sizeKnown,partial,slides:[...slides.values()].sort((a,b)=>a.index-b.index).slice(0,40).map(sl=>({...sl,shapes:[...sl.shapes.values()].sort((a,b)=>(a.zOrderPosition??a.index)-(b.zOrderPosition??b.index)).map(s=>({...s,positionKnown:['left','top','width','height'].every(n=>finite(s[n]))&&s.width>=0&&s.height>=0}))}))};
}
export function nativeDocumentPreview(app,observation,proposal){
 if(!['word','powerpoint'].includes(app))throw Error('native_preview_app_invalid');
 const g=graph(app,observation,proposal);
 for(const k of g.changed){const p=g.after.get(k).path,names=p.map(t=>t.name).join('.'),supported=app==='word'?/(?:^|\.)(?:Text|PageSetup\.(?:PageWidth|PageHeight|TopMargin|BottomMargin|LeftMargin|RightMargin)|Font\.(?:Size|Name|Bold|Italic|Color(?:\.RGB)?)|ParagraphFormat\.(?:LineSpacing|LineSpacingRule|Alignment|SpaceBefore|SpaceAfter|PageBreakBefore))$/.test(names):/(?:^|\.)(?:TextFrame2?\.TextRange\.(?:Text|Font\.(?:Size|Bold|Name|Color\.RGB))|Fill\.ForeColor\.RGB|Line\.ForeColor\.RGB|Name|Left|Top|Width|Height|Rotation|AutoShapeType|Type|ZOrderPosition|PageSetup\.(?:SlideWidth|SlideHeight))$/.test(names);if(!supported)g.unmappedChanges++;}
 const build=app==='word'?wordView:pptView,before=build(g.before,new Set()),after=build(g.after,g.changed);
 const editTargets=[];for(const [k,r]of g.after){const names=r.path.map(t=>t.name).join('.'),field=names.endsWith('.Text')||names==='Text'?'text':app==='powerpoint'&&/\.(Left|Top|Width|Height)$/.test(names)?r.path.at(-1).name.toLowerCase():null;if(!field||!r.read||field==='text'&&typeof r.value!=='string'||field!=='text'&&!finite(r.value))continue;editTargets.push({id:'native-edit-'+editTargets.length,sourceKey:k,field,value:copy(r.value),read:copy(r.read)});}
 return {app,before,after,editTargets,unmappedChanges:g.unmappedChanges,partial:before.partial||after.partial,scope:'observed_native_properties',officeRendered:false};
}
