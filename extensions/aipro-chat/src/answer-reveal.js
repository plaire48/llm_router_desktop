// Opt-in presentation only, after sanitization. Never split Markdown source or
// code: doing so would reparse every tick and change links, tables and copying.
export function answerReveal() {
  return tree => {
    const nodes=[];
    function collect(parent){
      // Reveal structured blocks as a unit, so empty bullets/table borders do
      // not appear before their text. Code children must remain plain strings.
      if(['pre','table','ul','ol','blockquote','a'].includes(parent.tagName)){nodes.push({atomic:parent});return;}
      if(['code','button','summary'].includes(parent.tagName))return;
      for(const child of parent.children||[]){
        if(child.type==='text'&&child.value.trim())nodes.push({parent,child});
        else if(child.type==='element')collect(child);
      }
    }
    collect(tree);
    const length=nodes.reduce((sum,{child})=>sum+(child?.value.length||1),0);
    // Huge documents stay immediate; no thousands of animated DOM nodes.
    if(!length||length>20000||nodes.length>160)return;
    const size=Math.max(6,Math.ceil(length/Math.max(1,160-nodes.length)));
    const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
    const pieces=[];
    for(const {parent,child,atomic} of nodes){
      if(atomic){atomic.properties={...atomic.properties,className:[...(atomic.properties?.className||[]),'nubi-answer-piece']};pieces.push(atomic);continue;}
      const chunks=[];let value='';
      for(const {segment} of segmenter.segment(child.value)){
        value+=segment;
        if(value.length>=size){chunks.push(value);value='';}
      }
      if(value)chunks.push(value);
      const replacements=chunks.map(value=>{
        const span={type:'element',tagName:'span',properties:{className:['nubi-answer-piece']},children:[{type:'text',value}]};
        pieces.push(span);return span;
      });
      parent.children.splice(parent.children.indexOf(child),1,...replacements);
    }
    const step=Math.min(22,800/Math.max(1,pieces.length-1));
    pieces.forEach((piece,index)=>{piece.properties.style=`animation-delay:${Math.round(index*step)}ms`;});
  };
}
