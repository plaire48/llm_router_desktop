import DOMPurify from 'dompurify';
import {marked} from 'marked';
import TurndownService from 'turndown';
import {gfm} from 'turndown-plugin-gfm';

const tags=['p','br','strong','b','em','i','u','s','del','h2','h3','h4','ul','ol','li','blockquote','pre','code','a','img','video','table','thead','tbody','tr','th','td','hr','span','mark','input','label','div'];
const attrs=['href','src','alt','title','start','style','class','colspan','rowspan','checked','disabled','type','data-type','data-checked','data-id','data-label','data-name','data-size'];
export function safeTalkUrl(value,{media=false,allowBlob=false}={}) {
  if(typeof value!=='string'||value.length>4096||/[\u0000-\u0020<>"\\]/.test(value))return '';
  if(allowBlob&&/^blob:https?:\/\//.test(value))return value;
  try {const url=new URL(value);return (url.protocol==='https:'||(!media&&url.protocol==='http:'))&&!url.username&&!url.password?url.href:'';} catch{return '';}
}
// One policy is used for paste, source input, saved HTML and read-only rendering.
// Only a small set of semantic formatting attributes survives. No executable embeds.
export function sanitizeTalkHtml(html,{allowBlob=false}={}) {
  const fragment=DOMPurify.sanitize(String(html||''),{ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,RETURN_DOM_FRAGMENT:true});
  fragment.querySelectorAll('*').forEach(el=>{
    const type=el.getAttribute('data-type');
    if(!['taskList','taskItem','mention','attachment'].includes(type))el.removeAttribute('data-type');
    if(el.tagName==='CODE'&&/^language-[a-z\d-]{1,30}$/i.test(el.getAttribute('class')||'')){}else el.removeAttribute('class');
    if(type!=='attachment'){el.removeAttribute('data-name');el.removeAttribute('data-size');}
    else {el.setAttribute('data-name',(el.getAttribute('data-name')||el.textContent).slice(0,200).replace(/[\x00-\x1f/\\]/g,'_'));if(!/^\d{1,9}$/.test(el.getAttribute('data-size')||''))el.removeAttribute('data-size');}
    if(type!=='mention'){el.removeAttribute('data-id');el.removeAttribute('data-label');}
    if(type==='mention'&&!/^[a-z\d][a-z\d-]{0,38}$/i.test(el.getAttribute('data-id')||''))el.removeAttribute('data-type');
    if(el.hasAttribute('style')) {
      const align=el.style.textAlign,color=el.style.color,background=el.style.backgroundColor;
      el.removeAttribute('style');
      if(['left','center','right'].includes(align))el.style.textAlign=align;
      if(/^(#[a-f\d]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(color))el.style.color=color;
      if(/^(#[a-f\d]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(background))el.style.backgroundColor=background;
    }
    if(el.tagName==='A') {const href=safeTalkUrl(el.getAttribute('href'));if(href)el.setAttribute('href',href);else el.removeAttribute('href');el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');}
    if(['IMG','VIDEO'].includes(el.tagName)) {const src=safeTalkUrl(el.getAttribute('src'),{media:true,allowBlob});if(!src){el.remove();return;}el.setAttribute('src',src);el.setAttribute('referrerpolicy','no-referrer');if(el.tagName==='VIDEO'){el.setAttribute('controls','');el.setAttribute('preload','metadata');el.setAttribute('playsinline','');}else el.setAttribute('loading','lazy');}
    if(el.tagName==='INPUT'){if(el.type!=='checkbox'){el.remove();return;}el.setAttribute('disabled','');}
  });
  const wrapper=document.createElement('div');wrapper.append(fragment);return wrapper.innerHTML;
}
export function markdownToTalkHtml(value) {
  const wrapper=document.createElement('div');wrapper.innerHTML=sanitizeTalkHtml(marked.parse(String(value||''),{gfm:true,breaks:true}));
  // GFM checkboxes need Tiptap's semantic list attributes when switching back
  // to visual editing. Otherwise the editor turns them into plain bullets.
  wrapper.querySelectorAll('li').forEach(item=>{
    const input=[...item.querySelectorAll('input[type="checkbox"]')].find(node=>node.closest('li')===item);
    if(!input)return;item.setAttribute('data-type','taskItem');item.setAttribute('data-checked',String(input.checked));
    if(item.parentElement?.tagName==='UL')item.parentElement.setAttribute('data-type','taskList');
    // Match the editor's label/content structure in read and preview modes too.
    // Nested tasks belong below the text, not beside the parent's checkbox.
    input.remove();const label=document.createElement('label'),content=document.createElement('div');
    label.append(input);content.append(...item.childNodes);item.append(label,content);
  });
  return wrapper.innerHTML;
}
export function talkHtmlToMarkdown(html) {
  const cell=(content,node)=>`${node.previousElementSibling?' ':'| '}${content.trim().replace(/\r?\n+/g,'<br>').replace(/\\*\|/g,value=>value.length%2===0?value:`\\${value}`)} |`;
  const converter=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-',blankReplacement:(content,node)=>['TH','TD'].includes(node.nodeName)?cell('',node):node.isBlock?'\n\n':''});converter.use(gfm);
  // Tiptap wraps cell content in paragraphs; GFM cells must stay on one line.
  converter.addRule('editorTableCell',{filter:['th','td'],replacement:cell});
  converter.addRule('video',{filter:'video',replacement:(_,node)=>`\n\n[동영상](${node.getAttribute('src')})\n\n`});
  converter.addRule('attachment',{filter:node=>node.getAttribute?.('data-type')==='attachment',replacement:(_,node)=>`\n\n${node.outerHTML}\n\n`});
  converter.addRule('mention',{filter:node=>node.getAttribute?.('data-type')==='mention',replacement:(_,node)=>`@${node.getAttribute('data-id')}`});
  converter.addRule('editorTaskItem',{filter:node=>node.getAttribute?.('data-type')==='taskItem',replacement:(content,node)=>`- [${node.getAttribute('data-checked')==='true'?'x':' '}] ${content.replace(/^\s*\[[ xX]\]\s*/,'').trim().replace(/\n/g,'\n    ')}\n`});
  return converter.turndown(sanitizeTalkHtml(html));
}
export function talkExcerpt(body,format='html') {
  const wrapper=document.createElement('div');wrapper.innerHTML=format==='markdown'?markdownToTalkHtml(body):sanitizeTalkHtml(body);
  const media=[...wrapper.querySelectorAll('img,video')].slice(0,8).map(node=>({kind:node.tagName==='IMG'?'image':'video',src:node.getAttribute('src'),alt:node.getAttribute('alt')||''}));
  // Keep paragraph, list and table boundaries readable in the plain-text preview.
  wrapper.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,th,td,br,hr').forEach(node=>node.after(' '));
  return {media,text:wrapper.textContent.replace(/\s+/g,' ').trim(),image:wrapper.querySelector('img')?.getAttribute('src')||null,video:Boolean(wrapper.querySelector('video'))};
}
