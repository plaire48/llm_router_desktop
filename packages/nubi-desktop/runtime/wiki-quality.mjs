import path from 'node:path';
import {marked} from 'marked';

// Structural inspection only. A readable page and matching source hashes do
// not establish factual correctness; independent semantic review stays separate.
export function inspectWikiPage(page,text,{paths=new Set()}={}){
 const body=text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,''),tokens=marked.lexer(body),issues=[];
 let headings=0,emptySections=0,links=0,brokenLinks=0;
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];if(token.type!=='heading')continue;headings++;
  let content=false;
  for(let j=i+1;j<tokens.length;j++){
   if(tokens[j].type==='heading'){content=tokens[j].depth>token.depth;break;}
   if(tokens[j].type!=='space'&&tokens[j].raw?.trim()){content=true;break;}
  }
  if(!content){emptySections++;issues.push({kind:'empty_section',heading:token.text.slice(0,160)});}
 }
 marked.walkTokens(tokens,token=>{
  if(token.type!=='link'||typeof token.href!=='string')return;
  const href=token.href;if(/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href))return;
  let link;try{link=decodeURIComponent(href.split(/[?#]/,1)[0]);}catch{return;}
  if(!/\.md$/i.test(link))return;links++;
  const target=path.posix.normalize(path.posix.join(path.posix.dirname(page),link));
  if(link.startsWith('/')||!paths.has(target)){brokenLinks++;issues.push({kind:'broken_link',href:href.slice(0,500),target:target.slice(0,500)});}
 });
 const chars=body.replace(/\s+/g,' ').trim().length;
 return {page,chars,headings,emptySections,links,brokenLinks,thin:chars<300,issues:issues.slice(0,12),omittedIssues:Math.max(0,issues.length-12)};
}
export function summarizeWikiQuality(rows,{limit=50}={}){
 const sum=key=>rows.reduce((n,row)=>n+(row[key]||0),0),needsAttention=row=>row.brokenLinks||row.emptySections||row.staleClaims||row.unavailableClaims||row.missingClaims;
 // Put actionable pages first; keep overall counts even when row output is bounded.
 const ordered=[...rows.filter(needsAttention),...rows.filter(row=>!needsAttention(row))];
 return {pages:rows.length,attentionPages:rows.filter(needsAttention).length,emptySections:sum('emptySections'),brokenLinks:sum('brokenLinks'),thinPages:rows.filter(r=>r.thin).length,
  missingClaims:sum('missingClaims'),staleClaims:sum('staleClaims'),unavailableClaims:sum('unavailableClaims'),sourceReviewPages:rows.filter(r=>r.staleClaims||r.unavailableClaims).length,unreviewedPages:sum('unreviewedPages'),
  medianChars:rows.map(r=>r.chars).sort((a,b)=>a-b)[Math.floor(rows.length/2)]??0,
  modelCalls:0,factualCorrectness:'not_evaluated',rows:ordered.slice(0,limit),omitted:Math.max(0,rows.length-limit)};
}
export function lintWikiPages(pages){
 const paths=new Set(Object.keys(pages));return summarizeWikiQuality(Object.entries(pages).map(([page,text])=>inspectWikiPage(page,text,{paths})),{limit:Infinity});
}
