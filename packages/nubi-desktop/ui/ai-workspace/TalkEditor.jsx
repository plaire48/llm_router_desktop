import {CxSelect} from './CxSelect';
import React,{useMemo,useRef,useState,useEffect,useId} from 'react';
import {useEditor,EditorContent,useEditorState,ReactNodeViewRenderer,NodeViewWrapper,NodeViewContent} from '@tiptap/react';
import {Node,mergeAttributes} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import {TableKit} from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import {TextStyle,Color} from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import {IdentityMention} from './IdentityMention';
import {MentionMenu} from './MentionMenu';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import {talkLowlight,TALK_CODE_LANGUAGES,talkCodeLanguage} from './talkCode';
import {ActionButton} from './ActionButton';
import {CxTabs} from './CxTabs';
import {DetailPanel} from './DetailPanel';
import {Icon} from './Icon';
import {sanitizeTalkHtml,markdownToTalkHtml,talkHtmlToMarkdown,safeTalkUrl} from './talkRichText';
import {notifyToast} from './Toast';
import {useTalkMentionPreview} from './TalkMentions';
import {TalkContent} from './TalkContent';
import {EDITOR_IMAGE_ACCEPT,editorImageFile,transferredFiles} from './editorImages';
import {prepareTalkAttachment} from './talkMedia';
import {AttachmentList} from './AttachmentList';
import {splitTalkAttachmentHtml,joinTalkAttachmentHtml} from './talkAttachments';
import './talk-editor.css';
import {useGithubProfileReader} from './AccountProfile';

const Video=Node.create({name:'video',group:'block',atom:true,draggable:true,
  addAttributes(){return {src:{default:null},title:{default:null}};},
  parseHTML(){return [{tag:'video[src]'}];},
  renderHTML({HTMLAttributes}){return ['video',mergeAttributes(HTMLAttributes,{controls:'',preload:'metadata',playsinline:''})];},
});
const Attachment=Node.create({name:'attachment',group:'block',atom:true,draggable:true,
  addAttributes(){return {href:{default:null},name:{default:'첨부 파일',parseHTML:el=>el.getAttribute('data-name')||el.textContent,renderHTML:attrs=>({'data-name':attrs.name})},size:{default:0,parseHTML:el=>Number(el.getAttribute('data-size'))||0,renderHTML:attrs=>({'data-size':attrs.size})}};},
  parseHTML(){return [{tag:'a[data-type="attachment"]',priority:1000}];},
  renderHTML({node,HTMLAttributes}){return ['a',mergeAttributes(HTMLAttributes,{'data-type':'attachment',title:node.attrs.name}),`${node.attrs.name}${node.attrs.size?` (${(node.attrs.size/1024).toFixed(1)} KB)`:''}`];},
});
function LinkDialog({initial='',onApply,onClose}) {
  const [url,setUrl]=useState(initial),[error,setError]=useState(''),field=useRef(null),errorId=useId();
  return <DetailPanel title={initial?"링크 수정":"링크 삽입"} variant="modal" className="talk-link-dialog" hideHelp onClose={onClose} footer={<ActionButton action="save" label={initial?"적용":"삽입"} onClick={()=>{const value=safeTalkUrl(url.trim());if(!value){setError('http 또는 https 주소를 입력하세요.');field.current?.focus();return;}onApply(value);}}/>}>
    <label className="field"><span className="input-label">주소</span><input ref={field} className="text-input" type="url" value={url} onChange={e=>{setUrl(e.target.value);setError('');}} placeholder="https://" aria-invalid={!!error} aria-describedby={error?errorId:undefined}/></label>{error&&<p id={errorId} className="field-error" role="alert">{error}</p>}
  </DetailPanel>;
}

