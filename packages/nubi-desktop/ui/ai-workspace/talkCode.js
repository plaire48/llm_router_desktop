import {common,createLowlight} from 'lowlight';
export const talkLowlight=createLowlight(common);
export const TALK_CODE_LANGUAGES=[['plaintext','일반 텍스트'],['javascript','JavaScript'],['typescript','TypeScript'],['python','Python'],['java','Java'],['json','JSON'],['yaml','YAML'],['sql','SQL'],['bash','Shell'],['xml','HTML / XML'],['css','CSS'],['go','Go'],['csharp','C#'],['cpp','C++'],['markdown','Markdown']];
const aliases={js:'javascript',ts:'typescript',py:'python',sh:'bash',shell:'bash',html:'xml',yml:'yaml',cs:'csharp',text:'plaintext',txt:'plaintext'};
export const talkCodeLanguage=value=>{const language=aliases[value]||value||'plaintext';return TALK_CODE_LANGUAGES.find(([id])=>id===language)?.[1]||language;};
function append(parent,node) {
  if(node.type==='text'){parent.append(document.createTextNode(node.value));return;}
  if(node.type==='element') {const span=document.createElement('span');span.className=(node.properties?.className||[]).filter(name=>/^[a-z\d_-]+$/i.test(name)).join(' ');for(const child of node.children||[])append(span,child);parent.append(span);}
}
export function highlightTalkCode(root) {
  root?.querySelectorAll('pre code').forEach(code=>{
    const text=code.textContent,language=code.className.replace('language-','')||'plaintext';
    const label=document.createElement('span');label.className='talk-code-language';label.textContent=talkCodeLanguage(language);code.parentElement.prepend(label);
    if(language==='plaintext'||text.length>20000)return;
    try {if(!talkLowlight.registered(language))return;const result=talkLowlight.highlight(language,text);const fragment=document.createDocumentFragment();for(const child of result.children)append(fragment,child);code.replaceChildren(fragment);}catch{/* Plain text remains readable. */}
  });
}
export function highlightSafeTalkHtml(sanitizedHtml) {
  const wrapper=document.createElement('div');wrapper.innerHTML=sanitizedHtml;highlightTalkCode(wrapper);return wrapper.innerHTML;
}
