// Edit matching adopted from opencode (MIT License, Copyright (c) 2025 opencode), packages/core/src/tool/plugin/edit.ts
// at commit d93568f3. Exact match first, then typographic punctuation and special spaces normalized, then line by line
// ignoring trailing whitespace. Matching runs on the LF view the model reads and maps offsets back, so CRLF and mixed
// line endings neither block a match nor change untouched lines. See THIRD-PARTY-NOTICES.md.
const CRLF='\r\n';
export const normalizeForMatch=value=>value
 .replace(/[‘’‚‛]/g,"'")
 .replace(/[“”„‟]/g,'"')
 .replace(/[‐‑‒–—―−]/g,'-')
 .replace(/[  -   　]/g,' ');
function findOccurrences(content,search){
 const result=[];let offset=0;
 while((offset=content.indexOf(search,offset))!==-1){result.push({start:offset,end:offset+search.length});offset+=search.length;}
 return result;
}
function findLineOccurrences(content,search){
 const trailingNewline=search.endsWith('\n'),expected=search.split('\n');if(trailingNewline)expected.pop();
 const lines=[...content.matchAll(/[^\n]*(?:\n|$)/g)].filter(match=>match[0]!=='').map(match=>{
  const newline=match[0].endsWith('\n'),text=newline?match[0].slice(0,-1):match[0];
  return {start:match.index,end:match.index+match[0].length,text,contentEnd:match.index+text.length-(text.endsWith('\r')?1:0),newline};
 });
 const candidates=lines.flatMap((line,index)=>{
  const actual=lines.slice(index,index+expected.length);if(actual.length!==expected.length)return [];
  if(!actual.every((item,lineIndex)=>normalizeForMatch(item.text.trimEnd())===normalizeForMatch(expected[lineIndex].trimEnd())))return [];
  const last=actual.at(-1);if(trailingNewline&&!last.newline)return [];
  return [{start:line.start,end:trailingNewline?last.end:last.contentEnd}];
 });
 return candidates.reduce((result,candidate)=>{if(!result.some(match=>match.end>candidate.start&&match.start<candidate.end))result.push(candidate);return result;},[]);
}
// The dominant line ending in text, or fallback when there is none.
function lineEnding(text,fallback){
 const crlfCount=text.split(CRLF).length-1,lfCount=text.split('\n').length-1-crlfCount;
 if(crlfCount===lfCount)return fallback;return crlfCount>lfCount?CRLF:'\n';
}
// For each line of after, the index of the before line it keeps (longest common subsequence) or, between kept lines,
// the line it takes the place of; undefined for lines with no counterpart.
function alignLines(before,after){
 const width=after.length+1,table=new Uint32Array((before.length+1)*width);
 for(let i=before.length-1;i>=0;i--)for(let j=after.length-1;j>=0;j--)table[i*width+j]=before[i]===after[j]?table[(i+1)*width+j+1]+1:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
 const result=[],gap={before:[],after:[]};
 const flush=()=>{gap.after.forEach((j,k)=>{result[j]=gap.before[k];});gap.before=[];gap.after=[];};
 let i=0,j=0;
 while(i<before.length&&j<after.length){
  if(before[i]===after[j]){flush();result[j++]=i++;continue;}
  if(table[(i+1)*width+j]>=table[i*width+j+1])gap.before.push(i++);else gap.after.push(j++);
 }
 while(i<before.length)gap.before.push(i++);while(j<after.length)gap.after.push(j++);flush();
 return result;
}
// Joins the replacement's lines with endings taken from the matched source region: kept or replaced lines reuse their
// line's ending, extra lines take fallback, so unchanged context keeps its bytes even in a mixed-ending file.
function withRegionEndings(region,replacement,fallback){
 const before=region.split(/\r?\n/),endings=[...region.matchAll(/\r?\n/g)].map(match=>match[0]),after=replacement.split('\n');
 const key=line=>normalizeForMatch(line.trimEnd()),source=alignLines(before.map(key),after.map(key));
 return after.map((line,index)=>index===after.length-1?line:line+(endings[source[index]]??fallback)).join('');
}
function countBefore(positions,offset){
 let low=0,high=positions.length;
 while(low<high){const middle=(low+high)>>1;if(positions[middle]<offset)low=middle+1;else high=middle;}
 return low;
}
export function matchView(source,oldText,newText){
 const view=source.replaceAll(CRLF,'\n'),removed=[...source.matchAll(/\r\n/g)].map((match,index)=>match.index-index),fileEnding=lineEnding(source,'\n');
 const search=oldText.replaceAll(CRLF,'\n'),replacement=newText.replaceAll(CRLF,'\n');
 const exact=findOccurrences(view,search);
 const unicode=exact.length>0?[]:findOccurrences(normalizeForMatch(view),normalizeForMatch(search));
 const trailing=exact.length>0||unicode.length>0?[]:findLineOccurrences(view,search);
 return {
  matches:(exact.length>0?exact:unicode.length>0?unicode:trailing).map(match=>({start:match.start+countBefore(removed,match.start),end:match.end+countBefore(removed,match.end)})),
  replace:match=>{const region=source.slice(match.start,match.end);return withRegionEndings(region,replacement,lineEnding(region,fileEnding));},
 };
}
