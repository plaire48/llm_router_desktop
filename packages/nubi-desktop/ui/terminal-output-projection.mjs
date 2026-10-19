import {terminalReadableText} from '../runtime/terminal-readable-text.mjs';
// The parser resets at a newline, including an unfinished terminal escape.
// Reuse only complete raw lines. An edited prefix invalidates this local cache.
// The incomplete tail is always reparsed so split ANSI/CRLF/Unicode survives.
export function createTerminalProjection(parse=terminalReadableText){
 let prefix='',clean='';
 return value=>{
  const raw=String(value??'');if(!raw.startsWith(prefix)){prefix='';clean='';}
  const end=raw.lastIndexOf('\n')+1;
  if(end>prefix.length){clean+=parse(raw.slice(prefix.length,end));prefix=raw.slice(0,end);}
  return clean+parse(raw.slice(end));
 };
}
// All characters remain in the DOM for selection/search/copy. Groups let the
// browser skip layout/paint of distant output without deleting retained lines.
export function terminalTextChunks(text){
 const chunks=[];let start=0,cursor=0,lines=0;
 while((cursor=text.indexOf('\n',cursor))!==-1){cursor++;if(++lines===50){chunks.push(text.slice(start,cursor));start=cursor;lines=0;}}
 if(start<text.length)chunks.push(text.slice(start));return chunks;
}
