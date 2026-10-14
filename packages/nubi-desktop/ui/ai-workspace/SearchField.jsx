import React,{useRef} from 'react';
import {ActionButton} from './ActionButton';
import {Icon} from './Icon';
import './search-field.css';

// Search queries stay in their owning screen. Clearing never resets other filters.
export function SearchField({label,placeholder=label,value,onChange,clearLabel='검색 지우기',className='',disabled=false,ref:forwardedRef,...inputProps}) {
  const input=useRef(null);
  return <div className={`cx-input-shell cx-search-field ${className}`.trim()}>
    <Icon name="search" size={18}/>
    <input {...inputProps} ref={node=>{input.current=node;if(typeof forwardedRef==='function')forwardedRef(node);else if(forwardedRef)forwardedRef.current=node;}} type="search" aria-label={label} placeholder={placeholder} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}/>
    {value&&<ActionButton action="clearSearch" label={clearLabel} disabled={disabled} onClick={()=>{onChange('');input.current?.focus({preventScroll:true});}}/>}
  </div>;
}
