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
 return {title:text(meta.title)||firstHeading(body).slice(0,160)||name,type:text(meta.type),description:text(meta.description).slice(0,300),tags:(meta.tags||[]).slice(0,20),body,frontmatter};
}
module.exports={splitFrontmatter,firstHeading,describeWikiPage};
