import {CxSelect} from './CxSelect';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ActionButton} from './ActionButton';
import {SearchField} from './SearchField';
import './column-visibility.css';

const defaultGroups=[['hierarchy','프로세스'],['basic','배포 현황'],['operation','자동화 현황'],['enhancement','고도화 현황'],['audit','최근 수정']];
const defaultPrimaryKeys=['process','activity','task'];
export function ColumnVisibilityMenu({fields, hidden, onChange, view, groups=defaultGroups, primaryKeys=defaultPrimaryKeys, primaryLabel='프로세스 열', disabled=false}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[position,setPosition]=useState({});
  const trigger=useRef(null),popup=useRef(null);
  const visible=fields.filter(field=>!hidden.includes(field.key));
  const hierarchyKeys=['process','activity','task'];
  const primary=fields.filter(field=>primaryKeys.includes(field.key));
  const configuration=visible.length===fields.length?'all':visible.length===primary.length&&visible.every(field=>primaryKeys.includes(field.key))?'hierarchy':'custom';
  const close=(focus=true)=>{setOpen(false);if(focus)trigger.current?.focus({preventScroll:true});};
  useEffect(()=>{setOpen(false);setQuery('');},[view]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const viewport=window.visualViewport,edge=8,left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0;
      const width=viewport?.width||innerWidth,height=viewport?.height||innerHeight,box=trigger.current.getBoundingClientRect();
      const panelWidth=Math.min(320,width-edge*2),panelHeight=Math.min(560,height-edge*2);
      setPosition({width:panelWidth,maxHeight:panelHeight,left:Math.max(left+edge,Math.min(box.right-panelWidth,left+width-panelWidth-edge)),top:Math.max(top+edge,Math.min(box.bottom+edge,top+height-panelHeight-edge))});
    };
    const outside=event=>{if(!popup.current?.contains(event.target)&&!trigger.current?.contains(event.target))close(false);};
    place();popup.current?.querySelector('input[type=search]')?.focus();
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    window.visualViewport?.addEventListener('resize',place);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.visualViewport?.removeEventListener('resize',place);};
  },[open]);
  useEffect(()=>{if(disabled)close(false);},[disabled]);
  return <><ActionButton ref={trigger} action="selectColumns" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-pressed={hidden.length>0} onClick={()=>{if(open)close();else{setQuery('');setOpen(true);}}}/>
    {open&&createPortal(<div ref={popup} className="table-filter-popover column-visibility-popover" role="dialog" aria-label="표시할 열 선택" style={position} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
      <div className="table-filter-title"><strong>열 선택</strong><span className="column-visibility-count">{visible.length} / {fields.length}</span><ActionButton action="reset" label="표시 열 초기화" disabled={!hidden.length} onClick={()=>onChange([])}/><ActionButton action="close" label="열 선택 닫기" onClick={()=>close()}/></div>
      <label className="column-visibility-configuration"><span>열 구성</span><CxSelect className="native-select" value={configuration} onChange={event=>onChange(event.target.value==='all'?[]:fields.filter(field=>!primaryKeys.includes(field.key)).map(field=>field.key))}>
        <option value="all">모든 열</option><option value="hierarchy" disabled={!primary.length}>{primaryLabel}</option>{configuration==='custom'&&<option value="custom" disabled>직접 선택</option>}
      </CxSelect></label>
      <SearchField label="열 이름 검색" value={query} onChange={setQuery}/>
      <div className="column-visibility-options">{groups.map(([key,label])=>{
        const options=fields.filter(field=>(key==='hierarchy'?hierarchyKeys.includes(field.key):field.group===key&&!hierarchyKeys.includes(field.key))&&field.label.toLowerCase().includes(query.trim().toLowerCase()));
        return options.length>0&&<fieldset key={key}><legend>{label}</legend>{options.map(field=>{
          const checked=!hidden.includes(field.key),last=checked&&visible.length===1;
          return <label className="table-filter-option" key={field.key} title={last?'최소 한 개의 열을 표시해야 합니다.':undefined}><input className="cx-checkbox" type="checkbox" aria-label={`${field.label} 열 표시`} checked={checked} disabled={last} onChange={()=>onChange(checked?[...hidden,field.key]:hidden.filter(key=>key!==field.key))}/><span>{field.label}</span></label>;
        })}</fieldset>;
      })}{!fields.some(field=>field.label.toLowerCase().includes(query.trim().toLowerCase()))&&<p className="column-visibility-empty">일치하는 열이 없습니다.</p>}</div>
    </div>,document.body)}
  </>;
}
