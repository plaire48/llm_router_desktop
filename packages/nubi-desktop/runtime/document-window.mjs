// The document is parsed in a bounded worker; model/UI reads are independent
// windows. A successful window must never imply that the whole document was read.
export const DOCUMENT_MAX_BYTES=64*1024*1024;
export const DOCUMENT_MAX_TEXT=2_000_000;
export const DOCUMENT_WINDOW=60_000;
export function documentWindow(document,{offset=0,limit=DOCUMENT_WINDOW}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>DOCUMENT_WINDOW)throw Error('input_invalid');
 const full=document.text||'',end=Math.min(full.length,offset+limit);
 if(offset>full.length)throw Error('input_invalid');
 // Segment offsets are attached at extraction, preserving page/sheet provenance.
 const segments=locateSegments(full,document.segments||[]).filter(segment=>segment.start===undefined||segment.start<end&&segment.end>offset).map(segment=>{
  if(segment.start===undefined)return {...segment,text:segment.text.slice(0,limit)};
  return {...segment,text:segment.text.slice(Math.max(0,offset-segment.start),Math.max(0,end-segment.start))};
 });
 return {...document,text:full.slice(offset,end),segments,offset,totalCharacters:full.length,nextOffset:end<full.length?end:null,partial:offset>0||end<full.length,coverage:document.coverage+(offset>0||end<full.length?` / 본문 ${offset+1}–${end} / ${full.length}자`:''),...(offset>0||end<full.length?{html:undefined}:{})};
}
export function locateSegments(text,segments){
 let cursor=0;return segments.map(segment=>{const start=text.indexOf(segment.text,cursor);if(start<0)return segment;cursor=start+segment.text.length;return {...segment,start,end:cursor};});
}
