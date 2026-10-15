import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfm} from 'micromark-extension-gfm';
import {gfmFromMarkdown} from 'mdast-util-gfm';

// Parse the same Markdown link syntax as the answer renderer. Code examples,
// escaped links and images are not evidence citations.
export function citationLinks(content) {
  const tree=fromMarkdown(String(content||''),{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]});
  const definitions=new Map(),links=[];
  const walk=(node,visit)=>{visit(node);for(const child of node.children||[])walk(child,visit);};
  walk(tree,node=>{if(node.type==='definition'&&!definitions.has(node.identifier))definitions.set(node.identifier,node.url);});
  walk(tree,node=>{
    const href=node.type==='link'?node.url:node.type==='linkReference'?definitions.get(node.identifier):null;
    if(!href?.startsWith('#nubi-cite-'))return;
    links.push({id:href.slice('#nubi-cite-'.length),href,start:node.position.start.offset,end:node.position.end.offset});
  });
  return links;
}

export function numberCitationLinks(content,links,references) {
  let text=String(content||'');
  const numbers=new Map(references.map(source=>[source.citationId,source.number]));
  for(const link of [...links].reverse()){
    const number=numbers.get(link.id);
    if(number)text=text.slice(0,link.start)+`[${number}](${link.href})`+text.slice(link.end);
  }
  return text;
}
