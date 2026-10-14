import React, {useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './Icon';
import './cx-select.css';

const readOptions=field=>[...field.options].map((option,index)=>({index,value:option.value,label:option.label,disabled:Boolean(option.disabled||option.parentElement.disabled),group:option.parentElement.tagName==='OPTGROUP'?option.parentElement.label:''}));
const sameOptions=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Keep the native field for forms, labels, controlled values and change handlers.
// Only its expanded menu is rendered here, so every browser uses the CX surface.
export function CxSelect({children, ref:forwardedRef, onKeyDown, onPointerDown, onMouseDown, onBlur, onChange, ...props}) {
  const id=useId(),field=useRef(null),menu=useRef(null),search=useRef({text:'',at:0}),selectedAtOpen=useRef(-1);
  const [open,setOpen]=useState(false),[options,setOptions]=useState([]),[active,setActive]=useState(-1),[position,setPosition]=useState(null),[navigation,setNavigation]=useState('pointer');
  const enhanced=!props.multiple&&!(props.size>1);
  const close=()=>setOpen(false);
  const show=(method='pointer')=>{
    if(!enhanced||field.current.matches(':disabled'))return;
    const rows=readOptions(field.current);selectedAtOpen.current=field.current.selectedIndex;
    setOptions(rows);setActive(rows.find(row=>row.index===field.current.selectedIndex&&!row.disabled)?.index??rows.find(row=>!row.disabled)?.index??-1);
    setNavigation(method);setPosition(null);setOpen(true);search.current={text:'',at:0};
  };
  const choose=index=>{
    if(field.current.matches(':disabled')||field.current.selectedIndex!==selectedAtOpen.current||!sameOptions(options,readOptions(field.current))){close();return;}
    const option=field.current.options[index];
    if(!option||option.disabled||option.parentElement.disabled)return;
    close();
    if(field.current.selectedIndex!==index){
      field.current.selectedIndex=index;
      field.current.dispatchEvent(new Event('input',{bubbles:true}));
      field.current.dispatchEvent(new Event('change',{bubbles:true}));
    }
  };
  // A catalog refresh or an enclosing form lock invalidates the visible choices.
  // Observe native DOM changes too, since fieldsets and editor views can update
  // without rerendering this component. Recheck synchronously before committing.
  useLayoutEffect(()=>{
    if(!open)return;
    const sync=()=>{if(field.current.matches(':disabled')||field.current.selectedIndex!==selectedAtOpen.current||!sameOptions(options,readOptions(field.current)))close();};
    sync();
    const observer=new MutationObserver(sync);
    observer.observe(field.current,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','value','label','selected']});
    for(let parent=field.current.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='FIELDSET')observer.observe(parent,{attributes:true,attributeFilter:['disabled']});
    return()=>observer.disconnect();
  },[open,options,children,props.value,props.disabled]);
  useLayoutEffect(()=>{
    if(!open)return;
    if(props.disabled){close();return;}
    const place=()=>{
      const rect=field.current.getBoundingClientRect(),viewport=window.visualViewport;
      const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
      const below=top+height-rect.bottom-12,above=rect.top-top-12,w=Math.min(Math.max(rect.width,180),420,width-16);
      const down=below>=Math.min(240,options.length*36+8)||below>=above;
      const maxHeight=Math.max(48,Math.min(320,down?below:above));
      setPosition({left:Math.max(left+8,Math.min(rect.left,left+width-w-8)),width:w,maxHeight,...(down?{top:rect.bottom+4}:{bottom:innerHeight-rect.top+4})});
    };
    const outside=event=>{if(!menu.current?.contains(event.target)&&event.target!==field.current)close();};
    const scroll=event=>{
      if(menu.current?.contains(event.target))return;
      const rect=field.current.getBoundingClientRect();
      let top=0,bottom=innerHeight,left=0,right=innerWidth;
      for(let parent=field.current.parentElement;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent),box=parent.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);}
        if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right);}
      }
      if(rect.bottom<=top||rect.top>=bottom||rect.right<=left||rect.left>=right)close();else place();
    };
    place();document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);document.addEventListener('scroll',scroll,true);
    window.visualViewport?.addEventListener('resize',place);
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);document.removeEventListener('scroll',scroll,true);window.visualViewport?.removeEventListener('resize',place);};
  },[open,props.disabled,options.length]);
  useLayoutEffect(()=>{if(open&&position)menu.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[open,active,position]);
  const keydown=event=>{
    if(!enhanced){onKeyDown?.(event);return;}
    if(open&&['Escape','Tab'].includes(event.key)){
      close();if(event.key==='Escape'){event.preventDefault();event.stopPropagation();return;}
      onKeyDown?.(event);return;
    }
    if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
      event.preventDefault();event.stopPropagation();
      if(!open){show('keyboard');return;}
      if(event.key==='Enter'||event.key===' '){choose(active);return;}
      setNavigation('keyboard');
      const enabled=options.filter(row=>!row.disabled),index=enabled.findIndex(row=>row.index===active);
      const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:Math.max(0,Math.min(enabled.length-1,index+(event.key==='ArrowDown'?1:-1)));
      setActive(enabled[next]?.index??-1);return;
    }
    if(open&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      event.preventDefault();event.stopPropagation();const now=Date.now();
      search.current={text:(now-search.current.at<700?search.current.text:'')+event.key.toLocaleLowerCase(),at:now};
      const match=options.find(row=>!row.disabled&&row.label.toLocaleLowerCase().startsWith(search.current.text));
      if(match){setNavigation('keyboard');setActive(match.index);}return;
    }
    onKeyDown?.(event);
  };
  const target=field.current?.closest('[aria-modal="true"], [role="dialog"], .table-filter-popover')||document.body;
  const label=field.current?.labels?.[0]?.cloneNode(true);label?.querySelectorAll('select').forEach(node=>node.remove());
  const nativeOptions=nodes=>React.Children.map(nodes,child=>React.isValidElement(child)?React.cloneElement(child,child.type==='option'?{'aria-hidden':open||undefined}:{},child.props.children&&child.type!=='option'?nativeOptions(child.props.children):child.props.children):child);
  return <><select {...props} ref={node=>{field.current=node;if(typeof forwardedRef==='function')forwardedRef(node);else if(forwardedRef)forwardedRef.current=node;}}
    data-cx-select={enhanced||undefined} aria-haspopup={enhanced?'listbox':props['aria-haspopup']} aria-expanded={enhanced?open:undefined} aria-controls={open?id:undefined} aria-activedescendant={open&&active>=0?`${id}-${active}`:undefined}
    onPointerDown={event=>{onPointerDown?.(event);if(!enhanced||event.defaultPrevented||event.button!==0)return;event.preventDefault();field.current.focus({preventScroll:true});open?close():show();}}
    onMouseDown={event=>{onMouseDown?.(event);if(enhanced)event.preventDefault();}}
    onKeyDown={keydown} onBlur={event=>{close();onBlur?.(event);}} onChange={event=>{close();onChange?.(event);}}>{nativeOptions(children)}</select>
    {open&&createPortal(<div id={id} ref={menu} role="listbox" aria-label={props['aria-label']||label?.textContent?.trim()||'선택'} className="cx-select-menu" data-navigation={navigation} style={position||{visibility:'hidden'}} onPointerDown={event=>event.preventDefault()}>
      {options.map((row,index)=><React.Fragment key={`${row.value}-${index}`}>
        {row.group&&row.group!==options[index-1]?.group&&<div className="cx-select-group">{row.group}</div>}
        <div id={`${id}-${row.index}`} role="option" aria-selected={field.current.selectedIndex===row.index} aria-disabled={row.disabled||undefined} data-option-index={row.index} className={`cx-select-option${active===row.index?' is-active':''}`} onPointerMove={()=>{setNavigation('pointer');if(!row.disabled)setActive(row.index);}} onClick={()=>choose(row.index)}>
          <span>{row.label||'선택'}</span>{field.current.selectedIndex===row.index&&<Icon name="check" size={16}/>}
        </div>
      </React.Fragment>)}
      {!options.length&&<div className="cx-select-empty">선택 항목이 없습니다.</div>}
    </div>,target)}
  </>;
}
