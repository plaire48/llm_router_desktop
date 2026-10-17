import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {TerminalMark} from './marks.jsx';
import {commandOptions} from '../runtime/agent-commands.mjs';
import {composerCommandQuery,removeComposerQuery} from './composer-command-state.mjs';

export function useComposerCommands({api,taskId,value,inputRef,onChange,onCommand,onSelect,onCatalog}) {
  const [catalog,setCatalog]=useState([]),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
  const [selected,setSelected]=useState(0),[dismissed,setDismissed]=useState(null),[position,setPosition]=useState(null),[caret,setCaret]=useState(value.length),[blocked,setBlocked]=useState(false);
  const menu=useRef(null),id=useId(),fieldCaret=inputRef.current?.value===value?inputRef.current.selectionStart:caret,query=composerCommandQuery(value,fieldCaret),visible=!!query&&dismissed!==value&&!blocked;
  const options=commandOptions(catalog,query?.query||''),signature=options.map(item=>item.command).join('|');
  const needsCatalog=/^\/[^\s/]+\s/.test(value);
  useEffect(()=>{onCatalog?.(catalog);},[catalog,onCatalog]);
  useEffect(()=>{setDismissed(null);setCaret(inputRef.current?.selectionStart??value.length);},[value]);
  useEffect(()=>{
    const field=inputRef.current;if(!field)return;
    const selection=()=>setCaret(field.selectionStart??value.length);
    const enter=()=>setDismissed(null);
    const outside=event=>{if(event.target===field)enter();else if(!menu.current?.contains(event.target))setDismissed(value);};
    const modal=()=>setBlocked([...document.querySelectorAll('[aria-modal="true"]')].some(node=>node.getClientRects().length&&!node.closest('[inert],[hidden],[data-modal-motion="leaving"]')));
    for(const type of ['select','click','keyup'])field.addEventListener(type,selection);
    field.addEventListener('focus',enter);
    document.addEventListener('pointerdown',outside,true);window.addEventListener('blur',outside);
    const observer=new MutationObserver(modal);observer.observe(document.body,{childList:true});modal();
    return()=>{for(const type of ['select','click','keyup'])field.removeEventListener(type,selection);field.removeEventListener('focus',enter);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('blur',outside);observer.disconnect();};
  },[inputRef,value]);
  useEffect(()=>{setCatalog([]);},[api,taskId]);
  useEffect(()=>{
    if((!visible&&!needsCatalog)||!api)return;
    let live=true;setLoading(true);setFailed(false);
    Promise.resolve().then(()=>api('listSkills',{taskId})).then(result=>{if(live)setCatalog(result.skills||[]);}).catch(()=>{if(live)setFailed(true);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[api,taskId,visible,needsCatalog]);
  useEffect(()=>{setSelected(0);},[value,signature]);
  useLayoutEffect(()=>{
    if(!visible)return;
    const field=inputRef.current?.closest('form');if(!field)return;
    const place=()=>{const rect=field.getBoundingClientRect(),width=Math.min(rect.width,innerWidth-24),above=Math.max(0,rect.top-20),below=Math.max(0,innerHeight-rect.bottom-20),up=above>=120||above>=below;const next={left:Math.max(12,Math.min(rect.left,innerWidth-width-12)),width,maxHeight:Math.min(420,up?above:below),...(up?{bottom:Math.max(12,innerHeight-rect.top+8)}:{top:rect.bottom+8})};setPosition(previous=>previous&&JSON.stringify(previous)===JSON.stringify(next)?previous:next);};
    place();const observer=new ResizeObserver(place);observer.observe(field);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[visible,inputRef]);
  useEffect(()=>{menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[selected]);
  function choose(item) {
    const input=removeComposerQuery(value,query);
    setDismissed(value);
    if(item.action){onChange({target:{value:input}});onCommand?.(item.action);}
    else if(onSelect){onSelect(item,input);requestAnimationFrame(()=>inputRef.current?.focus({preventScroll:true}));}
    else {onChange({target:{value:`/${item.command} ${input}`}});requestAnimationFrame(()=>inputRef.current?.focus({preventScroll:true}));}
  }
  function onKeyDown(event) {
    if(!visible||event.nativeEvent?.isComposing||event.keyCode===229)return false;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDismissed(value);return true;}
    if(event.key==='Tab'&&(event.shiftKey||!options.length)){setDismissed(value);return false;}
    if(!options.length){if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();return true;}return false;}
    if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();setSelected(index=>(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);return true;}
    if((event.key==='Enter'&&!event.shiftKey)||(event.key==='Tab'&&!event.shiftKey)){event.preventDefault();choose(options[selected]||options[0]);return true;}
    return false;
  }
  const popup=visible&&position?createPortal(<div className="nubi-command-menu" style={position}>
    <div ref={menu} id={id} role="listbox" aria-label="명령과 스킬" className="nubi-command-options">
      {options.map((item,index)=><CxButton key={item.command} id={`${id}-${index}`} role="option" title={`${item.title}: ${item.description}`} aria-selected={index===selected} type="button" tabIndex={-1} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(item)} onPointerMove={()=>setSelected(index)}><span className="nubi-command-icon">{item.icon==='terminal'?<TerminalMark size={17}/>:<Icon name={item.icon} size={17}/>}</span><span className="nubi-command-copy"><strong>{item.title}</strong><small>{item.description}</small></span><code>/{item.command}</code></CxButton>)}
      {!options.length&&<p className="nubi-command-empty" role="status">{loading?'스킬을 불러오는 중':'일치하는 항목이 없어요.'}</p>}
    </div>
    {failed&&<small className="nubi-command-footnote">스킬을 불러오지 못했어요. 스킬 관리에서 다시 확인해 주세요.</small>}
  </div>,document.body):null;
  return {popup,onKeyDown,catalog,onInputChange:()=>setDismissed(null),inputAttributes:visible?{'aria-controls':id,'aria-expanded':true,'aria-autocomplete':'list','aria-activedescendant':options.length?`${id}-${Math.min(selected,options.length-1)}`:undefined}:{'aria-expanded':false}};
}
