'use strict';
// OpenWiki starts every page with a small YAML front matter (type, title,
// description, tags). Only that subset is read here; the body below it is what
// the reader shows and what a person edits. Unknown keys are kept as strings.
const FRONTMATTER=/^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const unquote=value=>{const text=String(value).trim();return /^(["']).*\1$/.test(text)?text.slice(1,-1):text;};
const list=value=>{const text=String(value).trim();if(!/^\[.*\]$/.test(text))return null;return text.slice(1,-1).split(',').map(unquote).filter(Boolean);};
function splitFrontmatter(raw){
 const text=String(raw||'');const match=FRONTMATTER.exec(text);
 if(!match)return {meta:{},body:text,frontmatter:''};
 const meta={};let key=null;
 for(const line of (match[1]||'').split(/\r?\n/)){
  const item=/^\s*-\s+(.*)$/.exec(line);
  if(item&&key&&Array.isArray(meta[key])){meta[key].push(unquote(item[1]));continue;}
  const pair=/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
  if(!pair)continue;
  key=pair[1];const value=pair[2].trim();
  if(value==='')meta[key]=[];
  else meta[key]=list(value)??unquote(value);
 }
 const tags=Array.isArray(meta.tags)?meta.tags.map(String).filter(Boolean):typeof meta.tags==='string'&&meta.tags?[meta.tags]:[];
 return {meta:{...meta,tags},body:text.slice(match[0].length),frontmatter:match[0]};
}
function firstHeading(body){const match=/^#\s+(.+?)\s*#*\s*$/m.exec(String(body||''));return match?match[1].trim():'';}
// A page is described by its front matter first, then its first heading, then its file name.
function describeWikiPage(content,path=''){
 const {meta,body,frontmatter}=splitFrontmatter(content);
 const name=String(path).split('/').pop().replace(/\.md$/i,'');
 const text=value=>typeof value==='string'?value.trim().slice(0,160):'';
 return {title:text(meta.title)||firstHeading(body).slice(0,160)||name,type:text(meta.type),description:text(meta.description).slice(0,300),tags:(meta.tags||[]).slice(0,20),...(text(meta.thread)?{thread:text(meta.thread),messageId:text(meta.message_id),inReplyTo:text(meta.in_reply_to),date:text(meta.date)}:{}),body,frontmatter};
}
// Pages with the same `thread` front matter form a chain ordered by date (then path), each page linking to the next.
function threadEdges(items){
 const groups=new Map();
 for(const item of items){if(!item.thread)continue;const list=groups.get(item.thread)||[];list.push(item);groups.set(item.thread,list);}
 const edges=[];
 for(const list of groups.values()){
  if(list.length<2)continue;
  list.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.path).localeCompare(String(b.path)));
  for(let i=1;i<list.length;i++)edges.push({from:list[i-1].path,to:list[i].path,kind:'thread'});
 }
 return edges;
}
module.exports={splitFrontmatter,firstHeading,describeWikiPage,threadEdges};
