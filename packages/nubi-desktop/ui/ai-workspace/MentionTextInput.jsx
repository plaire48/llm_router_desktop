import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {useEditor,EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {IdentityMention} from './IdentityMention';
import {MentionMenu} from './MentionMenu';
import {useTalkMentionPreview} from './TalkMentions';
import {useGithubProfileReader} from './AccountProfile';
const plain=doc=>doc.textBetween(0,doc.content.size,'\n',node=>node.type.name==='mention'?`@${node.attrs.id}`:node.type.name==='hardBreak'?'\n':'');
export function MentionTextInput({resetKey,onChange,client,disabled,label,placeholder,inputRef,maxLength=500,initialValue=''}) {
 const profile=useGithubProfileReader(client.profile);
 const latest=useRef({onChange,client,disabled,profile});latest.current={onChange,client,disabled,profile};
 const id=useId(),[suggestion,setSuggestion]=useState(null),[index,setIndex]=useState(0),indexRef=useRef(0),suggestionRef=useRef(null);suggestionRef.current=suggestion;
 const preview=useTalkMentionPreview(profile);
 const extensions=useMemo(()=>[
  StarterKit.configure({blockquote:false,bold:false,bulletList:false,code:false,codeBlock:false,heading:false,horizontalRule:false,italic:false,listItem:false,listKeymap:false,orderedList:false,strike:false,underline:false,link:false,trailingNode:false}),
  Placeholder.configure({placeholder}),
  Extension.create({name:'commentLength',addProseMirrorPlugins(){return [new Plugin({filterTransaction:(transaction,state)=>!transaction.docChanged||plain(transaction.doc).length<=maxLength||plain(transaction.doc).length<plain(state.doc).length})];}}),
  IdentityMention.configure({profile:login=>latest.current.profile?.(login),renderText:({node})=>`@${node.attrs.id}`,renderHTML:({node})=>['span',{'data-type':'mention','data-id':node.attrs.id},`@${node.attrs.id}`],suggestion:{items:async({query})=>{try{return await latest.current.client.mentionItems?.(query)||[];}catch{return [];}},render:()=>({
   onStart:props=>{indexRef.current=0;setIndex(0);setSuggestion(props.editor.isFocused?props:null);},onUpdate:props=>{indexRef.current=0;setIndex(0);setSuggestion(props.editor.isFocused?props:null);},onExit:()=>setSuggestion(null),
   onKeyDown:({event})=>{if(event.isComposing)return false;const current=suggestionRef.current;if(event.key==='Escape'){setSuggestion(null);return true;}if(!current?.items.length)return false;
    if(['ArrowDown','ArrowUp'].includes(event.key)){indexRef.current=(indexRef.current+(event.key==='ArrowDown'?1:-1)+current.items.length)%current.items.length;setIndex(indexRef.current);return true;}
    if(event.key==='Enter'){current.command({id:current.items[indexRef.current].login});return true;}return false;},
  })}}),
 ],[]);
 const editor=useEditor({extensions,content:'',editable:!disabled,editorProps:{attributes:{class:'cx-mention-input','aria-label':label,role:'textbox','aria-multiline':'true','data-maxlength':String(maxLength)},handlePaste:(view,event)=>{
  const text=event.clipboardData?.getData('text/plain');if(text==null)return false;event.preventDefault();const selected=plain(view.state.doc.cut(view.state.selection.from,view.state.selection.to));const room=Math.max(0,maxLength-plain(view.state.doc).length+selected.length);view.dispatch(view.state.tr.insertText(text.slice(0,room)));return true;
 }},onUpdate:({editor})=>latest.current.onChange(plain(editor.state.doc)),onBlur:()=>setSuggestion(null)});
 useEffect(()=>{editor?.setEditable(!disabled,false);if(disabled)setSuggestion(null);},[editor,disabled]);
 useEffect(()=>{editor?.commands.setContent(initialValue?{type:'doc',content:initialValue.split('\n').map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}))}:'',{emitUpdate:false});},[editor,resetKey,initialValue]);
 useEffect(()=>{if(inputRef)inputRef.current=editor?.view.dom||null;return()=>{if(inputRef)inputRef.current=null;};},[editor,inputRef]);
 const anchor=editor?.view.dom;
 useEffect(()=>{if(!anchor)return;const open=Boolean(suggestion&&!disabled);anchor.setAttribute('aria-disabled',String(Boolean(disabled)));anchor.setAttribute('aria-expanded',String(open));if(open){anchor.setAttribute('aria-controls',id);if(suggestion.items.length)anchor.setAttribute('aria-activedescendant',`${id}-${index}`);else anchor.removeAttribute('aria-activedescendant');}else {anchor.removeAttribute('aria-controls');anchor.removeAttribute('aria-activedescendant');}},[anchor,suggestion,index,disabled,id]);
 return <div className="cx-mention-input-wrap" {...preview.handlers}><EditorContent editor={editor}/>{suggestion&&!disabled&&<MentionMenu id={id} items={suggestion.items} loading={suggestion.loading} activeIndex={index} anchorElement={anchor} anchorRect={suggestion.clientRect} onSelect={user=>suggestion.command({id:user.login})}/>} {preview.popup}</div>;
}
