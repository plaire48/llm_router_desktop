// Context headers are navigation data. Excerpts and line numbers always name
// the original page bytes; no generated prefix becomes quoted evidence.
export function wikiChunks(doc,{maxCharacters=2000}={}){
 if(typeof doc?.raw!=='string'||typeof doc.path!=='string'||!Number.isInteger(maxCharacters)||maxCharacters<200||maxCharacters>16000)throw Error('wiki_chunks_invalid');
 const raw=doc.raw,lines=raw.split('\n'),offsets=[];let at=0;for(const line of lines){offsets.push(at);at+=line.length+1;}
 let first=0;if(lines[0]?.trim()==='---'){const close=lines.findIndex((line,i)=>i>0&&line.trim()==='---');if(close>0)first=close+1;}
 const sections=[],headings=[];let start=first,fence=null;
 for(let i=first;i<lines.length;i++){
  const marker=/^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
  if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;continue;}
  if(fence)continue;
  const match=/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);if(!match)continue;
  if(i>start)sections.push({start,end:i-1,headings:[...headings]});
  const level=match[1].length;while(headings.length&&headings.at(-1).level>=level)headings.pop();headings.push({level,text:match[2].trim().slice(0,200)});start=i;
 }
 if(start<lines.length)sections.push({start,end:lines.length-1,headings:[...headings]});
 const chunks=[];
 for(const section of sections){
  let a=section.start,b=section.end;while(a<=b&&!lines[a].trim())a++;while(b>=a&&!lines[b].trim())b--;if(a>b)continue;
  if(sections.length>1&&lines.slice(a,b+1).every(line=>!line.trim()||/^ {0,3}#{1,6}\s/.test(line)))continue;
  const headingPath=section.headings.length?section.headings.map(h=>h.text):[doc.title||doc.path],summary=typeof doc.fields?.summary==='string'?doc.fields.summary.replace(/[\r\n]+/g,' ').slice(0,240):'';
  const header=doc.path+' > '+headingPath.join(' > ')+(summary?': '+summary:'');let cursor=offsets[a],end=offsets[b]+lines[b].length;
  while(cursor<end){
   let stop=Math.min(end,cursor+maxCharacters);if(stop<end){const boundary=raw.lastIndexOf('\n',stop);if(boundary>cursor)stop=boundary;}
   const from=cursor,text=raw.slice(from,stop);let lo=a,hi=b;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(offsets[mid]<=from)lo=mid;else hi=mid-1;}const startLine=lo+1;lo=a;hi=b;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(offsets[mid]<stop)lo=mid;else hi=mid-1;}const endLine=lo+1;
   if(text.trim())chunks.push({id:doc.path+':'+from,sourceHash:doc.hash,path:doc.path,header,headingPath,text,start:startLine,end:endLine,offset:from,endOffset:stop,partial:from>offsets[a]||stop<end});
   cursor=stop;if(raw[cursor]==='\n')cursor++;
  }
 }
 return chunks;
}