function TalkCodeBlock({node,editor,updateAttributes}) {
  const language=node.attrs.language||'plaintext';
  const languages=TALK_CODE_LANGUAGES.some(([id])=>id===language)?TALK_CODE_LANGUAGES:[...TALK_CODE_LANGUAGES,[language,talkCodeLanguage(language)]];
  return <NodeViewWrapper className="talk-code-block">
    <div className="talk-code-header" contentEditable={false}>
      <CxSelect className="native-select" aria-label="코드 언어" value={language} disabled={!editor.isEditable} onChange={event=>updateAttributes({language:event.target.value})}>
        {languages.map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </CxSelect>
    </div>
    <NodeViewContent as="pre" data-placeholder={editor.isEditable&&!node.content.size?'코드를 입력하세요.':undefined} />
  </NodeViewWrapper>;
}

export default function TalkEditor({initialValue='',onChange,onBusy,upload,loadMedia,mentionItems,profile:providedProfile,media,githubFormat=false,disabled=false,invalid=false,describedBy,bodyLabel='글 본문',placeholder='나누고 싶은 이야기를 적으세요.',maxLength=50000,ref:apiRef}) {
  const profile=useGithubProfileReader(providedProfile);
  const [more,setMore]=useState(false),extraId=useId(),moreButton=useRef(null);
  const mention=useTalkMentionPreview(profile);
  const latest=useRef({onChange,onBusy,upload,loadMedia,mentionItems,profile});latest.current={onChange,onBusy,upload,loadMedia,mentionItems,profile};
  const live=useRef(true),uploadLock=useRef(false),fileInput=useRef(null),editorRef=useRef(null),sourceRef=useRef({mode:'write',value:'',dirty:false});
  const [mode,setMode]=useState('write'),[source,setSource]=useState(''),[link,setLink]=useState(null),[uploading,setUploading]=useState(false),[suggestion,setSuggestion]=useState(null);
  const suggestionRef=useRef(null);suggestionRef.current=suggestion;
  const [mentionIndex,setMentionIndex]=useState(0),mentionIndexRef=useRef(0);
  const nativeAttachments=Boolean(media?.nativeAttachments);
  const fileAttachments=Boolean(media?.attachments);
  const [initial]=useState(()=>fileAttachments?splitTalkAttachmentHtml(initialValue,media.storedPath):{html:initialValue,files:[]});
  const [files,setFiles]=useState(initial.files),filesRef=useRef(initial.files);
  const changeFiles=next=>{filesRef.current=next;setFiles(next);latest.current.onChange?.(joinTalkAttachmentHtml(currentBodyHtml(),next));};
  const [imageAccess,setImageAccess]=useState({allowed:!media?.canUpload&&!nativeAttachments,loading:Boolean(media?.canUpload),reason:''});
  useEffect(()=>{
    let active=true;
    if(!media?.canUpload){setImageAccess({allowed:!nativeAttachments,loading:false,reason:nativeAttachments?'첨부 저장소 연결 필요':''});return;}
    setImageAccess({allowed:false,loading:true,reason:''});
    media.canUpload().then(allowed=>{if(active)setImageAccess({allowed,loading:false,reason:allowed?'':'첨부 권한이 없습니다'});}).catch(()=>{if(active)setImageAccess({allowed:false,loading:false,reason:'첨부 권한을 확인하지 못했습니다. 새로고침하세요.'});});
    return()=>{active=false;};
  },[media,nativeAttachments]);
  const addFiles=async files=>{
    if(disabled||uploadLock.current||!files.length)return;
    const attached=new Set(filesRef.current.map(file=>file.url));editorRef.current?.state.doc.descendants(node=>{if(['image','video','attachment'].includes(node.type.name))attached.add(node.attrs.src||node.attrs.href);for(const mark of node.marks||[])if(mark.type.name==='link'&&media?.storedPath?.(mark.attrs.href))attached.add(mark.attrs.href);});const count=attached.size;
    if(count+files.length>8){notifyToast('첨부는 글마다 8개까지 추가할 수 있습니다.',{source:'talk-upload',error:true});return;}
    uploadLock.current=true;setUploading(true);latest.current.onBusy?.(true);
    try {
      const images=[];for(const file of files)images.push(await(fileAttachments?prepareTalkAttachment(file):editorImageFile(file)));
      if(imageAccess.loading||!imageAccess.allowed)throw Error(imageAccess.loading?'첨부 권한을 확인하고 있습니다.':imageAccess.reason||'파일을 첨부할 수 없습니다.');
      if(nativeAttachments||!latest.current.upload)throw Error('첨부 저장소가 연결되지 않았습니다. 관리자에게 문의하세요.');
      for(const file of images){const media=await latest.current.upload(file);if(!live.current)return;
        const url=safeTalkUrl(media.url,{media:true});if(!['image','video','file'].includes(media.kind)||!url)throw Error('첨부 결과를 확인하지 못했습니다.');
        if(fileAttachments){changeFiles([...filesRef.current,{url,name:media.name,size:media.size}]);continue;}
        const node=media.kind==='image'?{type:'image',attrs:{src:url,alt:file.name}}:media.kind==='video'?{type:'video',attrs:{src:url,title:file.name}}:{type:'attachment',attrs:{href:url,name:media.name,size:media.size}};
        editorRef.current?.chain().focus().insertContentAt(editorRef.current.state.selection.to,node).createParagraphNear().run();}
    }catch(error){if(live.current)notifyToast(error,{source:'talk-upload',error:true});}
    finally {uploadLock.current=false;if(live.current){setUploading(false);latest.current.onBusy?.(false);}}
  };
  const uploadRef=useRef(addFiles);uploadRef.current=addFiles;
  const extensions=useMemo(()=>{
    const mediaView=tag=>({node})=>{
      const dom=document.createElement(tag);dom.src=node.attrs.src;dom.setAttribute('referrerpolicy','no-referrer');if(tag==='video'){dom.controls=true;dom.preload='metadata';dom.playsInline=true;}else dom.alt=node.attrs.alt||'';
      let active=true,objectUrl;
      latest.current.loadMedia?.(node.attrs.src).then(blob=>{if(blob&&active){objectUrl=URL.createObjectURL(blob);dom.src=objectUrl;}}).catch(()=>{});
      return {dom,destroy(){active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);}};
    };
    return [
    StarterKit.configure({codeBlock:false,heading:{levels:[2,3]},link:{openOnClick:false,protocols:['https','http'],HTMLAttributes:{rel:'noopener noreferrer',target:'_blank'}}}),
    CodeBlockLowlight.extend({addNodeView(){return ReactNodeViewRenderer(TalkCodeBlock,{contentDOMElementTag:'code'});}}).configure({lowlight:talkLowlight,defaultLanguage:'plaintext'}),Attachment,
    Image.extend({addNodeView(){return mediaView('img');}}).configure({allowBase64:false}),Video.extend({addNodeView(){return mediaView('video');}}),TableKit.configure({table:{resizable:false}}),TextStyle,Color,Highlight.configure({multicolor:true}),
    TextAlign.configure({types:['heading','paragraph']}),TaskList,TaskItem.configure({nested:true,a11y:{checkboxLabel:node=>`${node.textContent||'할 일'} 완료 여부`}}),Placeholder.configure({placeholder:({node})=>node.type.name==='codeBlock'?'':placeholder}),
    IdentityMention.configure({profile:login=>latest.current.profile?.(login),HTMLAttributes:{class:'talk-mention',tabindex:'0',role:'button'},renderText:({node})=>`@${node.attrs.id}`,renderHTML:({node,options})=>['span',mergeAttributes(options.HTMLAttributes,{'aria-label':`@${node.attrs.id} 프로필`}),`@${node.attrs.id}`],
      suggestion:{items:async({query})=>{try{return (await latest.current.mentionItems?.(query))||[];}catch{return [];}},render:()=>({
        onStart:props=>{mentionIndexRef.current=0;setMentionIndex(0);setSuggestion(props.editor.isFocused?props:null);},
        onUpdate:props=>{mentionIndexRef.current=0;setMentionIndex(0);setSuggestion(props.editor.isFocused?props:null);},
        onKeyDown:({event})=>{const state=suggestionRef.current;if(event.isComposing)return false;if(event.key==='Escape'){setSuggestion(null);return true;}if(!state?.items.length)return false;
          if(['ArrowDown','ArrowUp'].includes(event.key)){const next=(mentionIndexRef.current+(event.key==='ArrowDown'?1:-1)+state.items.length)%state.items.length;mentionIndexRef.current=next;setMentionIndex(next);return true;}
          if(event.key==='Enter'){const user=state.items[mentionIndexRef.current];state.command({id:user.login,label:user.login});return true;}return false;},
        onExit:()=>setSuggestion(null),
      })}}),
    ];},[]);
  const editor=useEditor({extensions,content:sanitizeTalkHtml(initial.html),editable:!disabled,
    editorProps:{attributes:{'aria-label':bodyLabel,'role':'textbox','aria-multiline':'true','aria-invalid':String(invalid),'aria-disabled':String(disabled||uploading),...(describedBy?{'aria-describedby':describedBy}:{}),tabindex:'0',class:'talk-rich-content'},
      transformPastedHTML:html=>sanitizeTalkHtml(html),
      handlePaste:(_,event)=>{const files=transferredFiles(event.clipboardData);if(files.length){event.preventDefault();uploadRef.current(files);return true;}return false;},
      handleDrop:(view,event)=>{const files=transferredFiles(event.dataTransfer);if(files.length){event.preventDefault();const position=view.posAtCoords({left:event.clientX,top:event.clientY})?.pos;if(position!=null)editorRef.current?.commands.setTextSelection(position);uploadRef.current(files);return true;}return false;},
    },onUpdate:({editor})=>latest.current.onChange?.(fileAttachments?joinTalkAttachmentHtml(editor.getHTML(),filesRef.current):sanitizeTalkHtml(editor.getHTML())),onBlur:()=>setSuggestion(null),
  });editorRef.current=editor;
  useEditorState({editor,selector:({editor})=>editor?{selection:editor.state.selection.from,version:editor.state.doc.content.size,marks:JSON.stringify(editor.state.storedMarks||editor.state.selection.$from.marks())}:null});
  useEffect(()=>{editor?.setEditable(!disabled&&!uploading,false);},[editor,disabled,uploading]);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const currentBodyHtml=()=>{const state=sourceRef.current;return state.dirty?(state.mode==='markdown'?markdownToTalkHtml(state.value):sanitizeTalkHtml(state.value)):sanitizeTalkHtml(editorRef.current?.getHTML()||initial.html);};
  const currentHtml=()=>fileAttachments?joinTalkAttachmentHtml(currentBodyHtml(),filesRef.current):currentBodyHtml();
  useEffect(()=>{if(apiRef)apiRef.current={getHtml:currentHtml,getMarkdown:()=>talkHtmlToMarkdown(currentHtml()),focus:()=>{switchMode('write');requestAnimationFrame(()=>editor?.commands.focus());}};return()=>{if(apiRef)apiRef.current=null;};});
  const switchMode=next=>{
    setMore(false);
    let html=currentBodyHtml();if(sourceRef.current.dirty){
      if(fileAttachments){const split=splitTalkAttachmentHtml(html,media.storedPath);html=split.html;const next=[...new Map([...filesRef.current,...split.files].map(file=>[file.url,file])).values()];filesRef.current=next;setFiles(next);}
      editor.commands.setContent(html);latest.current.onChange?.(fileAttachments?joinTalkAttachmentHtml(html,filesRef.current):html);
    }
    const value=next==='markdown'?talkHtmlToMarkdown(html):next==='html'?html:'';
    sourceRef.current={mode:next,value,dirty:false};setSource(value);setMode(next);
  };
  if(!editor)return <p role="status">편집기를 불러오는 중…</p>;
  const blocked=disabled||uploading,run=command=>()=>{command(editor.chain().focus()).run();};
  const tool=(action,mark,command)=><ActionButton key={action} action={action} disabled={blocked} aria-pressed={mark?editor.isActive(mark):undefined} onClick={run(command)}/>;
  const rect=suggestion?.clientRect?.();
  return <div {...(mode==='write'?mention.handlers:{})} className={`talk-editor${blocked?' is-disabled':''}`}>
    <div className="talk-editor-heading"><CxTabs className="talk-editor-modes" label="본문 편집 방식" idPrefix={`${extraId}-mode`} panelId={`${extraId}-body`} items={[{key:'write',label:'편집'},{key:'preview',label:'미리보기'},{key:'markdown',label:'Markdown'},{key:'html',label:'HTML'}]} active={mode} onChange={switchMode} disabled={blocked}/>{fileAttachments&&<ActionButton action="attachment" label={imageAccess.loading?'첨부 권한 확인 중':imageAccess.allowed?'파일 첨부':imageAccess.reason} disabled={blocked||!imageAccess.allowed} onClick={()=>fileInput.current.click()}/>}</div>
    {mode==='write'&&<><div className="talk-editor-toolbar" role="toolbar" aria-label="글 서식" onMouseDown={event=>{if(event.target.closest('button'))event.preventDefault();}}>
      <CxSelect className="native-select talk-format" aria-label="문단 서식" disabled={blocked} value={editor.isActive('heading',{level:2})?'h2':editor.isActive('heading',{level:3})?'h3':'p'} onChange={e=>e.target.value==='p'?editor.chain().focus().setParagraph().run():editor.chain().focus().setHeading({level:Number(e.target.value.slice(1))}).run()}><option value="p">본문</option><option value="h2">제목</option><option value="h3">소제목</option></CxSelect>
      <span className="talk-tool-group">{tool('bold','bold',c=>c.toggleBold())}{tool('list','bulletList',c=>c.toggleBulletList())}{githubFormat&&<ActionButton action="complete" label="체크 목록" disabled={blocked} aria-pressed={editor.isActive('taskList')} onClick={run(c=>c.toggleTaskList())}/>}<ActionButton action="link" disabled={blocked} onClick={()=>setLink(editor.getAttributes('link').href||'')}/></span>
      <span className="talk-tool-group">{!fileAttachments&&<ActionButton action="image" label={imageAccess.loading?'첨부 권한 확인 중':imageAccess.allowed?'이미지 업로드':imageAccess.reason} disabled={blocked||!imageAccess.allowed} onClick={()=>fileInput.current.click()}/>}<ActionButton action="table" disabled={blocked} onClick={run(c=>c.insertTable({rows:3,cols:3,withHeaderRow:true}))}/>{tool('codeBlock','codeBlock',c=>c.toggleCodeBlock())}</span>
      <ActionButton ref={moreButton} action="more" label="서식 더 보기" aria-expanded={more} aria-controls={more?extraId:undefined} disabled={blocked} onClick={()=>setMore(value=>!value)}/>
      <span className="talk-tool-group talk-history-tools"><ActionButton action="undo" disabled={blocked||!editor.can().undo()} onClick={run(c=>c.undo())}/><ActionButton action="redo" disabled={blocked||!editor.can().redo()} onClick={run(c=>c.redo())}/></span>
    </div>
    {more&&<div id={extraId} className="talk-editor-toolbar talk-editor-extra" role="group" aria-label="추가 서식" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setMore(false);moreButton.current?.focus();}}} onMouseDown={event=>{if(event.target.closest('button'))event.preventDefault();}}>
      <span className="talk-tool-group">{tool('italic','italic',c=>c.toggleItalic())}{!githubFormat&&tool('underline','underline',c=>c.toggleUnderline())}{tool('strike','strike',c=>c.toggleStrike())}</span>
      {!githubFormat&&<><label className="talk-color" title="글자 색"><Icon name="palette" size={20}/><input type="color" aria-label="글자 색" disabled={blocked} value={editor.getAttributes('textStyle').color||'#1f5eff'} onChange={e=>editor.chain().focus().setColor(e.target.value).run()}/></label>
      <ActionButton action="edit" label="강조 표시" aria-pressed={editor.isActive('highlight')} disabled={blocked} onClick={run(c=>c.toggleHighlight({color:'#dce9ff'}))}/>
      <CxSelect className="native-select talk-align" aria-label="문단 정렬" disabled={blocked} value={editor.getAttributes('paragraph').textAlign||editor.getAttributes('heading').textAlign||'left'} onChange={e=>editor.chain().focus().setTextAlign(e.target.value).run()}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></CxSelect></>}
      <span className="talk-tool-group"><ActionButton action="list" label="번호 목록" disabled={blocked} aria-pressed={editor.isActive('orderedList')} onClick={run(c=>c.toggleOrderedList())}/>{!githubFormat&&<ActionButton action="complete" label="체크 목록" disabled={blocked} aria-pressed={editor.isActive('taskList')} onClick={run(c=>c.toggleTaskList())}/>} {tool('quote','blockquote',c=>c.toggleBlockquote())}<ActionButton action="mention" disabled={blocked} onClick={run(c=>c.insertContent('@'))}/></span>
    </div>}
    {editor.isActive('table')&&<div className="talk-table-tools" role="group" aria-label="표 편집"><ActionButton action="addRow" label="행 추가" disabled={blocked} onClick={run(c=>c.addRowAfter())}/><ActionButton action="addColumn" label="열 추가" disabled={blocked} onClick={run(c=>c.addColumnAfter())}/><ActionButton action="removeRow" label="행 삭제" disabled={blocked} onClick={run(c=>c.deleteRow())}/><ActionButton action="removeColumn" label="열 삭제" disabled={blocked} onClick={run(c=>c.deleteColumn())}/><ActionButton action="delete" label="표 삭제" disabled={blocked} onClick={run(c=>c.deleteTable())}/></div>}
    </>}
    <div id={`${extraId}-body`} role="tabpanel" aria-labelledby={`${extraId}-mode-${mode}`} className="talk-editor-body cx-editor-field" aria-invalid={invalid||undefined} aria-disabled={blocked||undefined}>
    <div className="talk-editor-document" hidden={mode!=='write'}><EditorContent editor={editor}/></div>
    {mode==='preview'&&<TalkContent className="talk-editor-preview" body={githubFormat?talkHtmlToMarkdown(currentBodyHtml()):currentBodyHtml()} markdown={githubFormat} media={media} profile={profile}/>}
    {['markdown','html'].includes(mode)&&<textarea className="talk-source" aria-label={`${mode==='html'?'HTML':'Markdown'} 본문`} aria-invalid={invalid||undefined} aria-describedby={describedBy} value={source} maxLength={maxLength} spellCheck={false} disabled={blocked} onChange={e=>{const value=e.target.value;setSource(value);sourceRef.current={mode,value,dirty:true};latest.current.onChange?.(currentHtml());}}/>}
    </div>
    {fileAttachments&&<AttachmentList compact files={files} onRemove={index=>changeFiles(filesRef.current.filter((_,i)=>i!==index))} disabled={blocked}/>}
    <input ref={fileInput} type="file" aria-label={fileAttachments?'첨부 파일 선택':'이미지 선택'} accept={fileAttachments?undefined:EDITOR_IMAGE_ACCEPT} multiple hidden disabled={blocked||!imageAccess.allowed} onChange={e=>{const files=[...e.target.files];e.target.value='';addFiles(files);}}/>
    {uploading&&<div className="talk-upload-status" role="status"><span className="status-spinner"/>첨부 중…</div>}
    {link!==null&&<LinkDialog initial={link} onClose={()=>setLink(null)} onApply={url=>{const replace=editor.isActive('link')||!editor.state.selection.empty;if(replace)editor.chain().focus().extendMarkRange('link').setLink({href:url}).run();else editor.chain().focus().insertContent({type:'text',text:url,marks:[{type:'link',attrs:{href:url}}]}).run();setLink(null);}}/>}
    {mention.popup}
    {suggestion&&rect&&<MentionMenu id={`${extraId}-mentions`} items={suggestion.items} loading={suggestion.loading} activeIndex={mentionIndex} anchorElement={editor.view.dom} anchorRect={suggestion.clientRect} onSelect={user=>suggestion.command({id:user.login,label:user.login})}/> }
  </div>;
}
